/**
 * Smooths playback of a *remote* entity you can't predict (you don't know
 * what they're about to do). Instead of snapping to each sparse snapshot as
 * it arrives, render slightly in the past and blend between the two
 * snapshots bracketing that render time — motion stays smooth even though
 * updates are infrequent and each one is already a little stale by the
 * time it arrives.
 *
 * Both `push()`'s `timestamp` and `sample()`'s `now` must be the same
 * clock — normally `Date.now()`, matching what `AuthoritativeHost`'s
 * snapshots are stamped with. Don't use `performance.now()` here: it's
 * relative to each page's own navigation start, so it isn't meaningfully
 * comparable to a timestamp that came from another process over the
 * network in the first place.
 */
export class RemoteInterpolator {
  /** @param {{ delayMs?: number }} [opts] */
  constructor({ delayMs = 100 } = {}) {
    this.delayMs = delayMs;
    /** @type {{ state: unknown, timestamp: number }[]} */
    this._buffer = [];
    /** @type {'empty' | 'hold' | 'blend' | 'underrun'} */
    this.lastStatus = 'empty';
  }

  /**
   * @param {unknown} state
   * @param {number} [timestamp] defaults to now (Date.now())
   */
  push(state, timestamp = Date.now()) {
    // A real transport can reorder messages (two packets sent close
    // together can arrive in either order once jitter is added). sample()
    // assumes the buffer is in ascending timestamp order, so a
    // late-arriving, older-than-what-we-already-have snapshot must be
    // dropped rather than appended — the same principle PredictionClient
    // applies to reconciliation.
    const newest = this._buffer[this._buffer.length - 1];
    if (newest && timestamp <= newest.timestamp) return;

    this._buffer.push({ state, timestamp });
    const cutoff = timestamp - this.delayMs * 4;
    while (this._buffer.length > 2 && this._buffer[0].timestamp < cutoff) {
      this._buffer.shift();
    }
  }

  /**
   * @param {number} now same clock as the timestamps passed to `push()`
   *   (see class docs) — normally `Date.now()`
   * @param {(a: unknown, b: unknown, t: number) => unknown} interpolate
   *   Blends two states at t in [0, 1]. The library doesn't know your state
   *   shape, so you supply this (usually a simple per-field lerp).
   * @returns {unknown | null} the interpolated state, or null if nothing has
   *   arrived yet
   */
  sample(now, interpolate) {
    const buf = this._buffer;
    if (buf.length === 0) {
      this.lastStatus = 'empty';
      return null;
    }
    if (buf.length === 1) {
      this.lastStatus = 'hold';
      return buf[0].state;
    }

    const renderTime = now - this.delayMs;

    if (renderTime <= buf[0].timestamp) {
      this.lastStatus = 'hold';
      return buf[0].state;
    }
    if (renderTime >= buf[buf.length - 1].timestamp) {
      this.lastStatus = 'underrun';
      return buf[buf.length - 1].state;
    }

    for (let i = 0; i < buf.length - 1; i++) {
      const a = buf[i];
      const b = buf[i + 1];
      if (a.timestamp <= renderTime && renderTime <= b.timestamp) {
        const span = b.timestamp - a.timestamp || 1;
        const t = (renderTime - a.timestamp) / span;
        this.lastStatus = 'blend';
        return interpolate(a.state, b.state, t);
      }
    }
    this.lastStatus = 'underrun';
    return buf[buf.length - 1].state;
  }
}
