/**
 * One netcode gym for game devs.
 *
 * This is not Wireshark, a CDN, or a GPU profiler. It is a synthetic
 * probe that records the six layers Risto actually owns, from the same
 * run: injected network, uplink vs downlink path, queues, host tick
 * cost, client frame/interpolator health, and prediction accuracy
 * (Shadow Body gap + correction size).
 *
 * `ProbeSampler` attaches to a live session (the demo).
 * `runProbe` is the headless CI version — same report shape, virtual
 * clock, no DOM, injectable RNG.
 */

import { AuthoritativeHost } from './authoritative-host.js';
import { PredictionClient } from './prediction-client.js';
import { RemoteInterpolator } from './interpolator.js';
import { CorrectionSmoother } from './correction-smoother.js';
import { ShadowBody } from './shadow-body.js';
import { rollDelivery } from './network-link.js';

export function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function summarize(values) {
  const n = values.length;
  const avg = n ? values.reduce((a, b) => a + b, 0) / n : 0;
  return {
    n,
    avg: round(avg, 3),
    p50: round(percentile(values, 50), 3),
    p95: round(percentile(values, 95), 3),
    max: round(n ? Math.max(...values) : 0, 3),
  };
}

export class ProbeSampler {
  /** @param {{ window?: number }} [opts] */
  constructor({ window = 240 } = {}) {
    this.window = window;
    /** @type {object[]} */
    this.samples = [];
  }

  /** @param {object} sample */
  record(sample) {
    this.samples.push(sample);
    if (this.samples.length > this.window) this.samples.shift();
  }

  reset() {
    this.samples.length = 0;
  }

  /**
   * @param {{ latencyMs?: number, jitterMs?: number, lossRate?: number, transport?: string }} [fixture]
   */
  report(fixture = {}) {
    const s = this.samples;
    const nums = (key) => s.map((row) => Number(row[key] ?? 0));
    const dropsUp = s.filter((row) => row.dropUp).length;
    const dropsDown = s.filter((row) => row.dropDown).length;
    const underruns = s.filter((row) => row.interpStatus === 'underrun').length;
    const blends = s.filter((row) => row.interpStatus === 'blend').length;
    const latencyMs = fixture.latencyMs ?? 0;
    const frameMs = summarize(nums('frameMs'));
    const tickMs = summarize(nums('hostTickMs'));
    const pending = summarize(nums('pending'));
    const gap = summarize(nums('shadowGap'));
    const correction = summarize(nums('correctionPx'));
    const backlog = summarize(nums('hostBacklog'));
    const up = summarize(nums('upDelayMs'));
    const down = summarize(nums('downDelayMs'));
    const expectedPending = Math.max(1, Math.round((latencyMs * 2) / Math.max(8, frameMs.avg || 16)));
    const underrunRate = s.length ? underruns / s.length : 0;
    const blendRate = s.length ? blends / s.length : 0;

    const report = {
      fixture: {
        latencyMs,
        jitterMs: fixture.jitterMs ?? 0,
        lossRate: fixture.lossRate ?? 0,
        transport: fixture.transport ?? 'loopback',
        samples: s.length,
      },
      network: {
        latencyMs,
        jitterMs: fixture.jitterMs ?? 0,
        lossRate: fixture.lossRate ?? 0,
        rttMs: latencyMs * 2,
        dropRateUp: round(s.length ? dropsUp / s.length : 0, 4),
        dropRateDown: round(s.length ? dropsDown / s.length : 0, 4),
      },
      routing: {
        transport: fixture.transport ?? 'loopback',
        uplinkMs: up,
        downlinkMs: down,
        asymmetryMs: round(Math.abs(up.avg - down.avg), 2),
        note: 'Synthetic path (injected delay/loss per hop), not BGP/NAT/TURN.',
      },
      queueing: {
        pendingInputs: pending,
        expectedPending,
        hostBacklogMs: backlog,
        healthy: pending.p95 <= expectedPending * 3 + 4,
      },
      server: {
        tickMs,
        hitchCount: s.filter((row) => row.hostTickMs > 8).length,
        onBudget: tickMs.p95 < 8,
      },
      rendering: {
        frameMs,
        underrunRate: round(underrunRate, 4),
        blendRate: round(blendRate, 4),
        interpStatus: s.length ? s[s.length - 1].interpStatus : 'empty',
      },
      prediction: {
        shadowGapPx: gap,
        correctionPx: correction,
        note: 'Gap is predicted-you minus host-you. Large under lag is expected; jumpy correction is not.',
      },
    };
    report.feel = feelScore(report);
    return report;
  }
}

/**
 * Headless, deterministic probe. Same report as the live sampler.
 * Uses a virtual clock and an in-memory mailbox so CI does not depend
 * on setTimeout or a browser.
 *
 * @param {{
 *   simulate: Function,
 *   initialState: unknown,
 *   playerId?: string,
 *   opponentId?: string,
 *   seconds?: number,
 *   frameMs?: number,
 *   hostTickMs?: number,
 *   conditions?: { latencyMs?: number, jitterMs?: number, lossRate?: number },
 *   inputAt?: (t: number, state: unknown) => unknown,
 *   opponentAt?: (t: number, state: unknown) => unknown,
 *   rng?: () => number,
 *   getPos?: (state: unknown, id: string) => { x: number, y: number } | null,
 * }} opts
 */
export function runProbe(opts) {
  const simulate = opts.simulate;
  const playerId = opts.playerId ?? 'p1';
  const opponentId = opts.opponentId ?? 'p2';
  const seconds = opts.seconds ?? 3;
  const frameMs = opts.frameMs ?? 16;
  const hostTickMs = opts.hostTickMs ?? 50;
  const conditions = opts.conditions ?? { latencyMs: 100, jitterMs: 10, lossRate: 0 };
  const inputAt = opts.inputAt ?? (() => ({}));
  const opponentAt = opts.opponentAt ?? (() => ({}));
  const rng = opts.rng ?? Math.random;
  const getPos = opts.getPos ?? defaultGetPos;
  const lerp = opts.lerp ?? lerpXY;

  let clock = 1_000_000;
  const host = new AuthoritativeHost({
    simulate,
    initialState: opts.initialState,
    now: () => clock,
  });
  const client = new PredictionClient({
    simulate,
    playerId,
    initialState: opts.initialState,
  });
  const remote = new RemoteInterpolator({
    delayMs: Math.max(hostTickMs * 2, hostTickMs + (conditions.jitterMs ?? 0) + 20),
  });
  const smoother = new CorrectionSmoother();
  const shadow = new ShadowBody();
  const up = new Mailbox();
  const down = new Mailbox();
  const sampler = new ProbeSampler({ window: 10_000 });

  let hostAcc = 0;
  let botSeq = 0;
  let lastDown = { drop: false, delayMs: 0 };
  const frames = Math.ceil((seconds * 1000) / frameMs);

  for (let i = 0; i < frames; i++) {
    const t0 = nowNs();
    const input = inputAt(clock, client.getState());
    const { seq } = client.applyLocalInput(input, frameMs);
    const toHost = rollDelivery(conditions, rng);
    up.send({ seq, input }, toHost, clock);

    hostAcc += frameMs;
    let tickWall = 0;
    while (hostAcc >= hostTickMs) {
      const ht0 = nowNs();
      const opp = opponentAt(clock, host.state);
      host.receiveInput(opponentId, botSeq++, opp);
      up.drain(clock, (msg) => host.receiveInput(playerId, msg.seq, msg.input));
      const snapshot = host.tick(hostTickMs);
      tickWall = Math.max(tickWall, nowNs() - ht0);
      lastDown = rollDelivery(conditions, rng);
      down.send(snapshot, lastDown, clock);
      hostAcc -= hostTickMs;
    }
    down.drain(clock, (snapshot) => {
      const prev = getPos(client.getState(), playerId);
      client.reconcile(snapshot);
      const next = getPos(client.getState(), playerId);
      if (prev && next) smoother.note(prev, next);
      const pose = getPos(snapshot.state, playerId);
      if (pose) shadow.push(pose, snapshot.timestamp);
      const them = getPos(snapshot.state, opponentId);
      if (them) remote.push(them, snapshot.timestamp);
    });

    const predicted = getPos(client.getState(), playerId);
    const drawn = predicted ? smoother.apply(predicted, frameMs / 1000) : null;
    remote.sample(clock, lerp);
    const hostPose = shadow.sample();
    const frameWall = nowNs() - t0;

    sampler.record({
      frameMs: Math.max(frameMs, frameWall),
      hostTickMs: tickWall,
      hostBacklog: hostAcc,
      pending: client.pendingInputCount,
      shadowGap: ShadowBody.gap(drawn, hostPose),
      correctionPx: Math.hypot(smoother.ox, smoother.oy),
      interpStatus: remote.lastStatus,
      dropUp: toHost.drop,
      dropDown: lastDown.drop,
      upDelayMs: toHost.drop ? 0 : toHost.delayMs,
      downDelayMs: lastDown.drop ? 0 : lastDown.delayMs,
    });

    clock += frameMs;
  }

  const report = sampler.report({ ...conditions, transport: 'loopback' });
  report.routing.uplinkMs = summarize(sampler.samples.map((r) => r.upDelayMs));
  return report;
}

function feelScore(report) {
  const underrun = 100 - Math.min(100, report.rendering.underrunRate * 400);
  const correction = 100 - Math.min(40, report.prediction.correctionPx.p95 * 1.5);
  const queues = report.queueing.healthy ? 100 : 55;
  const server = report.server.onBudget ? 100 : 60;
  const frames = report.rendering.frameMs.p95 < 24 ? 100 : 70;
  const feel = underrun * 0.25 + correction * 0.25 + queues * 0.2 + server * 0.15 + frames * 0.15;
  return {
    score: Math.round(feel),
    parts: {
      interpolator: Math.round(underrun),
      corrections: Math.round(correction),
      queues: Math.round(queues),
      server: Math.round(server),
      frames: Math.round(frames),
    },
  };
}

class Mailbox {
  constructor() {
    this.q = [];
  }
  send(msg, delivery, clock) {
    if (delivery.drop) return;
    this.q.push({ at: clock + delivery.delayMs, msg });
  }
  drain(clock, handler) {
    this.q.sort((a, b) => a.at - b.at);
    let i = 0;
    while (i < this.q.length && this.q[i].at <= clock) {
      handler(this.q[i].msg);
      i += 1;
    }
    if (i) this.q.splice(0, i);
  }
}

function defaultGetPos(state, id) {
  if (!state || typeof state !== 'object') return null;
  const body = state[id];
  if (body && typeof body.x === 'number' && typeof body.y === 'number') return body;
  return null;
}

function lerpXY(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function round(n, d) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function nowNs() {
  const t = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return t;
}

/**
 * Tiny seeded RNG so a probe is reproducible in CI.
 * @param {number} seed
 * @returns {() => number}
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
