import { access, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const mode = process.argv[2];
const runtime = ['App.tsx', 'ProjectionScene.tsx', 'study.ts', 'view.ts', 'styles.css'];

function run(args) {
  const child = spawnSync(process.execPath, args, {
    stdio: 'inherit', timeout: 180000,
    env: { ...process.env, NODE_ENV: mode === 'test' ? 'development' : 'production' }
  });
  if (child.error) throw child.error;
  if (child.status !== 0) process.exit(child.status ?? 1);
}

if (['typecheck', 'build', 'test'].includes(mode)) {
  const missing = [];
  for (const file of runtime) {
    try { await access(`src/${file}`); } catch { missing.push(file); }
  }
  if (missing.length) {
    console.error(`RUNTIME_SOURCE_PENDING: ${missing.join(', ')}`);
    process.exit(2);
  }
}

if (mode === 'typecheck') {
  run(['node_modules/typescript/bin/tsc', '--noEmit']);
} else if (mode === 'build') {
  run(['node_modules/typescript/bin/tsc', '--noEmit']);
  run(['node_modules/vite/bin/vite.js', 'build', '--configLoader', 'runner']);
} else if (mode === 'test') {
  const { build } = await import('vite');
  const { default: react } = await import('@vitejs/plugin-react');
  await build({
    configFile: false, envDir: false, logLevel: 'warn', plugins: [react()],
    define: { 'process.env.NODE_ENV': JSON.stringify('development') },
    build: {
      ssr: true, target: 'es2022', outDir: 'build/checks', emptyOutDir: true, minify: false,
      rollupOptions: {
        input: { runtime: 'tests/runtime.test.mjs', dom: 'tests/dom.test.mjs', scene: 'tests/scene.test.mjs' },
        output: { entryFileNames: '[name].mjs' }
      }
    }
  });
  run(['--test', '--test-timeout=30000', 'build/checks/runtime.mjs', 'build/checks/dom.mjs', 'build/checks/scene.mjs']);
} else if (mode === 'html') {
  const source = await readFile('index.html', 'utf8');
  const built = await readFile('dist/index.html', 'utf8');
  const comment = source.match(/<body>\s*(<!--[\s\S]*?-->)/)?.[1];
  assert.ok(comment && comment.includes('997d7f7f'));
  assert.ok(comment.split(/\s+/).length <= 150);
  assert.equal(built.match(/<body>\s*(<!--[\s\S]*?-->)/)?.[1], comment);
  assert.doesNotMatch(built, /(?:src|href)=["']https?:\/\//);
  assert.match(built, /\.\/assets\//);
  console.log('HTML source/build direction comment and local asset paths verified; no browser rendering claim.');
} else {
  throw new Error('Expected typecheck, build, test or html');
}
