import { InputHistory } from './input-history.js';

/**
 * @typedef {(state: unknown, inputs: Record<string, unknown>, dt: number) => unknown} SimulateFn
 */

/**
 * Runs on the controlling player's side. Applies their own input to the
 * simulation immediately (prediction) instead of waiting for a round trip,
 * then reconciles against the host's authoritative snapshots as they arrive.
 */
export class PredictionClient {
  /**
   * @param {{ simulate: SimulateFn, playerId: string, initialState: unknown }} opts
   */
  constructor({ simulate, playerId, initialState }) {
    this.simulate = simulate;
    this.playerId = playerId;
    this.state = initialState;
    this.history = new InputHistory();
    /** Tick of the last snapshot actually applied, so a later-arriving but
     * older (reordered in flight) snapshot can be detected and ignored
     * instead of rolling the client's state backward in time. */
    this._lastReconciledTick = -1;
  }

  /**
   * Call this the instant local input happens. Predicts the result right
   * away so the controlling player never waits on the network to see it,
   * while also recording the input so it can be replayed after the next
   * reconciliation.
   * @param {unknown} input
   * @param {number} dt
   * @returns {{ seq: number, state: unknown }}
   */
  applyLocalInput(input, dt) {
    const seq = this.history.record(input, dt);
    this.state = this.simulate(this.state, { [this.playerId]: input }, dt);
    return { seq, state: this.state };
  }

  /**
   * Call this when an authoritative snapshot arrives from the host. Snaps
   * to the host's truth, then replays every local input the host hasn't
   * acknowledged yet — so the player's own view corrects instantly without
   * ever visibly rewinding.
   * @param {{ state: unknown, lastProcessedSeq: Record<string, number>, tick?: number }} snapshot
   * @returns {unknown} the reconciled state
   */
  reconcile(snapshot) {
    // A real transport can reorder messages (two packets sent close
    // together can arrive in either order once jitter is added). Discard
    // anything older than the newest snapshot we've already applied.
    if (snapshot.tick !== undefined && snapshot.tick <= this._lastReconciledTick) {
      return this.state;
    }
    if (snapshot.tick !== undefined) this._lastReconciledTick = snapshot.tick;

    const ackedSeq = snapshot.lastProcessedSeq[this.playerId] ?? -1;
    this.history.acknowledge(ackedSeq);

    let state = snapshot.state;
    for (const entry of this.history.all) {
      state = this.simulate(state, { [this.playerId]: entry.input }, entry.dt);
    }
    this.state = state;
    return this.state;
  }

  getState() {
    return this.state;
  }

  /** Number of locally-predicted inputs still awaiting host acknowledgment. */
  get pendingInputCount() {
    return this.history.size;
  }
}
