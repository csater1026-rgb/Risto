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

  /**
   * Explicitly resync to a fresh state and forget all history, including
   * the out-of-order guard in `reconcile()`. That guard is intentionally
   * strict and monotonic (it never resets itself) so a stale, reordered
   * snapshot can never roll the client backward — but that same strictness
   * means if the host's tick counter ever goes backward or restarts from
   * scratch (a host process restarting, a failover to a fresh host
   * instance), every subsequent snapshot looks "older" than what's already
   * been applied and gets silently discarded forever. Call this once your
   * application-level reconnect logic knows a new host session has begun.
   * @param {unknown} state
   */
  reset(state) {
    this.state = state;
    this.history = new InputHistory();
    this._lastReconciledTick = -1;
  }

  /** Number of locally-predicted inputs still awaiting host acknowledgment. */
  get pendingInputCount() {
    return this.history.size;
  }
}
