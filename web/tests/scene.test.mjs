import test from 'node:test';
import assert from 'node:assert/strict';
import { computeBoundedDpr } from '../src/ProjectionScene';

test('drawing pixel budget holds for ordinary and very large finite viewports', () => {
  for (const [width, height, ratio] of [[800, 540, 2], [10000, 10000, 2], [30000, 6000, 1]]) {
    const dpr = computeBoundedDpr(width, height, ratio);
    assert.ok(Number.isFinite(dpr) && dpr > 0 && dpr <= 2);
    assert.ok(Math.floor(width * dpr) * Math.floor(height * dpr) <= 4194304);
  }
});

test('zero-sized viewport never divides by zero or emits a nonfinite DPR', () => {
  for (const size of [[0, 400], [400, 0], [0, 0]]) {
    const dpr = computeBoundedDpr(...size, 2);
    assert.ok(Number.isFinite(dpr) && dpr > 0 && dpr <= 2);
  }
});
