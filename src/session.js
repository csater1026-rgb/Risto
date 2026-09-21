/**
 * The attach recipe, as an object instead of a copy-paste.
 *
 * `PredictedView` is the client-side bundle: predict you, interpolate
 * them, smooth corrections, keep a Shadow Body. Stamp remotes on
 * *arrival*. Pair it with any `send` / `onReceive` transport.
 *
 * `createLoopbackSession` wires that to an `AuthoritativeHost` through
 * `createLoopbackLink` so you can feel your `simulate` under lag before
 * you ever stand up WebRTC.
 */

import { AuthoritativeHost } from './authoritative-host.js';
import { PredictionClient } from './prediction-client.js';
import {
  RemoteInterpolator,
  interpolationDelayMs,
  lerpPose,
} from './interpolator.js';
import { CorrectionSmoother } from './correction-smoother.js';
import { ShadowBody } from './shadow-body.js';
import { createLoopbackLink, rollDelivery } from './network-link.js';

export class PredictedView {
  /**
   * @param {{
   *   simulate: Function,
   *   playerId: string,
   *   initialState: unknown,
   *   opponentId?: string,
   *   delayMs?: number,
   *   maxExtrapolateMs?: number,
   * }} opts
   */
  constructor({
    simulate,
    playerId,
    initialState,
    opponentId = 'p2',
    delayMs = 100,
    maxExtrapolateMs = 80,
  }) {
    this.playerId = playerId;
    this.opponentId = opponentId;
    this.client = new PredictionClient({ simulate, playerId, initialState });
    this.remote = new RemoteInterpolator({ delayMs, maxExtrapolateMs });
    this.smoother = new CorrectionSmoother();
    this.shadow = new ShadowBody();
  }

  /** @param {number} ms */
  setDelay(ms) {
    this.remote.delayMs = ms;
  }

  /**
   * @param {unknown} input
   * @param {number} dt
   */
  applyLocalInput(input, dt) {
    return this.client.applyLocalInput(input, dt);
  }

  /**
   * Ingest an authoritative snapshot. Local pose uses the host send
   * stamp (Shadow Body / reorder detection). The remote interpolator is
   * stamped with *arrival* time so `delayMs` is a real buffer.
   * @param {{ state: unknown, lastProcessedSeq: Record<string, number>, tick?: number, timestamp?: number }} snapshot
   * @param {number} [arrivalNow]
   */
  ingest(snapshot, arrivalNow = Date.now()) {
    const prev = poseOf(this.client.getState(), this.playerId);
    this.client.reconcile(snapshot);
    const next = poseOf(this.client.getState(), this.playerId);
    if (prev && next) this.smoother.note(prev, next);

    const hostYou = poseOf(snapshot.state, this.playerId);
    if (hostYou) this.shadow.push(hostYou, snapshot.timestamp ?? arrivalNow);

    const them = poseOf(snapshot.state, this.opponentId);
    if (them) this.remote.push(them, arrivalNow);
  }

  /**
   * @param {number} now
   * @param {number} [dtSeconds]
   * @param {(a: unknown, b: unknown, t: number) => unknown} [interpolate]
   */
  sample(now, dtSeconds = 1 / 60, interpolate = lerpPose) {
    const state = this.client.getState();
    const youRaw = poseOf(state, this.playerId);
    const you = youRaw ? this.smoother.apply(youRaw, dtSeconds) : youRaw;
    const them = this.remote.sample(now, interpolate);
    const shadow = this.shadow.sample();
    return {
      state,
      you,
      them,
      shadow,
      shadowGap: ShadowBody.gap(you, shadow),
      pending: this.client.pendingInputCount,
      interpStatus: this.remote.lastStatus,
    };
  }
}

/**
 * Host + predicted local player + loopback link. Start here; swap the
 * link for `WebRtcTransport` later without touching `simulate`.
 *
 * @param {{
 *   simulate: Function,
 *   initialState: unknown,
 *   playerId?: string,
 *   opponentId?: string,
 *   hostTickMs?: number,
 *   conditions?: { latencyMs?: number, jitterMs?: number, lossRate?: number },
 *   delayMs?: number,
 *   now?: () => number,
 * }} opts
 */
export function createLoopbackSession({
  simulate,
  initialState,
  playerId = 'p1',
  opponentId = 'p2',
  hostTickMs = 50,
  conditions = { latencyMs: 100, jitterMs: 10, lossRate: 0 },
  delayMs,
  now = () => Date.now(),
} = {}) {
  const view = new PredictedView({
    simulate,
    playerId,
    initialState,
    opponentId,
    delayMs: delayMs ?? interpolationDelayMs(hostTickMs, conditions.jitterMs ?? 0),
  });
  const host = new AuthoritativeHost({ simulate, initialState, now });
  const link = createLoopbackLink(conditions);
  const seqs = Object.create(null);
  let acc = 0;
  let lastHostTickMs = 0;
  let lastUp = { drop: false, delayMs: 0 };
  let lastDown = { drop: false, delayMs: 0 };

  link.toHost.onReceive(({ seq, input }) => {
    host.receiveInput(playerId, seq, input);
  });
  link.toClient.onReceive((snapshot) => {
    view.ingest(snapshot);
  });

  function setConditions(next) {
    conditions = { ...conditions, ...next };
    link.toHost.setConditions(conditions);
    link.toClient.setConditions(conditions);
    view.setDelay(
      delayMs ?? interpolationDelayMs(hostTickMs, conditions.jitterMs ?? 0),
    );
  }
  setConditions(conditions);

  return {
    host,
    view,
    link,
    playerId,
    opponentId,
    hostTickMs,
    get conditions() {
      return conditions;
    },
    get lastHostTickMs() {
      return lastHostTickMs;
    },
    setConditions,

    /**
     * Predict locally and send the input to the host.
     * @param {unknown} input
     * @param {number} dt
     * @param {{ drop?: boolean, delayMs?: number }} [delivery]
     */
    applyLocalInput(input, dt, delivery) {
      const { seq } = view.applyLocalInput(input, dt);
      lastUp = delivery ?? rollDelivery(conditions);
      link.toHost.send({ seq, input }, lastUp);
      return seq;
    },

    /**
     * Advance the host on its fixed tick. `extraInputs` are other
     * players (a bot, a second peer) applied at tick time.
     * @param {number} dt
     * @param {Record<string, unknown>} [extraInputs]
     * @param {{ drop?: boolean, delayMs?: number }} [delivery]
     */
    stepHost(dt, extraInputs = {}, delivery) {
      acc += dt;
      let tickWall = 0;
      while (acc >= hostTickMs) {
        for (const [id, input] of Object.entries(extraInputs)) {
          if (id === playerId) continue;
          seqs[id] = (seqs[id] ?? -1) + 1;
          host.receiveInput(id, seqs[id], input);
        }
        const t0 = nowNs();
        const snapshot = host.tick(hostTickMs);
        tickWall = Math.max(tickWall, nowNs() - t0);
        lastDown = delivery ?? rollDelivery(conditions);
        link.toClient.send(snapshot, lastDown);
        acc -= hostTickMs;
      }
      if (tickWall > 0) lastHostTickMs = Math.max(tickWall, 0.001);
    },

    /**
     * @param {number} nowClock
     * @param {number} [dtSeconds]
     * @param {(a: unknown, b: unknown, t: number) => unknown} [interpolate]
     */
    sample(nowClock, dtSeconds, interpolate) {
      return view.sample(nowClock, dtSeconds, interpolate);
    },

    /**
     * Same shape `ProbeSampler.record` expects. Does not call `sample()`,
     * so it will not decay the correction smoother.
     * @param {number} frameMs
     * @param {number} [shadowGap]
     */
    telemetry(frameMs, shadowGap) {
      const you = poseOf(view.client.getState(), playerId);
      return {
        frameMs,
        hostTickMs: lastHostTickMs,
        hostBacklog: acc,
        pending: view.client.pendingInputCount,
        shadowGap: shadowGap ?? ShadowBody.gap(you, view.shadow.sample()),
        correctionPx: Math.hypot(view.smoother.ox, view.smoother.oy),
        interpStatus: view.remote.lastStatus,
        dropUp: Boolean(lastUp?.drop),
        dropDown: Boolean(lastDown?.drop),
        upDelayMs: lastUp?.drop ? 0 : lastUp?.delayMs ?? 0,
        downDelayMs: lastDown?.drop ? 0 : lastDown?.delayMs ?? 0,
      };
    },
  };
}

function poseOf(state, id) {
  if (!state || typeof state !== 'object') return null;
  const body = state[id];
  if (body && typeof body === 'object' && typeof body.x === 'number' && typeof body.y === 'number') {
    return body;
  }
  return null;
}

function nowNs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
