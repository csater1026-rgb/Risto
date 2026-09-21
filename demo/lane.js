import {
  AuthoritativeHost,
  PredictedView,
  createLoopbackLink,
  interpolationDelayMs,
} from '../src/index.js';
import { simulate, createInitialState } from './simulate.js';
import { thinkBot } from './bot.js';

export const HOST_TICK_MS = 50; // 20 Hz snapshots — realistic, not cinematic

/**
 * One self-contained lane of Duel: its own host, its own loopback link,
 * and either full Risto prediction + reconciliation + interpolation, or a
 * naive pass-through that just renders the last snapshot. The demo feeds
 * both lanes the same input and the same pre-rolled delivery so the split
 * is the netcode, not a different network.
 */
export class Lane {
  constructor({ predictive }) {
    this.predictive = predictive;
    this.host = new AuthoritativeHost({
      simulate,
      initialState: createInitialState(),
    });
    this.link = createLoopbackLink();
    this._botSeq = 0;
    this._nextSeq = 0;
    this._hostAccumulator = 0;
    this.lastHostTickMs = 0;
    this.lastUp = { drop: false, delayMs: 0 };
    this.lastDown = { drop: false, delayMs: 0 };

    if (predictive) {
      this.view = new PredictedView({
        simulate,
        playerId: 'p1',
        opponentId: 'p2',
        initialState: createInitialState(),
      });
      this.smoother = this.view.smoother;
    } else {
      this.view = null;
      this.smoother = { ox: 0, oy: 0 };
      this.naiveState = createInitialState();
    }

    this.link.toHost.onReceive(({ seq, input }) => {
      this.host.receiveInput('p1', seq, input);
    });

    this.link.toClient.onReceive((snapshot) => {
      if (this.view) {
        // Arrival stamps live in PredictedView.ingest — snapshot.timestamp
        // is send-time and would underrun the interpolator under lag.
        this.view.ingest(snapshot);
        if (snapshot.state.phase !== 'play') this.view.smoother.reset();
      } else {
        this.naiveState = snapshot.state;
      }
    });
  }

  setNetworkConditions(conditions) {
    this.link.toHost.setConditions(conditions);
    this.link.toClient.setConditions(conditions);
    if (this.view) {
      this.view.setDelay(interpolationDelayMs(HOST_TICK_MS, conditions.jitterMs ?? 0));
    }
  }

  /**
   * @param {number} dt frame delta in ms
   * @param {{ dx: number, dy: number }} input
   * @param {{ toHost?: { drop?: boolean, delayMs?: number }, toClient?: { drop?: boolean, delayMs?: number } }} [rolls]
   */
  update(dt, input, rolls = {}) {
    this.lastUp = rolls.toHost ?? this.lastUp;
    this.lastDown = rolls.toClient ?? this.lastDown;
    if (this.view) {
      const { seq } = this.view.applyLocalInput(input, dt);
      this.link.toHost.send({ seq, input }, rolls.toHost);
    } else {
      this.link.toHost.send({ seq: this._nextSeq++, input }, rolls.toHost);
    }

    this._hostAccumulator += dt;
    let tickWall = 0;
    while (this._hostAccumulator >= HOST_TICK_MS) {
      const hostState = this.host.state;
      if (hostState.phase === 'play') {
        this.host.receiveInput('p2', this._botSeq++, thinkBot(hostState));
      }
      const t0 = performance.now();
      const snapshot = this.host.tick(HOST_TICK_MS);
      tickWall = Math.max(tickWall, performance.now() - t0);
      this.link.toClient.send(snapshot, rolls.toClient);
      this._hostAccumulator -= HOST_TICK_MS;
    }
    // Frames that didn't tick must not overwrite the last real measurement
    // with 0 — that made the lab's host p95 look like 0.00 ms forever.
    if (tickWall > 0) this.lastHostTickMs = Math.max(tickWall, 0.001);
  }

  /**
   * @param {number} now Date.now()-based, matching interpolator arrival stamps
   * @param {number} [dtSeconds]
   */
  getRenderState(now, dtSeconds = 1 / 60) {
    if (this.view) {
      const sampled = this.view.sample(now, dtSeconds, lerpBody);
      return {
        ...sampled.state,
        p1: sampled.you,
        p2: sampled.them ?? sampled.state.p2,
        shadow: sampled.shadow,
        shadowGap: sampled.shadowGap,
      };
    }
    return this.naiveState;
  }

  get pendingInputCount() {
    return this.view ? this.view.client.pendingInputCount : 0;
  }

  get interpolationDelayMs() {
    return this.view ? this.view.remote.delayMs : 0;
  }

  /** Snapshot of queues / tick cost / interpolator health for the lab probe. */
  getTelemetry(frameMs, shadowGap) {
    return {
      frameMs,
      hostTickMs: this.lastHostTickMs,
      hostBacklog: this._hostAccumulator,
      pending: this.pendingInputCount,
      shadowGap: shadowGap ?? 0,
      correctionPx: Math.hypot(this.smoother.ox, this.smoother.oy),
      interpStatus: this.view ? this.view.remote.lastStatus : 'hold',
      dropUp: Boolean(this.lastUp?.drop),
      dropDown: Boolean(this.lastDown?.drop),
      upDelayMs: this.lastUp?.drop ? 0 : this.lastUp?.delayMs ?? 0,
      downDelayMs: this.lastDown?.drop ? 0 : this.lastDown?.delayMs ?? 0,
    };
  }
}

function lerpBody(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    vx: a.vx + (b.vx - a.vx) * t,
    vy: a.vy + (b.vy - a.vy) * t,
    dashCd: (a.dashCd ?? 0) + ((b.dashCd ?? 0) - (a.dashCd ?? 0)) * t,
  };
}
