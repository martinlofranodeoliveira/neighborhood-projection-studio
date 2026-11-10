"""Source-bound helper for the admitted private SDK image, no transport adapter."""
import hashlib,json,os,shutil,subprocess,sys
from pathlib import Path

ROOT=Path('/work')
EXCLUDES={'node_modules','target','dist','build','.build','vendor','.git','__pycache__','.pytest_cache','.mypy_cache','.ruff_cache','.dart_tool','.pub-cache','.gradle','_build','deps','obj'}
def inventory(root):
    rows=[]
    for directory,dirs,files in os.walk(root,followlinks=False):
        dirs[:]=sorted(name for name in dirs if name not in EXCLUDES)
        assert all(not (Path(directory)/name).is_symlink() for name in dirs)
        for name in sorted(files):
            if name in EXCLUDES: continue
            path=Path(directory)/name;assert path.is_file() and not path.is_symlink()
            raw=path.read_bytes();rows.append({'path':path.relative_to(root).as_posix(),'size':len(raw),'sha256':hashlib.sha256(raw).hexdigest()})
    rows.sort(key=lambda r:r['path'])
    raw=json.dumps(rows,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
    return {'sha256':hashlib.sha256(raw).hexdigest(),'files':rows}

assert sys.argv[1:]==['package']
expected=json.loads(Path('/opt/nps-source-manifest.json').read_text())
assert inventory(ROOT)==expected,'Mounted source differs from admitted SDK source'
# Invalidate old success evidence before the first preparation/build stage.
# The existing public reset helper refuses unmarked data and symlinks.
subprocess.run([sys.executable,'-I','-B',str(ROOT/'scripts/reset_dist.py')],check=True)
base=Path('/tmp/nps-package');source=base/'source';source.mkdir(parents=True)
for row in expected['files']:
    destination=source/row['path'];assert destination.resolve().is_relative_to(source)
    destination.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/row['path'],destination)
for name in ['distributions','evidence']:(base/name).mkdir()
subprocess.run([sys.executable,'-I','-B',str(source/'scripts/build_gate.py')],check=True,cwd=base)
proof=json.loads((base/'evidence/package-proof.json').read_text())
tests=json.loads((base/'evidence/unit-tests.json').read_text())
assert tests['tests']==126 and tests['failures']==tests['errors']==tests['skipped']==tests['pytest_exit']==0
out=ROOT/'dist';shutil.copytree(base/'distributions',out,dirs_exist_ok=True);shutil.copytree(base/'evidence',out/'evidence')
assert inventory(ROOT)==expected,'Source changed during Python package checks'
print(json.dumps({'status':'PASS_SOURCE_BOUND_PYTHON_PACKAGE_GATE','source_tree_sha256':expected['sha256'],'tests':tests,'module_hashes':proof['module_hashes'],'source_sdist_and_both_wheel_bytes_checked':True,'scope':'Current mounted source copied into temporary build; genuine installed SDK/CLI126tests and complete sdist rebuild. Separate artifact-only consumer remains a distinct gate.'}))
