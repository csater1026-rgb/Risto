import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PredictionClient } from '../src/prediction-client.js';
import { AuthoritativeHost } from '../src/authoritative-host.js';

// A trivial 1D simulation: each player's input is a velocity, position
// integrates over dt. Deterministic and easy to reason about by hand.
function simulate(state, inputs, dt) {
  const next = { ...state };
  for (const [playerId, velocity] of Object.entries(inputs)) {
    const pos = next[playerId] ?? 0;
    next[playerId] = pos + velocity * dt;
  }
  return next;
}

test('local prediction applies input immediately, before any snapshot arrives', () => {
  const client = new PredictionClient({
    simulate,
    playerId: 'p1',
    initialState: { p1: 0 },
  });

  const { state } = client.applyLocalInput(1, 10);
  assert.equal(state.p1, 10);
  assert.equal(client.pendingInputCount, 1);
});

test('reconcile replays unacknowledged inputs on top of the authoritative snapshot', () => {
  const client = new PredictionClient({
    simulate,
    playerId: 'p1',
    initialState: { p1: 0 },
  });

  client.applyLocalInput(1, 10); // seq 0 -> predicted p1 = 10
  client.applyLocalInput(1, 10); // seq 1 -> predicted p1 = 20
  client.applyLocalInput(1, 10); // seq 2 -> predicted p1 = 30

  // Host has only processed seq 0 so far (its snapshot lags behind).
  const reconciled = client.reconcile({
    state: { p1: 10 },
    lastProcessedSeq: { p1: 0 },
  });

  // seq 0 is acknowledged and dropped; seq 1 and seq 2 (still unacked) are
  // replayed on top of the host's state -> 10 + 10 + 10 = 30, matching what
  // the player already saw locally (no visible correction/rewind).
  assert.equal(reconciled.p1, 30);
  assert.equal(client.pendingInputCount, 2);
});

test('reconcile corrects a misprediction instead of just trusting local state', () => {
  const client = new PredictionClient({
    simulate,
    playerId: 'p1',
    initialState: { p1: 0 },
  });

  client.applyLocalInput(1, 10); // seq 0, client predicted p1 = 10

  // Host disagrees — say a collision the client didn't predict happened,
  // so the authoritative result after processing seq 0 was actually 4.
  const reconciled = client.reconcile({
    state: { p1: 4 },
    lastProcessedSeq: { p1: 0 },
  });

  assert.equal(reconciled.p1, 4);
  assert.equal(client.pendingInputCount, 0);
});

test('a host restart permanently stalls reconcile() until reset() is called', () => {
  const client = new PredictionClient({
    simulate,
    playerId: 'p1',
    initialState: { p1: 0 },
  });

  // Client has already reconciled against a high tick from an old host session.
  client.reconcile({ state: { p1: 100 }, lastProcessedSeq: { p1: 0 }, tick: 500 });
  assert.equal(client.getState().p1, 100);

  // A brand new AuthoritativeHost starts its tick counter over at 0 — every
  // snapshot from it looks "older" than tick 500 and is silently ignored,
  // exactly documenting the trap reset() exists to escape.
  const stalled = client.reconcile({ state: { p1: 999 }, lastProcessedSeq: { p1: 0 }, tick: 0 });
  assert.equal(stalled.p1, 100); // unchanged — discarded as stale

  // reset() explicitly forgets the old session's watermark and resyncs.
  client.reset({ p1: 999 });
  assert.equal(client.getState().p1, 999);
  assert.equal(client.pendingInputCount, 0);

  // Now the new host's ticks are accepted normally.
  const resumed = client.reconcile({ state: { p1: 1000 }, lastProcessedSeq: { p1: 0 }, tick: 1 });
  assert.equal(resumed.p1, 1000);
});

test('end-to-end: host and client converge after several ticks', () => {
  const host = new AuthoritativeHost({ simulate, initialState: { p1: 0 } });
  const client = new PredictionClient({
    simulate,
    playerId: 'p1',
    initialState: { p1: 0 },
  });

  for (let i = 0; i < 5; i++) {
    const { seq } = client.applyLocalInput(2, 10);
    host.receiveInput('p1', seq, 2);
    const snapshot = host.tick(10);
    client.reconcile(snapshot);
  }

  assert.equal(host.getSnapshot().state.p1, 100);
  assert.equal(client.getState().p1, 100);
  assert.equal(client.pendingInputCount, 0);
});

test('reconcile ignores a stale, out-of-order snapshot instead of rolling back', () => {
  const client = new PredictionClient({
    simulate,
    playerId: 'p1',
    initialState: { p1: 0 },
  });
  client.applyLocalInput(1, 10); // seq 0

  // Snapshot from the later tick arrives first (its twin from an earlier
  // tick got delayed more by jitter and is still in flight).
  const newer = client.reconcile({
    state: { p1: 10 },
    lastProcessedSeq: { p1: 0 },
    tick: 5,
  });
  assert.equal(newer.p1, 10);

  // The earlier-tick snapshot now arrives, reordered. Applying it naively
  // would roll the player's position backward; it should be ignored.
  const stale = client.reconcile({
    state: { p1: -100 },
    lastProcessedSeq: { p1: 0 },
    tick: 3,
  });
  assert.equal(stale.p1, 10);
});

test('getSnapshot() between ticks reports lastProcessedSeq consistent with state, not ahead of it', () => {
  const host = new AuthoritativeHost({ simulate, initialState: { p1: 0 } });

  host.receiveInput('p1', 0, 5); // staged, not yet applied
  const before = host.getSnapshot();
  assert.equal(before.state.p1, 0);
  assert.equal(before.lastProcessedSeq.p1 ?? -1, -1);

  host.tick(10); // seq 0 actually applied now: state.p1 = 0 + 5*10 = 50
  host.receiveInput('p1', 1, 5); // seq 1 staged, not yet applied

  // Taken between ticks (no intervening tick() for seq 1) — must still
  // describe what `state` actually reflects (seq 0), not the seq just
  // received. Before the fix, receiveInput() advanced this immediately on
  // receipt, so this would have incorrectly reported seq 1 here.
  const between = host.getSnapshot();
  assert.equal(between.state.p1, 50);
  assert.equal(between.lastProcessedSeq.p1, 0);
});

test('stale or duplicate inputs are ignored by the host', () => {
  const host = new AuthoritativeHost({ simulate, initialState: { p1: 0 } });
  host.receiveInput('p1', 5, 3);
  host.receiveInput('p1', 5, 999); // duplicate seq, ignored
  host.receiveInput('p1', 2, 999); // stale (older) seq, ignored
  const snapshot = host.tick(1);
  assert.equal(snapshot.state.p1, 3);
  assert.equal(snapshot.lastProcessedSeq.p1, 5);
});
