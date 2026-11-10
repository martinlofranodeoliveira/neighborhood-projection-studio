"""Codex support checks for owned output reset before any Docker preparation."""
from pathlib import Path
import os
import shutil
import subprocess
import sys

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'


def project(tmp_path):
    root=tmp_path/'project';(root/'scripts').mkdir(parents=True)
    for name in ['check.sh','reset_dist.py']:shutil.copyfile(SCRIPTS/name,root/'scripts'/name)
    return root


def test_refuses_dist_symlink_before_first_docker_stage(tmp_path):
    root=project(tmp_path);outside=tmp_path/'outside';outside.mkdir()
    (outside/'keep').write_text('unchanged')
    (root/'dist').symlink_to(outside,target_is_directory=True)
    stub=tmp_path/'bin';stub.mkdir();marker=tmp_path/'docker-called'
    fake=stub/'docker';fake.write_text('#!/bin/sh\nprintf called > "$GATE_TEST_MARKER"\nexit 88\n');fake.chmod(0o755)
    env={**os.environ,'PATH':str(stub)+':'+os.environ.get('PATH',''),'GATE_TEST_MARKER':str(marker)}
    result=subprocess.run(['sh',str(root/'scripts/check.sh')],env=env,capture_output=True,timeout=5)
    assert result.returncode != 0 and not marker.exists()
    assert (outside/'keep').read_text() == 'unchanged' and (root/'dist').is_symlink()


def test_repeated_owned_output_invalidates_proof_before_prepare_failure(tmp_path):
    root=project(tmp_path);script=root/'scripts/reset_dist.py'
    subprocess.run([sys.executable,str(script)],check=True)
    (root/'dist/old-success.json').write_text('{"status":"PASS"}')
    stub=tmp_path/'bin';stub.mkdir()
    fake=stub/'docker';fake.write_text('#!/bin/sh\nexit 88\n');fake.chmod(0o755)
    result=subprocess.run(['sh',str(root/'scripts/check.sh')],env={**os.environ,'PATH':str(stub)+':'+os.environ.get('PATH','')},capture_output=True,timeout=5)
    assert result.returncode != 0
    assert not (root/'dist/old-success.json').exists()
    assert (root/'dist/.neighborhood-gate-output').is_file()


def test_unmarked_or_nested_symlink_output_is_preserved_and_rejected(tmp_path):
    root=project(tmp_path);script=root/'scripts/reset_dist.py'
    (root/'dist').mkdir();(root/'dist/personal').write_text('keep')
    result=subprocess.run([sys.executable,str(script)],capture_output=True,timeout=5)
    assert result.returncode != 0 and (root/'dist/personal').read_text() == 'keep'
    shutil.rmtree(root/'dist')
    subprocess.run([sys.executable,str(script)],check=True)
    target=tmp_path/'target';target.write_text('still here')
    (root/'dist/link').symlink_to(target)
    result=subprocess.run([sys.executable,str(script)],capture_output=True,timeout=5)
    assert result.returncode != 0 and (root/'dist/link').is_symlink()
    assert target.read_text() == 'still here'
