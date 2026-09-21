import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CorrectionSmoother } from '../src/correction-smoother.js';

test('apply eases an offset toward zero without changing the sim target', () => {
  const s = new CorrectionSmoother({ decay: 20 });
  s.note({ x: 10, y: 0 }, { x: 0, y: 0 }); // visual was 10 ahead of truth
  const first = s.apply({ x: 0, y: 0 }, 0);
  assert.equal(first.x, 10);
  const later = s.apply({ x: 0, y: 0 }, 1);
  assert.ok(later.x < 1, `expected decay, got ${later.x}`);
  assert.ok(later.x >= 0);
});

test('large discontinuities snap instead of sliding across the arena', () => {
  const s = new CorrectionSmoother({ snapDistance: 80 });
  s.note({ x: 0, y: 0 }, { x: 200, y: 0 });
  const drawn = s.apply({ x: 200, y: 0 }, 0);
  assert.equal(drawn.x, 200);
  assert.equal(s.ox, 0);
});

test('reset clears outstanding error', () => {
  const s = new CorrectionSmoother();
  s.note({ x: 5, y: 5 }, { x: 0, y: 0 });
  s.reset();
  const drawn = s.apply({ x: 0, y: 0 }, 0.016);
  assert.equal(drawn.x, 0);
  assert.equal(drawn.y, 0);
});
