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
  assert.equal(interp.lastStatus, 'underrun');
});

test('push ignores a stale, out-of-order snapshot instead of corrupting the buffer', () => {
  const interp = new RemoteInterpolator({ delayMs: 100 });
  interp.push(0, 1000);
  interp.push(10, 1100);
  interp.push(20, 1200);

  // A snapshot from *before* the newest one arrives late (reordered by
  // jitter in flight). It must be dropped, not appended out of order.
  interp.push(999, 1050);

  // Still exactly the three in-order snapshots: sampling well past the
  // newest one should clamp to it (20), not to the bogus 999 value.
  assert.equal(interp.sample(1400, lerp), 20);
});

test('push ignores an exact duplicate timestamp', () => {
  const interp = new RemoteInterpolator({ delayMs: 100 });
  interp.push(0, 1000);
  interp.push(999, 1000); // same timestamp as the newest entry — dropped
  assert.equal(interp.sample(1300, lerp), 0);
});
