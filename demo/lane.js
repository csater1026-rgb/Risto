import {
  AuthoritativeHost,
  PredictionClient,
  RemoteInterpolator,
  CorrectionSmoother,
  ShadowBody,
  createLoopbackLink,
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
    this.smoother = new CorrectionSmoother();
    this.shadow = new ShadowBody();
    this._botSeq = 0;
    this._nextSeq = 0;
    this._hostAccumulator = 0;
    this._lastPhase = 'play';
    this.lastHostTickMs = 0;
    this.lastUp = { drop: false, delayMs: 0 };
    this.lastDown = { drop: false, delayMs: 0 };

    if (predictive) {
      this.client = new PredictionClient({
        simulate,
        playerId: 'p1',
        initialState: createInitialState(),
      });
      this.remoteP2 = new RemoteInterpolator({ delayMs: 100 });
    } else {
      this.naiveState = createInitialState();
    }

    this.link.toHost.onReceive(({ seq, input }) => {
      this.host.receiveInput('p1', seq, input);
    });

    this.link.toClient.onReceive((snapshot) => {
      if (this.predictive) {
        const prev = this.client.getState().p1;
        this.client.reconcile(snapshot);
        this.smoother.note(prev, this.client.getState().p1);
        this.shadow.push(snapshot.state.p1, snapshot.timestamp);
        this.remoteP2.push(snapshot.state.p2, snapshot.timestamp);
        if (snapshot.state.phase !== 'play') this.smoother.reset();
      } else {
        this.naiveState = snapshot.state;
      }
    });
  }

  setNetworkConditions(conditions) {
    this.link.toHost.setConditions(conditions);
    this.link.toClient.setConditions(conditions);
    if (this.predictive) {
      // Stay ahead of one snapshot + jitter so sample() has two brackets
      // to blend, even when the "network" is being unpleasant.
      this.remoteP2.delayMs = Math.max(
        HOST_TICK_MS * 2,
        HOST_TICK_MS + (conditions.jitterMs ?? 0) + 20,
      );
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
    if (this.predictive) {
      const { seq } = this.client.applyLocalInput(input, dt);
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
    this.lastHostTickMs = tickWall;
  }

  /**
   * @param {number} now Date.now()-based, matching AuthoritativeHost stamps
   * @param {number} [dtSeconds]
   */
  getRenderState(now, dtSeconds = 1 / 60) {
    if (this.predictive) {
      const clientState = this.client.getState();
      const p1 = this.smoother.apply(clientState.p1, dtSeconds);
      const p2 = this.remoteP2.sample(now, lerpBody) ?? clientState.p2;
      const shadow = this.shadow.sample();
      return {
        ...clientState,
        p1,
        p2,
        shadow,
        shadowGap: ShadowBody.gap(p1, shadow),
      };
    }
    return this.naiveState;
  }

  get pendingInputCount() {
    return this.predictive ? this.client.pendingInputCount : 0;
  }

  get interpolationDelayMs() {
    return this.predictive ? this.remoteP2.delayMs : 0;
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
      interpStatus: this.predictive ? this.remoteP2.lastStatus : 'hold',
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
