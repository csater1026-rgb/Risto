/**
 * Records local inputs with sequence numbers so a PredictionClient can
 * replay whatever the host hasn't confirmed yet after a reconciliation.
 */
export class InputHistory {
  constructor() {
    /** @type {{ seq: number, input: unknown, dt: number }[]} */
    this._entries = [];
    this._nextSeq = 0;
  }

  /**
   * @param {unknown} input
   * @param {number} dt
   * @returns {number} the sequence number assigned to this input
   */
  record(input, dt) {
    const seq = this._nextSeq++;
    this._entries.push({ seq, input, dt });
    return seq;
  }

  /**
   * Drop every entry the host has already folded into its authoritative
   * state — nothing before (and including) `seq` needs to be replayed again.
   * @param {number} seq
   */
  acknowledge(seq) {
    this._entries = this._entries.filter((e) => e.seq > seq);
  }

  /** @returns {{ seq: number, input: unknown, dt: number }[]} */
  get all() {
    return this._entries;
  }

  get size() {
    return this._entries.length;
  }
}
