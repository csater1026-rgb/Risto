import {
  AuthoritativeHost,
  PredictionClient,
  RemoteInterpolator,
  createLoopbackLink,
} from '../src/index.js';
import { simulate, createInitialState } from './simulate.js';

export const HOST_TICK_MS = 50; // 20Hz authoritative tick — a realistic snapshot rate

/**
 * One self-contained lane of the Duel demo: its own host and its own
 * network link (adjustable latency/jitter/loss), and either full Ristro
 * prediction + reconciliation + interpolation, or a naive pass-through
 * that just renders whatever the last snapshot said — for a fair,
 * side-by-side comparison under identical injected conditions.
 */
export class Lane {
  constructor({ predictive }) {
    this.predictive = predictive;
    this.host = new AuthoritativeHost({
      simulate,
      initialState: createInitialState(),
    });
    this.link = createLoopbackLink();

    if (predictive) {
      this.client = new PredictionClient({
        simulate,
        playerId: 'p1',
        initialState: createInitialState(),
      });
      this.remoteP2 = new RemoteInterpolator({ delayMs: 0 });
    } else {
      this.naiveState = createInitialState();
    }

    this._hostAccumulator = 0;
    this._nextSeq = 0;
    // Tracked so setNetworkConditions can be called with a partial update
    // (matching NetworkLink.setConditions' merge semantics) and still
    // recompute the interpolator delay from the full current picture.
    this._latencyMs = 0;
    this._jitterMs = 0;

    this.link.toHost.onReceive(({ seq, input }) => {
      this.host.receiveInput('p1', seq, input);
    });

    this.link.toClient.onReceive((snapshot) => {
      if (this.predictive) {
        this.client.reconcile(snapshot);
        this.remoteP2.push(snapshot.state.p2, snapshot.timestamp);
      } else {
        this.naiveState = snapshot.state;
      }
    });
  }

  setNetworkConditions(conditions) {
    this.link.toHost.setConditions(conditions);
    this.link.toClient.setConditions(conditions);

    if (this.predictive) {
      if (conditions.latencyMs !== undefined) this._latencyMs = conditions.latencyMs;
      if (conditions.jitterMs !== undefined) this._jitterMs = conditions.jitterMs;
      // Must exceed actual one-way transit time (this.link.toClient's
      // latency + jitter) or sample() silently stops interpolating — see
      // RemoteInterpolator's class docs. The +2 host ticks of margin
      // keeps a second bracketing snapshot available even after an
      // occasional dropped packet.
      this.remoteP2.setDelayMs(this._latencyMs + this._jitterMs + HOST_TICK_MS * 2);
    }
  }

  /** Call once per animation frame with the current input and frame dt (ms). */
  update(dt, input) {
    if (this.predictive) {
      const { seq } = this.client.applyLocalInput(input, dt);
      this.link.toHost.send({ seq, input });
    } else {
      this.link.toHost.send({ seq: this._nextSeq++, input });
    }

    this._hostAccumulator += dt;
    while (this._hostAccumulator >= HOST_TICK_MS) {
      const snapshot = this.host.tick(HOST_TICK_MS);
      this.link.toClient.send(snapshot);
      this._hostAccumulator -= HOST_TICK_MS;
    }
  }

  /**
   * @param {number} now must be Date.now()-based — the same clock
   *   AuthoritativeHost stamps its snapshots with. Do not pass a
   *   performance.now() value here; see RemoteInterpolator's class docs.
   * @returns {{ p1: {x:number,y:number}, p2: {x:number,y:number} }}
   */
  getRenderState(now) {
    if (this.predictive) {
      const clientState = this.client.getState();
      const p2 = this.remoteP2.sample(now, lerpPoint) ?? clientState.p2;
      return { p1: clientState.p1, p2 };
    }
    return this.naiveState;
  }

  get pendingInputCount() {
    return this.predictive ? this.client.pendingInputCount : 0;
  }

  /** Current render-delay budget the interpolator is using, or null for
   * the naive lane (which has no interpolator). */
  get interpolationDelayMs() {
    return this.predictive ? this.remoteP2.delayMs : null;
  }
}

function lerpPoint(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
