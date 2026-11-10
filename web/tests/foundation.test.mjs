import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import React from 'react';
import { JSDOM } from 'jsdom';

test('opening body contract is first child and fits its word cap', async () => {
  const html = await readFile('index.html', 'utf8');
  const comment = html.match(/<body>\s*(<!--[\s\S]*?-->)/)?.[1];
  assert.ok(comment?.includes('997d7f7f'));
  assert.ok(comment.split(/\s+/).length <= 150);
  assert.ok(comment.includes('FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md'));
  const dom = new JSDOM(html);
  try {
    assert.equal([...dom.window.document.body.childNodes].find(n => n.nodeType !== 3)?.nodeType, 8);
    assert.equal(dom.window.document.documentElement.lang, 'pt-BR');
    assert.equal(dom.window.document.querySelectorAll('#root').length, 1);
  } finally { dom.window.close(); }
});

test('bundled JSON is exact actual SDK output with matching input dimensions', async () => {
  const bytes = await readFile('src/samples/moderate-study.generated.json');
  const provenance = JSON.parse(await readFile('src/samples/provenance.json', 'utf8'));
  const sample = JSON.parse(bytes);
  assert.equal(bytes.length, provenance.json_bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), provenance.json_sha256);
  assert.equal(provenance.status, 'ACTUAL_INSTALLED_FIXED_SDK_SYNTHETIC_SAMPLE');
  assert.equal(sample.input.row_ids.length, 64);
  assert.equal(sample.input.feature_names.length, 8);
  assert.equal(sample.plan.k, 5);
  const main = await readFile('src/main.tsx', 'utf8');
  assert.match(main, /moderate-study\.generated\.json\?raw/);
  assert.match(main, /<App samples=\{samples\}/);
});

test('native JSON object duplicates deliberately use last-member-wins', () => {
  assert.deepEqual(JSON.parse('{"schema":"old","schema":"final"}'), { schema: 'final' });
  assert.deepEqual(JSON.parse('{"schema":"final","schema":"old"}'), { schema: 'old' });
  assert.equal(JSON.parse('{"id":"001"}').id, '001');
});

test('retained notice texts match every recorded digest', async () => {
  const rows = JSON.parse(await readFile('dependency-notices/sources.json', 'utf8'));
  assert.equal(rows.length, 82);
  for (const row of rows) {
    assert.ok(row.notices.length, `${row.name} has retained terms`);
    for (const notice of row.notices) {
      assert.ok(notice.path.startsWith('notices/') && !notice.path.includes('..'));
      const bytes = await readFile(`dependency-notices/${notice.path}`);
      assert.equal(bytes.length, notice.bytes);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), notice.sha256);
    }
  }
});

test('exact minimal React runtime mounts, dispatches a DOM click and unmounts in JSDOM', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="probe"></div></body></html>', { url: 'https://example.invalid' });
  const saved = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  let root;
  try {
    const { createRoot } = await import('react-dom/client');
    const { flushSync } = await import('react-dom');
    let clicks = 0;
    root = createRoot(dom.window.document.getElementById('probe'));
    flushSync(() => root.render(React.createElement('button', { onClick: () => clicks++ }, 'probe')));
    dom.window.document.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.equal(clicks, 1);
    flushSync(() => root.unmount());
    root = undefined;
    assert.equal(dom.window.document.querySelector('#probe').childElementCount, 0);
  } finally {
    root?.unmount();
    // Let React's already queued host callbacks settle before removing its DOM globals.
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    dom.window.close();
  }
});
