/**
 * Hides the one-frame "pop" when reconciliation corrects a misprediction.
 *
 * Valve-style error carry: when the authoritative position disagrees with
 * what the player was just looking at, keep the *visual* where it was and
 * decay that offset toward zero. The predicted simulation still snaps to
 * the truth (so further prediction is correct); only the pixels ease.
 *
 * Large discontinuities (round resets, teleports) are *not* smoothed —
 * those should snap, or the player watches themselves slide across the
 * arena after a knockout.
 */
export class CorrectionSmoother {
  /** @param {{ decay?: number, snapDistance?: number }} [opts] */
  constructor({ decay = 14, snapDistance = 80 } = {}) {
    this.decay = decay;
    this.snapDistance = snapDistance;
    this.ox = 0;
    this.oy = 0;
  }

  /**
   * Record a correction. `prev` is what was on screen, `next` is the
   * reconciled simulation position.
   * @param {{ x: number, y: number }} prev
   * @param {{ x: number, y: number }} next
   */
  note(prev, next) {
    const dx = prev.x - next.x;
    const dy = prev.y - next.y;
    if (Math.hypot(dx, dy) >= this.snapDistance) {
      this.ox = 0;
      this.oy = 0;
      return;
    }
    this.ox += dx;
    this.oy += dy;
  }

  /** Drop any outstanding offset (call on round reset). */
  reset() {
    this.ox = 0;
    this.oy = 0;
  }

  /**
   * @param {{ x: number, y: number, [k: string]: unknown }} pos
   * @param {number} dtSeconds
   * @returns {{ x: number, y: number, [k: string]: unknown }}
   */
  apply(pos, dtSeconds) {
    const k = Math.exp(-this.decay * Math.max(0, dtSeconds));
    this.ox *= k;
    this.oy *= k;
    if (Math.abs(this.ox) < 0.04) this.ox = 0;
    if (Math.abs(this.oy) < 0.04) this.oy = 0;
    return { ...pos, x: pos.x + this.ox, y: pos.y + this.oy };
  }
}
