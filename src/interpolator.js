/**
 * Smooths playback of a *remote* entity you can't predict (you don't know
 * what they're about to do). Instead of snapping to each sparse snapshot as
 * it arrives, render slightly in the past and blend between the two
 * snapshots bracketing that render time — motion stays smooth even though
 * updates are infrequent and each one is already a little stale by the
 * time it arrives.
 *
 * Clock: `push()` and `sample()` must share one. For a delayed transport,
 * stamp `push` with *arrival* time (`Date.now()` when you receive), not the
 * host's send stamp — otherwise `now - delayMs` sits ahead of every
 * buffered snapshot and sample() underruns forever (never blends).
 * `push(state)` already defaults the stamp to `Date.now()`.
 *
 * Don't mix in `performance.now()`: it's relative to each page's own
 * navigation start, so it isn't comparable across peers.
 *
 * How long to sit in the past: `interpolationDelayMs(hostTickMs, jitterMs)`
 * — one snapshot plus jitter, so `sample()` still has two brackets when
 * the injector is being ugly.
 */

/**
 * Interpolation buffer depth that still has two snapshots to blend
 * under `hostTickMs` snapshots and `jitterMs` of arrival noise.
 * @param {number} hostTickMs
 * @param {number} [jitterMs]
 */
export function interpolationDelayMs(hostTickMs, jitterMs = 0) {
  const tick = Math.max(1, Number(hostTickMs) || 1);
  return Math.max(tick * 2, tick + Math.max(0, jitterMs) + 20);
}

/**
 * Default 2D lerp. Copies extra fields from `b`. Games with a different
 * state shape pass their own interpolator into `sample()`.
 * @param {{ x: number, y: number, [k: string]: unknown }} a
 * @param {{ x: number, y: number, [k: string]: unknown }} b
 * @param {number} t
 */
export function lerpPose(a, b, t) {
  if (!a || !b || typeof a.x !== 'number' || typeof b.x !== 'number') {
    return t < 1 ? a : b;
  }
  const out = { ...b, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  if (typeof a.vx === 'number' && typeof b.vx === 'number') {
    out.vx = a.vx + (b.vx - a.vx) * t;
  }
  if (typeof a.vy === 'number' && typeof b.vy === 'number') {
    out.vy = a.vy + (b.vy - a.vy) * t;
  }
  return out;
}

export class RemoteInterpolator {
  /** @param {{ delayMs?: number, maxExtrapolateMs?: number }} [opts] */
  constructor({ delayMs = 100, maxExtrapolateMs = 80 } = {}) {
    this.delayMs = delayMs;
    /** Cap on how far past the newest snapshot we coast. 0 = hold-last. */
    this.maxExtrapolateMs = maxExtrapolateMs;
    /** @type {{ state: unknown, timestamp: number }[]} */
    this._buffer = [];
    /** @type {'empty' | 'hold' | 'blend' | 'underrun' | 'extrapolate'} */
    this.lastStatus = 'empty';
  }

  /**
   * @param {unknown} state
   * @param {number} [timestamp] defaults to now (Date.now()) — arrival time
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
   *   Blends two states at t. t is in [0, 1] for blend, and may exceed 1
   *   for a short extrapolation when the buffer runs dry.
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

    const newest = buf[buf.length - 1];
    if (renderTime >= newest.timestamp) {
      return this._extrapolate(renderTime, interpolate);
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
    return this._extrapolate(renderTime, interpolate);
  }

  /**
   * Coast a little past the newest snapshot using the last interval's
   * delta, instead of freezing until the next packet. Extra time is
   * capped by `maxExtrapolateMs` and by one snapshot span so a tiny
   * jitter-split interval cannot fling the body across the screen.
   */
  _extrapolate(renderTime, interpolate) {
    const buf = this._buffer;
    const newest = buf[buf.length - 1];
    if (this.maxExtrapolateMs <= 0 || buf.length < 2) {
      this.lastStatus = 'underrun';
      return newest.state;
    }
    const prev = buf[buf.length - 2];
    const span = newest.timestamp - prev.timestamp || 1;
    const overrun = renderTime - newest.timestamp;
    const extra = Math.min(Math.max(0, overrun), this.maxExtrapolateMs, span);
    if (extra <= 0) {
      this.lastStatus = 'underrun';
      return newest.state;
    }
    const t = (newest.timestamp + extra - prev.timestamp) / span;
    this.lastStatus = extra < overrun ? 'underrun' : 'extrapolate';
    return interpolate(prev.state, newest.state, t);
  }
}
