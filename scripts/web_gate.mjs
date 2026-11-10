import { readFile, readdir, lstat, mkdir, copyFile, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

// Same source exclusions and canonical entry encoding as control.quality.file_inventory.
const excludes = new Set(['node_modules','target','dist','build','.build','vendor','.git','__pycache__','.pytest_cache','.mypy_cache','.ruff_cache','.dart_tool','.pub-cache','.gradle','_build','deps','obj']);
async function inventory(root) {
  const files = [];
  async function visit(relative = '') {
    for (const name of (await readdir(join(root, relative))).sort()) {
      if (excludes.has(name)) continue;
      const path = relative ? relative + '/' + name : name;
      const absolute = join(root, path), info = await lstat(absolute);
      assert.ok(!info.isSymbolicLink(), 'Source symlink refused');
      if (info.isDirectory()) await visit(path);
      else {
        assert.ok(info.isFile(), 'Nonregular source refused');
        const bytes = await readFile(absolute);
        files.push({path, size:bytes.length, sha256:createHash('sha256').update(bytes).digest('hex')});
      }
    }
  }
  await visit(); files.sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const canonical = files.map(({path,size,sha256}) => ({path,sha256,size}));
  return {sha256:createHash('sha256').update(JSON.stringify(canonical)).digest('hex'), files};
}

const mode = process.argv[2];
if (mode === '--capture-sdk-source') {
  const record = await inventory('/opt/nps-source-snapshot');
  await writeFile('/opt/nps-source-manifest.json', JSON.stringify(record,null,2)+'\n');
  console.log(JSON.stringify({status:'SDK_SOURCE_CAPTURED',source_tree_sha256:record.sha256,files:record.files.length}));
} else {
  assert.ok(['all','test','build'].includes(mode), 'Expected all, test or build');
  const expected = JSON.parse(await readFile('/opt/nps-source-manifest.json','utf8'));
  const current = await inventory('/work');
  assert.deepEqual(current, expected, 'Mounted source differs from admitted SDK source');
  const scratch = '/tmp/nps-web-gate/web'; await mkdir(scratch,{recursive:true});
  for (const row of expected.files.filter(row => row.path.startsWith('web/'))) {
    const relative = row.path.slice(4), destination = join(scratch,relative);
    assert.equal(resolve(destination).startsWith(scratch+'/'),true);
    await mkdir(dirname(destination),{recursive:true});
    await copyFile(join('/work',row.path),destination);
  }
  await symlink('/opt/nps-web/node_modules',join(scratch,'node_modules'),'dir');
  const checks = mode === 'test' ? ['test:foundation','typecheck','test'] : mode === 'build' ? ['build','check:html'] : ['test:foundation','typecheck','test','build','check:html'];
  for (const check of checks) {
    const child = spawnSync('npm',['run',check],{cwd:scratch,stdio:'inherit',timeout:180000,env:{...process.env,NODE_ENV:check.includes('test')?'development':'production'}});
    if (child.error) throw child.error;
    assert.equal(child.status,0,`Web gate failed: ${check}; signal=${child.signal}`);
  }
  const built = mode === 'test' ? [] : (await inventory(join(scratch,'dist'))).files;
  assert.deepEqual(await inventory('/work'),expected,'Source changed during web checks');
  console.log(JSON.stringify({status:'PASS_SOURCE_BOUND_NODE_GATE',source_tree_sha256:expected.sha256,checks,compiled_artifacts:built,scope:'Actual CPU/JSDOM/TypeScript/build/HTML only; no browser/WebGL/visual/accessibility acceptance.'}));
}
