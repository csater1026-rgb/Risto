import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PredictedView, createLoopbackSession } from '../src/session.js';
import { lerpPose } from '../src/interpolator.js';

function simulate(state, inputs, dt) {
  const s = dt / 1000;
  const step = (p, inp) => {
    if (!inp) return { ...p };
    return {
      x: p.x + (inp.dx ?? 0) * 100 * s,
      y: p.y + (inp.dy ?? 0) * 100 * s,
    };
  };
  return {
    p1: step(state.p1, inputs.p1),
    p2: step(state.p2, inputs.p2),
  };
}

const initialState = { p1: { x: 0, y: 0 }, p2: { x: 40, y: 0 } };

test('PredictedView predicts locally and stamps remotes on arrival', () => {
  const view = new PredictedView({ simulate, playerId: 'p1', initialState, delayMs: 100 });
  view.applyLocalInput({ dx: 1, dy: 0 }, 50);
  assert.equal(view.client.getState().p1.x, 5);
  assert.equal(view.client.pendingInputCount, 1);

  view.ingest(
    {
      state: { p1: { x: 5, y: 0 }, p2: { x: 50, y: 2 } },
      lastProcessedSeq: { p1: 0 },
      tick: 1,
      timestamp: 1000,
    },
    1200,
  );
  assert.equal(view.shadow.sample().x, 5);
  assert.equal(view.remote._buffer[0].timestamp, 1200);

  view.ingest(
    {
      state: { p1: { x: 10, y: 0 }, p2: { x: 60, y: 2 } },
      lastProcessedSeq: { p1: 0 },
      tick: 2,
      timestamp: 1050,
    },
    1250,
  );
  const sampled = view.sample(1325, 0, lerpPose);
  assert.equal(sampled.interpStatus, 'blend');
  assert.ok(sampled.them.x > 50 && sampled.them.x < 60);
});

test('createLoopbackSession moves the local player under loopback lag', async () => {
  const session = createLoopbackSession({
    simulate,
    initialState,
    conditions: { latencyMs: 0, jitterMs: 0, lossRate: 0 },
    hostTickMs: 50,
    delayMs: 100,
  });
  session.applyLocalInput({ dx: 1, dy: 0 }, 50);
  session.stepHost(50, { p2: { dx: 0, dy: 0 } }, { drop: false, delayMs: 0 });
  await new Promise((r) => setTimeout(r, 20));
  const view = session.sample(Date.now(), 0);
  assert.ok(view.you.x > 0, `expected predicted p1 to have moved, x=${view.you.x}`);
  assert.ok(session.lastHostTickMs > 0);
  const tel = session.telemetry(16, view.shadowGap);
  assert.equal(typeof tel.pending, 'number');
  assert.equal(typeof tel.interpStatus, 'string');
});
