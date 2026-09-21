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

test('delayMs smaller than real transit latency silently defeats interpolation', () => {
  // Models a snapshot produced every 50ms (a realistic host tick) that
  // takes a 150ms one-way trip to arrive — sample() is called the instant
  // each one arrives, which is the worst (most common) case in practice.
  const oneWayLatencyMs = 150;
  const hostTickMs = 50;
  const interp = new RemoteInterpolator({ delayMs: 100 }); // < 150: too small

  let everBlended = false;
  for (let i = 0; i < 20; i++) {
    const producedAt = i * hostTickMs;
    interp.push(i, producedAt);
    const arrivesAt = producedAt + oneWayLatencyMs;
    const result = interp.sample(arrivesAt, lerp);
    // A genuinely blended value between two integer states is never an
    // integer itself (barring t landing exactly on 0 or 1, vanishingly
    // unlikely here); clamping to the newest snapshot always returns i
    // exactly.
    if (!Number.isInteger(result)) everBlended = true;
  }

  assert.equal(
    everBlended,
    false,
    'expected delayMs=100 < 150ms latency to never actually interpolate (this documents the failure mode setDelayMs must be used to avoid)'
  );
});

test('setDelayMs above real transit latency restores actual interpolation', () => {
  const oneWayLatencyMs = 150;
  const hostTickMs = 50;
  const interp = new RemoteInterpolator({ delayMs: 100 });
  interp.setDelayMs(oneWayLatencyMs + hostTickMs * 2); // comfortably above latency

  let everBlended = false;
  for (let i = 0; i < 20; i++) {
    const producedAt = i * hostTickMs;
    interp.push(i, producedAt);
    // +13ms: in the real demo, render frames never land exactly on a host
    // tick boundary. Sampling at a perfectly tick-aligned time is a
    // degenerate case where t lands exactly on 0 or 1 and the "blended"
    // result is indistinguishable from a clamp — this offset avoids that
    // artifact of the test's own arithmetic, not a real library concern.
    const arrivesAt = producedAt + oneWayLatencyMs + 13;
    const result = interp.sample(arrivesAt, lerp);
    if (!Number.isInteger(result)) everBlended = true;
  }

  assert.equal(everBlended, true);
});
