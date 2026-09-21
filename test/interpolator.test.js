import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RemoteInterpolator, interpolationDelayMs } from '../src/interpolator.js';

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
  const interp = new RemoteInterpolator({ delayMs: 100, maxExtrapolateMs: 0 });
  interp.push(0, 1000);
  interp.push(10, 1100);
  assert.equal(interp.sample(1300, lerp), 10); // renderTime = 1200, after buffer
  assert.equal(interp.lastStatus, 'underrun');
});

test('lastStatus is empty, hold, then blend', () => {
  const interp = new RemoteInterpolator({ delayMs: 100 });
  assert.equal(interp.lastStatus, 'empty');
  interp.push(0, 1000);
  interp.sample(1200, lerp);
  assert.equal(interp.lastStatus, 'hold');
  interp.push(10, 1100);
  interp.sample(1150, lerp);
  assert.equal(interp.lastStatus, 'blend');
});

test('stamping with send-time under lag underruns; arrival time blends', () => {
  const delayMs = 100;
  const lerpN = (a, b, t) => a + (b - a) * t;
  // Host sent at t=1000/1100; packets arrive 280ms later.
  const send = new RemoteInterpolator({ delayMs, maxExtrapolateMs: 0 });
  send.push(0, 1000);
  send.push(10, 1100);
  send.sample(1380, lerpN);
  assert.equal(send.lastStatus, 'underrun');

  const arrival = new RemoteInterpolator({ delayMs });
  arrival.push(0, 1280);
  arrival.push(10, 1330);
  const value = arrival.sample(1380, lerpN); // renderTime = 1280
  assert.equal(arrival.lastStatus, 'hold'); // exactly on oldest
  const mid = arrival.sample(1405, lerpN); // renderTime = 1305, between 1280 and 1330
  assert.equal(arrival.lastStatus, 'blend');
  assert.ok(mid > 0 && mid < 10, `expected a blend between 0 and 10, got ${mid}`);
  void value;
});

test('extrapolates a short way past the newest snapshot', () => {
  const interp = new RemoteInterpolator({ delayMs: 100, maxExtrapolateMs: 80 });
  interp.push(0, 1000);
  interp.push(10, 1100);
  // renderTime = 1200, 100ms past newest, capped to span (100) and max (80)
  const value = interp.sample(1300, lerp);
  assert.equal(interp.lastStatus, 'underrun'); // extra 80 < overrun 100
  assert.ok(value > 10 && value <= 18, `expected a short coast past 10, got ${value}`);
});

test('interpolationDelayMs covers two ticks plus jitter', () => {
  assert.equal(interpolationDelayMs(50, 0), 100);
  assert.equal(interpolationDelayMs(50, 70), 140);
});

test('push ignores a stale, out-of-order snapshot instead of corrupting the buffer', () => {
  const interp = new RemoteInterpolator({ delayMs: 100, maxExtrapolateMs: 0 });
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
