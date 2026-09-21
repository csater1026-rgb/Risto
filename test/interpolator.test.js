import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RemoteInterpolator } from '../src/interpolator.js';

const lerp = (a, b, t) => a + (b - a) * t;

test('with no snapshots yet, sample returns null', () => {
  const interp = new RemoteInterpolator({ delayMs: 100 });
  assert.equal(interp.sample(1000, lerp), null);
});

test('with one snapshot, sample returns it directly', () => {
  const interp = new RemoteInterpolator({ delayMs: 100 });
  interp.push(5, 1000);
  assert.equal(interp.sample(1200, lerp), 5);
});

test('interpolates halfway between two bracketing snapshots', () => {
  const interp = new RemoteInterpolator({ delayMs: 100 });
  interp.push(0, 1000);
  interp.push(10, 1100);
  // renderTime = now - delay = 1150 - 100 = 1050, halfway between 1000 and 1100
  assert.equal(interp.sample(1150, lerp), 5);
});

test('clamps to the oldest snapshot when render time is before it', () => {
  const interp = new RemoteInterpolator({ delayMs: 100 });
  interp.push(0, 1000);
  interp.push(10, 1100);
  assert.equal(interp.sample(1000, lerp), 0); // renderTime = 900, before buffer
});

test('clamps to the newest snapshot when render time is after it', () => {
  const interp = new RemoteInterpolator({ delayMs: 100 });
  interp.push(0, 1000);
  interp.push(10, 1100);
  assert.equal(interp.sample(1300, lerp), 10); // renderTime = 1200, after buffer
});
