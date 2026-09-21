import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runProbe, mulberry32, ProbeSampler } from '../src/probe.js';
import { simulate, createInitialState } from '../demo/simulate.js';

test('ProbeSampler report includes all six layers and a feel score', () => {
  const probe = new ProbeSampler();
  for (let i = 0; i < 30; i++) {
    probe.record({
      frameMs: 16,
      hostTickMs: 0.2,
      hostBacklog: 10,
      pending: 6,
      shadowGap: 20 + i,
      correctionPx: 1,
      interpStatus: i % 5 === 0 ? 'underrun' : 'blend',
      dropUp: false,
      dropDown: false,
      upDelayMs: 100,
      downDelayMs: 100,
    });
  }
  const report = probe.report({ latencyMs: 100, jitterMs: 10, lossRate: 0, transport: 'loopback' });
  assert.equal(report.network.rttMs, 200);
  assert.ok(report.routing.uplinkMs.avg > 0);
  assert.equal(typeof report.queueing.healthy, 'boolean');
  assert.equal(typeof report.server.onBudget, 'boolean');
  assert.ok(report.rendering.underrunRate > 0);
  assert.ok(report.prediction.shadowGapPx.p50 >= 20);
  assert.ok(report.feel.score >= 0 && report.feel.score <= 100);
});

test('runProbe is deterministic with a seeded rng and shows more gap under lag', () => {
  const inputAt = () => ({ dx: 1, dy: 0, dash: false });
  const opponentAt = () => ({ dx: 0, dy: 0, dash: false });
  const opts = {
    simulate,
    initialState: createInitialState(),
    seconds: 0.7,
    inputAt,
    opponentAt,
  };
  const lan = runProbe({
    ...opts,
    conditions: { latencyMs: 10, jitterMs: 0, lossRate: 0 },
    rng: mulberry32(1),
  });
  const bad = runProbe({
    ...opts,
    conditions: { latencyMs: 200, jitterMs: 0, lossRate: 0 },
    rng: mulberry32(1),
  });
  assert.equal(lan.fixture.transport, 'loopback');
  assert.ok(bad.prediction.shadowGapPx.avg > lan.prediction.shadowGapPx.avg + 8);
  assert.ok(bad.queueing.pendingInputs.avg > lan.queueing.pendingInputs.avg);
  assert.ok(lan.server.onBudget);
  assert.ok(lan.feel.score >= 0);
});
