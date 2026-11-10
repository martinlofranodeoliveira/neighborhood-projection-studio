import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';

// Set up the genuine JSDOM platform before importing ReactDOM or App.
const dom = new JSDOM('<!doctype html><html lang="pt-BR"><body><div id="test-root"></div></body></html>', { url: 'https://example.invalid' });
const saved = new Map();
for (const [name, value] of Object.entries({
  window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement, Node: dom.window.Node,
  IS_REACT_ACT_ENVIRONMENT: true, isSecureContext: true, crypto: webcrypto
})) {
  saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
const { createRoot } = await import('react-dom/client');
const { default: App } = await import('../src/App');
const { inputFrame, validateStudy } = await import('../src/study');
let root;

function setCrypto(value) { Object.defineProperty(globalThis, 'crypto', { configurable: true, writable: true, value }); }
async function mount(samples = [], force2D = true) {
  root = createRoot(document.getElementById('test-root'));
  await act(async () => root.render(React.createElement(App, { samples, force2D })));
}
async function waitFor(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'Timed out waiting for actual App state');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  }
}
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
const selected = () => document.querySelector('[data-testid="selected-record-id"]')?.textContent;
const error = () => document.querySelector('[data-testid="import-error-banner"]')?.textContent;
const text = name => readFile('tests/fixtures/' + name, 'utf8');
function bytes(value) { return new TextEncoder().encode(value); }
function file(value, read) {
  const payload = bytes(value);
  const f = new dom.window.File([payload], 'synthetic-test.json', { type: 'application/json' });
  Object.defineProperty(f, 'arrayBuffer', { value: read || (async () => payload.slice().buffer) });
  return f;
}
async function begin(value) {
  const input = document.querySelector('input[type="file"]');
  Object.defineProperty(input, 'files', { configurable: true, value: [value] });
  await act(async () => input.dispatchEvent(new dom.window.Event('change', { bubbles: true })));
}
async function load(name = 'available-literal-study.json') {
  await begin(file(await text(name)));
  await waitFor(() => selected());
}
async function click(button) {
  assert.ok(button, 'Expected real DOM button');
  await act(async () => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
}
const buttonNamed = name => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === name);
async function selectId(id) {
  const row = [...document.querySelectorAll('.folio-CatalogueTable tbody tr')].find(r => r.cells[1].textContent === id);
  await click(row?.querySelector('button'));
}
function constantReport(n, specialIds = false) {
  return text('constant-serializer-golden.json').then(raw => {
    const data = JSON.parse(raw);
    data.input.row_ids = Array.from({ length: n }, (_, i) => 'p' + i.toString().padStart(4, '0'));
    if (specialIds) data.input.row_ids.splice(0, 4, '001', '__proto__', 'constructor', 'toString');
    data.input.row_ids.sort();
    data.input.values = Array.from({ length: n }, () => [...data.input.values[0]]);
    data.pca.scores3 = Array.from({ length: n }, () => [0, 0, 0]);
    data.work.planned_distance_entries = 2 * n * n;
    data.work.planned_neighbor_slots = 2 * n * data.plan.k;
    data.input.digest_sha256 = createHash('sha256').update(inputFrame(validateStudy(data))).digest('hex');
    return JSON.stringify(data);
  });
}

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = undefined;
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  setCrypto(webcrypto); globalThis.isSecureContext = true;
});
after(() => {
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
  dom.window.close();
});

test('real App imports, shares selected ID across catalogue and 2D, and keeps imported provenance unverified', async () => {
  await mount(); await load(); await selectId('p0001');
  assert.equal(selected(), 'p0001');
  assert.match(document.querySelector('[data-testid="study-provenance"]').textContent, /IMPORTED_ANALYSIS_UNVERIFIED/);
  const mark = [...document.querySelectorAll('.scene-SvgPointGroup')].find(g => g.querySelector('title')?.textContent === 'p0000');
  await click(mark); assert.equal(selected(), 'p0000');
  assert.equal(document.querySelectorAll('.folio-CatalogueTable tbody tr').length, 16);
});

test('File size is checked before reading and fatal UTF8 rejection preserves the current study', async () => {
  await mount(); await load(); await selectId('p0001');
  let reads = 0; const huge = file('', async () => { reads++; return new ArrayBuffer(0); });
  Object.defineProperty(huge, 'size', { value: 16777217 });
  await begin(huge); assert.equal(reads, 0); assert.match(error(), /FILE_TOO_LARGE/); assert.equal(selected(), 'p0001');
  await begin(file('', async () => new Uint8Array([255]).buffer));
  assert.match(error(), /INVALID_JSON/); assert.equal(selected(), 'p0001');
});

test('late File completion cannot replace a newer accepted study', async () => {
  await mount(); const a = deferred(), b = deferred();
  await begin(file('', () => a.promise)); await begin(file('', () => b.promise));
  await act(async () => b.resolve(bytes(await text('numeric-string-ids-study.json')).buffer));
  await waitFor(() => selected() === '001');
  await act(async () => a.resolve(bytes(await text('constant-serializer-golden.json')).buffer));
  assert.equal(selected(), '001'); assert.equal(document.querySelector('[data-testid="constant-input-sheet"]'), null);
});

test('a newer invalid File attempt revokes an older pending read and preserves the selected row', async () => {
  await mount(); await load(); await selectId('p0001'); const pending = deferred();
  await begin(file('', () => pending.promise));
  const huge = file(''); Object.defineProperty(huge, 'size', { value: 16777217 }); await begin(huge);
  await act(async () => pending.resolve(bytes(await text('constant-serializer-golden.json')).buffer));
  assert.equal(selected(), 'p0001'); assert.match(error(), /FILE_TOO_LARGE/);
});

test('late WebCrypto completion is owned by the same import epoch', async () => {
  await mount(); await load(); const digest = deferred(); let firstFrame;
  setCrypto({ subtle: { digest: (algorithm, frame) => {
    if (!firstFrame) { firstFrame = new Uint8Array(frame).slice(); return digest.promise; }
    return webcrypto.subtle.digest(algorithm, frame);
  } } });
  await begin(file(await text('constant-serializer-golden.json'))); await waitFor(() => firstFrame);
  await begin(file(await text('numeric-string-ids-study.json'))); await waitFor(() => selected() === '001');
  await act(async () => digest.resolve(await webcrypto.subtle.digest('SHA-256', firstFrame)));
  assert.equal(selected(), '001');
});

test('presentation changes do not hash again and successful replacement uses current selection', async () => {
  let digests = 0;
  setCrypto({ subtle: { digest: (algorithm, frame) => { digests++; return webcrypto.subtle.digest(algorithm, frame); } } });
  await mount(); await load(); const pending = deferred(); await begin(file('', () => pending.promise));
  await selectId('p0101'); await click(buttonNamed('EN'));
  const layer = [...document.querySelectorAll('.folio-LayerToggle')].find(b => b.textContent.includes('Introduced'));
  await click(layer); assert.equal(layer.getAttribute('aria-pressed'), 'false'); assert.equal(digests, 1);
  await act(async () => pending.resolve(bytes(await text('available-literal-study.json')).buffer));
  await waitFor(() => digests === 2 && !document.querySelector('[role="status"]'));
  assert.equal(selected(), 'p0101'); assert.match(document.body.textContent, /Selected record/);
  assert.equal([...document.querySelectorAll('.folio-LayerToggle')].find(b => b.textContent.includes('Introduced')).getAttribute('aria-pressed'), 'false');
});

test('locale switch updates the document language without recomputing an accepted study', async () => {
  // Missing ResizeObserver keeps the actual capability path in 2D; no GL mock.
  await mount([], false); await load();
  assert.deepEqual([
    document.querySelector('.folio-DiagnosticStrip').getAttribute('aria-label'),
    document.querySelector('.scene-ModeSwitch').getAttribute('aria-label')
  ], ['Diagnósticos do estudo', 'Modo de projeção']);
  await click(buttonNamed('EN'));
  assert.equal(document.documentElement.lang, 'en'); assert.match(document.body.textContent, /Selected record/);
  assert.deepEqual([
    document.querySelector('.folio-DiagnosticStrip').getAttribute('aria-label'),
    document.querySelector('.scene-ModeSwitch').getAttribute('aria-label')
  ], ['Study diagnostics', 'Projection view mode']);
});

for (const capability of ['missing', 'insecure']) test(`capability ${capability} preserves last valid study with a stable error`, async () => {
  await mount(); await load(); await selectId('p0001');
  if (capability === 'missing') setCrypto(undefined); else globalThis.isSecureContext = false;
  await begin(file(await text('numeric-string-ids-study.json')));
  await waitFor(() => error()); assert.match(error(), /CRYPTO_UNAVAILABLE/); assert.equal(selected(), 'p0001');
});

test('valid constant wire with4096rows does not create4096point-selection tab stops', async () => {
  await mount(); await begin(file(await constantReport(4096))); await waitFor(() => selected());
  assert.ok(document.querySelector('[data-testid="constant-input-sheet"]'));
  assert.ok(document.querySelectorAll('.scene-RecordChip').length <= 32);
  assert.equal(document.querySelectorAll('.folio-CatalogueTable tbody tr').length, 16);
});

test('prototype-like IDs and numeric strings keep literal identity including index0', async () => {
  await mount(); await begin(file(await constantReport(16, true))); await waitFor(() => selected());
  for (const id of ['001', '__proto__', 'constructor', 'toString']) { await selectId(id); assert.equal(selected(), id); }
});

test('actual SDK synthetic exports all traverse the real App digest/import path', async () => {
  await mount();
  for (const name of ['constant', 'weighted', 'tied']) {
    await begin(file(await readFile(`src/samples/${name}.study.json`, 'utf8')));
    await waitFor(() => selected() && !document.querySelector('.folio-StatusBanner.is-loading'));
    assert.equal(error(), undefined);
    assert.match(document.querySelector('[data-testid="study-provenance"]').textContent, /IMPORTED_ANALYSIS_UNVERIFIED/);
    assert.equal(Boolean(document.querySelector('[data-testid="constant-input-sheet"]')), name === 'constant');
  }
});

test('admitted unverified coincident geometry keeps the auxiliary point list bounded', async () => {
  // Deliberately edited display geometry, not a claim of an actual PCA fit.
  const data = JSON.parse(await readFile('src/samples/moderate-study.generated.json', 'utf8'));
  data.pca.scores3 = data.pca.scores3.map(() => [0, 0, 0]);
  await mount(); await begin(file(JSON.stringify(data))); await waitFor(() => selected());
  assert.match(document.querySelector('[data-testid="study-provenance"]').textContent, /IMPORTED_ANALYSIS_UNVERIFIED/);
  assert.ok(document.querySelectorAll('.scene-CoincidentChips button').length <= 32);
  assert.equal(document.querySelectorAll('.folio-CatalogueTable tbody tr').length, 16);
});
