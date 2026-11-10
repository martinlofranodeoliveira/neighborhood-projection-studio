import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import { readStudy, validateStudy, inputFrame, createImportLease } from '../src/study.ts';
import { displayPositions, selectedRelations } from '../src/view.ts';

const fixtureRoot = 'tests/fixtures/';
const corpus = JSON.parse(await readFile(fixtureRoot + 'cases.json', 'utf8'));
const textOf = file => readFile(fixtureRoot + file, 'utf8');

// Independent test framing, not the implementation being tested.
function oracleDigest(study) {
  const encoder = new TextEncoder();
  const parts = [encoder.encode('NPSinput1\0')];
  const n = study.input.row_ids.length, d = study.input.feature_names.length;
  const shape = new Uint8Array(6), shapeView = new DataView(shape.buffer);
  shapeView.setUint32(0, n, true); shapeView.setUint16(4, d, true); parts.push(shape);
  function string(value) {
    const bytes = encoder.encode(value), length = new Uint8Array(2);
    new DataView(length.buffer).setUint16(0, bytes.length, true); parts.push(length, bytes);
  }
  study.input.feature_names.forEach(string);
  for (let i = 0; i < n; i++) {
    string(study.input.row_ids[i]);
    const values = new Uint8Array(8 * d), view = new DataView(values.buffer);
    for (let j = 0; j < d; j++) view.setFloat64(8 * j, study.input.values[i][j] === 0 ? 0 : study.input.values[i][j], true);
    parts.push(values);
  }
  return createHash('sha256').update(Buffer.concat(parts)).digest('hex');
}

function at(root, path) { return path.reduce((value, key) => value[key], root); }
function rename(value, oldId, newId) {
  if (Array.isArray(value)) return value.map(v => rename(v, oldId, newId));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rename(v, oldId, newId)]));
  return value === oldId ? newId : value;
}
function mutate(base, operations) {
  let value = structuredClone(base), token;
  for (const op of operations) {
    if (op.op === 'rename_id') {
      value = rename(value, op.old, op.new);
      if (op.refresh_input_digest) value.input.digest_sha256 = oracleDigest(value);
    } else if (op.op === 'refresh_input_digest') {
      value.input.digest_sha256 = oracleDigest(value);
    } else if (op.op === 'swap') {
      const list = at(value, op.path), [a, b] = op.indices;
      [list[a], list[b]] = [list[b], list[a]];
    } else {
      const parent = at(value, op.path.slice(0, -1)), key = op.path.at(-1);
      if (op.op === 'set') parent[key] = structuredClone(op.value);
      else if (op.op === 'delete') delete parent[key];
      else if (op.op === 'set_json_number_token') {
        assert.equal(op.token, '1e400');
        token = '__ORACLE_NONFINITE_NUMBER__'; parent[key] = token;
      } else throw new Error('Unknown fixed corpus operation');
    }
  }
  const text = JSON.stringify(value);
  return token ? text.replace(JSON.stringify(token), '1e400') : text;
}

for (const c of corpus.cases.filter(c => c.kind === 'ACCEPT')) {
  test(`import accepts literal fixture: ${c.id}`, async () => {
    const study = await readStudy(await textOf(c.base), webcrypto);
    assert.equal(study.input.row_ids.length, c.postconditions.all_rows_available_for_DOM_inspection);
    assert.equal(createHash('sha256').update(inputFrame(study)).digest('hex'), study.input.digest_sha256);
    assert.equal(Object.isFrozen(study), true);
    if (c.postconditions.first_id) assert.equal(study.input.row_ids[0], c.postconditions.first_id);
  });
}
for (const c of corpus.cases.filter(c => c.kind === 'REJECT')) {
  test(`import rejects corpus counterexample: ${c.id}`, async () => {
    const base = JSON.parse(await textOf(c.base));
    await assert.rejects(() => readStudy(mutate(base, c.operations), webcrypto));
  });
}

test('duplicate schema object members follow native last-member-wins before closed validation', async () => {
  const text = (await textOf('available-literal-study.json')).trim();
  const correct = JSON.parse(text).schema;
  const withWrongFirst = '{"schema":"wrong",' + text.slice(1);
  const withWrongLast = text.slice(0, -1) + ',"schema":"wrong"}';
  assert.equal((await readStudy(withWrongFirst, webcrypto)).schema, correct);
  await assert.rejects(() => readStudy(withWrongLast, webcrypto));
});

test('real bundled SDK export traverses the same read and digest path', async () => {
  const text = await readFile('src/samples/moderate-study.generated.json', 'utf8');
  const study = await readStudy(text, webcrypto);
  assert.equal(study.input.row_ids.length, 64);
  assert.equal(study.plan.k, 5);
});

test('lease revokes pending File and digest completions, including a newer invalid attempt', () => {
  const lease = createImportLease();
  const oldFile = lease.begin(); const oldDigest = lease.begin();
  assert.equal(lease.owns(oldFile), false); assert.equal(lease.owns(oldDigest), true);
  const newerInvalid = lease.begin();
  assert.equal(lease.owns(oldDigest), false); assert.equal(lease.owns(newerInvalid), true);
  lease.revoke(); assert.equal(lease.owns(newerInvalid), false);
  const next = lease.begin(); assert.notEqual(next, newerInvalid);
});

test('selected relations preserve exact IDs and canonical study bytes', async () => {
  const original = JSON.parse(await textOf('available-literal-study.json'));
  const study = validateStudy(original), before = JSON.stringify(study);
  const relations = selectedRelations(study, 'p0001');
  assert.deepEqual(new Set(relations.map(r => r.id)), new Set(['p0000', 'p0010', 'p0011']));
  assert.equal(JSON.stringify(study), before);
  assert.equal(study.neighborhood.total_penalty, 8);
  assert.deepEqual(study.neighborhood.trustworthiness_fraction, { numerator: 49, denominator: 50 });
});

test('CPU display normalization handles tiny and extreme finite coordinates before Float32', () => {
  for (const scores of [
    [[-1e-160, 0, 0], [1e-160, 0, 0]],
    [[-1e308, 1e308, 0], [1e308, -1e308, 0]],
    [[1e308, 1e308, 1e308], [1e308, 1e308, 1e308]],
    [[1e308, 0, 0], [1e308, Number.MIN_VALUE, 0]]
  ]) {
    const before = structuredClone(scores), positions = displayPositions(scores);
    assert.equal(positions.length, scores.length);
    for (const row of positions) for (const value of row) {
      assert.equal(Number.isFinite(value), true); assert.equal(Number.isFinite(Math.fround(value)), true);
    }
    assert.deepEqual(scores, before);
    if (scores[0].every((v, i) => v === scores[1][i])) assert.deepEqual(positions[0], positions[1]);
  }
});
