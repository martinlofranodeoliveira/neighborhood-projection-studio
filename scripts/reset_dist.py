"""Reset only this gate's marked generated output, before any preparation stage."""
from pathlib import Path
import os
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'dist'
MARKER = b'neighborhood-projection-studio generated gate output v1\n'

def stop():
    raise SystemExit('dist must be a real gate-owned directory without symlinks; move unmarked output before running this gate')

if DIST.is_symlink() or (DIST.exists() and not DIST.is_dir()):
    stop()
if DIST.exists():
    for directory, dirs, files in os.walk(DIST, followlinks=False):
        for name in dirs + files:
            path = Path(directory) / name
            if path.is_symlink() or not (path.is_dir() or path.is_file()):
                stop()
    marker = DIST / '.neighborhood-gate-output'
    if not marker.is_file() or marker.read_bytes() != MARKER:
        stop()
    shutil.rmtree(DIST)
DIST.mkdir()
(DIST / '.neighborhood-gate-output').write_bytes(MARKER)
