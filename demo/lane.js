import {
  AuthoritativeHost,
  PredictionClient,
  RemoteInterpolator,
  createLoopbackLink,
} from '../src/index.js';
import { simulate, createInitialState } from './simulate.js';

const HOST_TICK_MS = 50; // 20Hz authoritative tick — a realistic snapshot rate

/**
 * One self-contained lane of the Duel demo: its own host and its own
 * network link (adjustable latency/jitter/loss), and either full Risto
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
      this.remoteP2 = new RemoteInterpolator({ delayMs: 100 });
    } else {
      this.naiveState = createInitialState();
    }

    this._hostAccumulator = 0;
    this._nextSeq = 0;

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
}

function lerpPoint(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
