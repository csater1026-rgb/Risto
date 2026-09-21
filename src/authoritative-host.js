/**
 * @typedef {(state: unknown, inputs: Record<string, unknown>, dt: number) => unknown} SimulateFn
 */

/**
 * The single source of truth for the game. Runs on whichever peer (or
 * server process) is designated the host. Accepts inputs from every
 * player, advances the simulation on a fixed tick, and produces the
 * authoritative snapshots that PredictionClients reconcile against and
 * RemoteInterpolators render from.
 */
export class AuthoritativeHost {
  /**
   * @param {{ simulate: SimulateFn, initialState: unknown }} opts
   */
  constructor({ simulate, initialState }) {
    this.simulate = simulate;
    this.state = initialState;
    /** @type {Map<string, unknown>} latest known input per player, staged
     * for the next tick() but not yet folded into `state` */
    this._pendingInputs = new Map();
    /** @type {Map<string, number>} seq of whatever's currently staged in
     * _pendingInputs per player — promoted to _lastProcessedSeq once
     * tick() actually applies it */
    this._pendingSeq = new Map();
    /** @type {Map<string, number>} highest input seq received per player,
     * used only to reject stale/duplicate messages in receiveInput() */
    this._lastReceivedSeq = new Map();
    /** @type {Map<string, number>} highest input seq actually folded into
     * `state` per player — this, not _lastReceivedSeq, is what getSnapshot()
     * reports, so a snapshot's lastProcessedSeq always accurately describes
     * its own state rather than outrunning it */
    this._lastProcessedSeq = new Map();
    /** Monotonic tick counter, stamped on every snapshot so clients can
     * detect and discard snapshots that arrive out of order. */
    this._tick = -1;
  }

  /**
   * Feed in an input message as it arrives from a client. Stale or
   * duplicate (out-of-order, re-sent) messages are ignored automatically.
   * Whatever input was most recently received for a player stays "held"
   * across ticks until a newer one arrives — this is deliberate: it's how
   * you represent continuous input (e.g. a key still being pressed) rather
   * than one-off events, and it papers over an occasional dropped packet.
   * Note this only stages the input; it isn't reflected in `state` (or in
   * a snapshot's `lastProcessedSeq`) until the next tick() actually
   * applies it.
   * @param {string} playerId
   * @param {number} seq
   * @param {unknown} input
   */
  receiveInput(playerId, seq, input) {
    const lastSeq = this._lastReceivedSeq.get(playerId) ?? -1;
    if (seq <= lastSeq) return;
    this._pendingInputs.set(playerId, input);
    this._pendingSeq.set(playerId, seq);
    this._lastReceivedSeq.set(playerId, seq);
  }

  /**
   * Advance the authoritative simulation by one fixed tick.
   * @param {number} dt
   * @returns {{ state: unknown, lastProcessedSeq: Record<string, number>, timestamp: number }}
   */
  tick(dt) {
    const inputs = Object.fromEntries(this._pendingInputs);
    this.state = this.simulate(this.state, inputs, dt);
    this._tick += 1;
    // Only now — as part of actually applying this tick's staged inputs —
    // does "processed" advance, keeping it consistent with `state` no
    // matter when getSnapshot() is next called.
    for (const [playerId, seq] of this._pendingSeq) {
      this._lastProcessedSeq.set(playerId, seq);
    }
    return this.getSnapshot();
  }

  getSnapshot() {
    return {
      state: this.state,
      lastProcessedSeq: Object.fromEntries(this._lastProcessedSeq),
      tick: this._tick,
      timestamp: Date.now(),
    };
  }
}
