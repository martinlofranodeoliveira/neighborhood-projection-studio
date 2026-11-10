"""Codex support adapter/real-subprocess tests; not generated model tests."""
from dataclasses import replace
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace

import pytest
import neighborhood_projection_studio as sdk
from neighborhood_projection_studio import cli

EXAMPLES = Path(__file__).resolve().parents[1] / 'examples'


def invoke(args, *, data=None, **kwargs):
    return subprocess.run([sys.executable, '-I', '-B', '-m', 'neighborhood_projection_studio', *args],
        input=data, stdout=kwargs.pop('stdout', subprocess.PIPE),
        stderr=kwargs.pop('stderr', subprocess.PIPE), timeout=20, **kwargs)


def constant():
    return (EXAMPLES / 'constant.input.json').read_bytes()


def error(result, code, reason, status=None):
    assert result.returncode == code
    assert result.stdout == b''
    payload = json.loads(result.stderr)
    assert set(payload) == {'complete', 'reason', 'status'} and payload['complete'] is False
    assert payload['reason'] == reason
    if status is not None: assert payload['status'] == status
    return payload


def test_actual_installed_console_module_and_formats():
    console = Path(sys.executable).parent / 'neighborhood-projection-studio'
    assert console.is_file()
    result = subprocess.run([str(console), 'analyze', '--input', str(EXAMPLES / 'constant.input.json')],
        capture_output=True, timeout=20)
    assert result.returncode == 0 and result.stderr == b''
    wire = json.loads(result.stdout)
    assert wire['schema'] == 'neighborhood-projection-study/1'
    assert wire['pca']['signal_state'] == 'CONSTANT_INPUT'
    assert wire['neighborhood']['trustworthiness_fraction'] is None
    assert result.stdout.endswith(b'\n')
    from_stdin = invoke(['analyze', '--input', '-'], data=constant())
    assert from_stdin.returncode == 0 and from_stdin.stdout == result.stdout
    csv_result = invoke(['analyze', '--input', '-', '--format', 'csv'], data=constant())
    assert csv_result.returncode == 0 and csv_result.stderr == b''
    rows = list(csv.reader(io.StringIO(csv_result.stdout.decode())))
    assert rows[0] == ['id','pc1','pc2','pc3','k','neighborhood_state','retained_count','penalty']
    assert len(rows) == 17 and all(row[-2:] == ['', ''] for row in rows[1:])


@pytest.mark.parametrize('args', [['--help'], ['--version'], ['analyze', '--help']])
def test_standalone_help_version_and_child_help(args):
    result = invoke(args)
    assert result.returncode == 0 and result.stdout and result.stderr == b''
    assert b'neighborhood-projection-studio' in result.stdout


@pytest.mark.parametrize('args', [[], ['backtest'], ['analyze'], ['analyze','--input','-','--format','html'],
    ['demo','--max-output-bytes','-1'], ['demo','--max-output-bytes','16777217'],
    ['demo','--max-output-bytes','1e3'], ['demo','--max-output-bytes','0001'], ['demo','--max-o','1']])
def test_usage_is_closed_without_echoing_arguments(args):
    error(invoke(args), 2, 'CLI_USAGE', 'INVALID_INPUT')


@pytest.mark.parametrize('raw', [b'{', b'\xff', b'{"schema":1e309}', b'{"schema":NaN}',
    b'{"schema":1,"schema":2}', b'{"a":{"k":1,"k":2}}'])
def test_malformed_duplicate_nonfinite_UTF8_errors_are_stable(raw):
    error(invoke(['analyze','--input','-'], data=raw), 2, 'INPUT_JSON', 'INVALID_INPUT')


@pytest.mark.parametrize('change', [lambda d:d.update(extra='private marker'),
    lambda d:d.update(schema='wrong'), lambda d:d.update(plan={'k':2,'other':0}),
    lambda d:d.update(budget={'unknown':0}), lambda d:d.update(budget=[]),
    lambda d:d.update(row_ids='p0'), lambda d:d.pop('feature_names')])
def test_closed_wrapper_schema(change):
    data=json.loads(constant());change(data)
    result=invoke(['analyze','--input','-'],data=json.dumps(data).encode())
    error(result,2,'INPUT_SCHEMA','INVALID_INPUT')
    assert b'private marker' not in result.stderr


def test_core_owns_typed_plan_budget_values_and_outcomes():
    data=json.loads(constant());data['plan']['k']=True
    error(invoke(['analyze','--input','-'],data=json.dumps(data).encode()),2,'PLAN_K')
    data=json.loads(constant());data['budget']={'max_rows':15}
    error(invoke(['analyze','--input','-'],data=json.dumps(data).encode()),3,'ADMISSION_BUDGET')
    data=json.loads(constant());data['values'][0][0]=True
    error(invoke(['analyze','--input','-'],data=json.dumps(data).encode()),2,'INPUT_SCHEMA')
    data=json.loads(constant());data['budget']={'max_report_bytes':0}
    error(invoke(['analyze','--input','-'],data=json.dumps(data).encode()),3,'JSON_BUDGET')


@pytest.mark.parametrize('format,reason',[('json','JSON_BUDGET'),('csv','CSV_BUDGET')])
def test_format_zero_cap_follows_input_and_core(format,reason):
    args=['analyze','--input','-','--format',format,'--max-output-bytes','0']
    error(invoke(args,data=b'{'),2,'INPUT_JSON')
    bad=json.loads(constant());bad['plan']['k']=True
    error(invoke(args,data=json.dumps(bad).encode()),2,'PLAN_K')
    error(invoke(args,data=constant()),3,reason)


def test_input_byte_exact_and_one_over_regular_file_and_stdin(tmp_path):
    base=constant();exact=base+b' '*(cli.MAX_INPUT_BYTES-len(base))
    result=invoke(['analyze','--input','-'],data=exact)
    assert result.returncode == 0 and result.stderr == b''
    error(invoke(['analyze','--input','-'],data=exact+b' '),3,'INPUT_BYTES')
    path=tmp_path/'exact.json';path.write_bytes(exact)
    result=invoke(['analyze','--input',str(path)])
    assert result.returncode == 0
    path.write_bytes(exact+b' ')
    error(invoke(['analyze','--input',str(path)]),3,'INPUT_BYTES')


def test_owned_local_snapshot_refuses_symlink_FIFO_directory_missing(tmp_path):
    path=tmp_path/'input.json';path.write_bytes(constant())
    alias=tmp_path/'alias';alias.symlink_to(path)
    fifo=tmp_path/'fifo';os.mkfifo(fifo)
    for name in [alias,fifo,tmp_path,tmp_path/'missing']:
        error(invoke(['analyze','--input',str(name)]),4,'INPUT_IO')
    assert path.read_bytes() == constant()


def test_observed_leaf_change_fails_before_decode_or_model(tmp_path,monkeypatch):
    path=tmp_path/'input.json';path.write_bytes(constant())
    original=cli.os.read;changed=[]
    def modifying(fd,size):
        part=original(fd,size)
        if part and not changed:
            changed.append(True);path.write_bytes(constant()+b' ')
        return part
    monkeypatch.setattr(cli.os,'read',modifying)
    with pytest.raises(cli.InputFailure) as caught:cli._read_input(str(path))
    assert caught.value.reason == 'INPUT_IO' and changed


def test_raw_stdin_None_is_IO_not_JSON_or_unknown(monkeypatch):
    monkeypatch.setattr(cli.sys,'stdin',SimpleNamespace(buffer=SimpleNamespace(read=lambda size:None)))
    with pytest.raises(cli.InputFailure) as caught:cli._read_input('-')
    assert caught.value.status == 'INCOMPLETE' and caught.value.reason == 'INPUT_IO'


def test_short_writer_and_missing_binary_stream_are_output_IO(monkeypatch):
    class Short:
        def write(self,data):return None
        def flush(self):pass
    with pytest.raises(cli.OutputFailure):cli._write(Short(),b'payload')
    monkeypatch.setattr(cli.sys,'stdout',None)
    with pytest.raises(cli.OutputFailure):cli._binary_stream('stdout')


@pytest.mark.parametrize('args,data,exitcode', [(['analyze','--input','-'],constant(),4),
    (['--help'],None,4), (['--version'],None,4)])
def test_real_dev_full_stdout_cannot_become_finalizer_120(args,data,exitcode):
    with open('/dev/full','wb') as full:
        result=invoke(args,data=data,stdout=full)
    assert result.returncode == exitcode
    assert json.loads(result.stderr)['reason'] == 'OUTPUT_IO'
    assert b'Exception ignored' not in result.stderr and b'Traceback' not in result.stderr


def test_real_dev_full_stderr_preserves_original_error_and_both_full():
    with open('/dev/full','wb') as full:
        result=invoke(['analyze','--input','-'],data=b'{',stderr=full)
    assert result.returncode == 2 and result.stdout == b''
    with open('/dev/full','wb') as full:
        result=invoke(['analyze','--input','-'],data=constant(),stdout=full,stderr=full)
    assert result.returncode == 4


def test_real_closed_stdout_pipe_and_error_stderr_pipe():
    read,write=os.pipe();os.close(read)
    try:
        result=invoke(['analyze','--input','-'],data=constant(),stdout=write)
    finally:os.close(write)
    assert result.returncode == 4 and json.loads(result.stderr)['reason'] == 'OUTPUT_IO'
    assert b'Exception ignored' not in result.stderr
    read,write=os.pipe();os.close(read)
    try:result=invoke(['analyze','--input','-'],data=b'{',stderr=write)
    finally:os.close(write)
    assert result.returncode == 2 and result.stdout == b''


def test_actual_demo_independent_checks_survive_optimization():
    result=subprocess.run([sys.executable,'-I','-B','-O','-m','neighborhood_projection_studio','demo','--assert'],capture_output=True,timeout=20)
    assert result.returncode == 0 and result.stderr == b''
    assert json.loads(result.stdout)['neighborhood']['trustworthiness_fraction'] == {'numerator':115,'denominator':128}


def test_demo_checker_rejects_changed_metric_without_Python_asserts():
    ids,values,names,plan,budget=cli._demo()
    result=sdk.analyze_projection(ids,values,names,plan,budget=budget)
    wrong=replace(result,report=replace(result.report,neighborhood=replace(result.report.neighborhood,
        total_penalty=result.report.neighborhood.total_penalty+1,
        trustworthiness_fraction=replace(result.report.neighborhood.trustworthiness_fraction,numerator=1,denominator=1))))
    with pytest.raises(cli.InputFailure) as caught:cli._assert_demo(wrong)
    assert caught.value.reason == 'DEMO_ASSERTION'


def test_raw_stdin_valid_prefix_then_None_cannot_become_success(monkeypatch):
    parts=iter([constant(),None])
    monkeypatch.setattr(cli.sys,'stdin',SimpleNamespace(buffer=SimpleNamespace(read=lambda size:next(parts))))
    with pytest.raises(cli.InputFailure) as caught:cli._read_input('-')
    assert caught.value.reason == 'INPUT_IO'


def test_stdin_all_chunks_before_JSON_decoding(monkeypatch):
    parts=iter([constant(),b' extra',b''])
    monkeypatch.setattr(cli.sys,'stdin',SimpleNamespace(buffer=SimpleNamespace(read=lambda size:next(parts))))
    raw=cli._read_input('-')
    with pytest.raises(cli.InputFailure) as caught:cli._decode(raw)
    assert caught.value.reason == 'INPUT_JSON'


def test_real_nonblocking_stdin_valid_prefix_without_EOF_is_IO():
    read,write=os.pipe();os.set_blocking(read,False)
    try:
        os.write(write,constant())
        result=subprocess.run([sys.executable,'-I','-B','-m','neighborhood_projection_studio','analyze','--input','-'],
            stdin=read,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=20)
        error(result,4,'INPUT_IO','INCOMPLETE')
    finally:
        os.close(read);os.close(write)
