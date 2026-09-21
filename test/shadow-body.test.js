import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShadowBody } from '../src/shadow-body.js';

test('sample is null until the first host pose arrives', () => {
  const shadow = new ShadowBody();
  assert.equal(shadow.sample(), null);
});

test('push keeps the newest pose and ignores a reordered older one', () => {
  const shadow = new ShadowBody();
  shadow.push({ x: 1, y: 2 }, 100);
  shadow.push({ x: 8, y: 9 }, 200);
  shadow.push({ x: 99, y: 99 }, 150); // stale
  assert.deepEqual(shadow.sample(), { x: 8, y: 9 });
});

test('gap is the distance between predicted pixels and the host pose', () => {
  assert.equal(ShadowBody.gap({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  assert.equal(ShadowBody.gap({ x: 1, y: 1 }, null), 0);
});
