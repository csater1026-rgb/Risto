import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, createInitialState, RING, RADIUS, isOut, DASH_COOLDOWN_MS, CLASH_SPEED } from '../demo/simulate.js';

test('held input moves p1 and leaves a frozen p2 still', () => {
  const start = createInitialState();
  start.phase = 'play';
  const next = simulate(start, { p1: { dx: 1, dy: 0 } }, 100);
  assert.ok(next.p1.x > start.p1.x);
  assert.equal(next.p2.x, start.p2.x);
  assert.equal(next.p2.y, start.p2.y);
});

test('present zero input still integrates (friction), missing input freezes', () => {
  const moving = {
    ...createInitialState(),
    phase: 'play',
    p1: { x: RING.cx, y: RING.cy, vx: 100, vy: 0 },
    p2: { x: RING.cx + 80, y: RING.cy, vx: 100, vy: 0 },
  };
  const withZero = simulate(moving, { p1: { dx: 0, dy: 0 }, p2: { dx: 0, dy: 0 } }, 50);
  const frozen = simulate(moving, { p1: { dx: 0, dy: 0 } }, 50);
  assert.ok(withZero.p2.x !== moving.p2.x, 'coasting p2 should move');
  assert.equal(frozen.p2.x, moving.p2.x);
});

test('overlapping discs separate and pick up opposing velocity', () => {
  const start = createInitialState();
  start.phase = 'play';
  start.p1 = { x: RING.cx - 10, y: RING.cy, vx: 80, vy: 0 };
  start.p2 = { x: RING.cx + 10, y: RING.cy, vx: -80, vy: 0 };
  const next = simulate(start, { p1: { dx: 0, dy: 0 }, p2: { dx: 0, dy: 0 } }, 16);
  assert.ok(Math.hypot(next.p2.x - next.p1.x, next.p2.y - next.p1.y) >= RADIUS * 2 - 0.01);
  assert.ok(next.p1.vx < start.p1.vx);
  assert.ok(next.p2.vx > start.p2.vx);
  assert.equal(next.hit, 1);
});

test('leaving the ring awards a point and enters ko', () => {
  const start = createInitialState();
  start.phase = 'play';
  start.p2 = { x: RING.cx + RING.r + 20, y: RING.cy, vx: 0, vy: 0 };
  const next = simulate(start, { p1: { dx: 0, dy: 0 }, p2: { dx: 0, dy: 0 } }, 16);
  assert.equal(next.phase, 'ko');
  assert.equal(next.lastKo, 'p2');
  assert.equal(next.scores.p1, 1);
  assert.equal(next.scores.p2, 0);
  assert.equal(isOut(start.p2), true);
});

test('ko timer resets bodies into countdown, then play', () => {
  let state = createInitialState();
  state.phase = 'play';
  state.p1 = { x: RING.cx - RING.r - 30, y: RING.cy, vx: 0, vy: 0 };
  state = simulate(state, { p1: { dx: 0, dy: 0 }, p2: { dx: 0, dy: 0 } }, 16);
  assert.equal(state.phase, 'ko');
  state = simulate(state, { p1: { dx: 1, dy: 0 }, p2: { dx: 1, dy: 0 } }, 900);
  assert.equal(state.phase, 'countdown');
  assert.equal(state.p1.x, RING.cx - 72);
  state = simulate(state, {}, 750);
  assert.equal(state.phase, 'play');
});

test('ring current drifts a standing body even with zero stick', () => {
  const start = createInitialState();
  start.phase = 'play';
  start.p1 = { x: RING.cx + 80, y: RING.cy, vx: 0, vy: 0, dashCd: 0 };
  const next = simulate(start, { p1: { dx: 0, dy: 0 } }, 200);
  assert.ok(Math.abs(next.p1.y - start.p1.y) > 1, 'current should rotate the body');
});

test('dash spends the cooldown and overspeeds', () => {
  const start = createInitialState();
  start.phase = 'play';
  const dashed = simulate(start, { p1: { dx: 1, dy: 0, dash: true } }, 16);
  const walked = simulate(start, { p1: { dx: 1, dy: 0, dash: false } }, 16);
  assert.ok(dashed.p1.vx > walked.p1.vx + 200);
  assert.ok(dashed.p1.dashCd > DASH_COOLDOWN_MS - 20);
  const again = simulate(dashed, { p1: { dx: 1, dy: 0, dash: true } }, 16);
  assert.ok(again.p1.dashCd < dashed.p1.dashCd);
  assert.ok(again.p1.dashCd > 0, 'cooldown should still be ticking');
});

test('a hard clash near the lip kicks the outer disc outward', () => {
  const start = createInitialState();
  start.phase = 'play';
  start.p1 = { x: RING.cx + 110, y: RING.cy, vx: 280, vy: 0, dashCd: 0 };
  start.p2 = { x: RING.cx + 140, y: RING.cy, vx: -40, vy: 0, dashCd: 0 };
  const next = simulate(start, { p1: { dx: 0, dy: 0 }, p2: { dx: 0, dy: 0 } }, 16);
  assert.ok(next.clash > CLASH_SPEED, `expected a clash, got ${next.clash}`);
  assert.ok(next.p2.vx > 50, 'outer disc should be thrown toward the rim');
});
