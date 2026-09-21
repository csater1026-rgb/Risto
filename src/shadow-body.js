/**
 * Where the host thinks a predicted body is.
 *
 * Other netcode stacks treat this as a debug overlay, if they show it at
 * all. Risto makes it a first-class object: the predicted disc is what
 * you *feel*, the shadow is what the world *hits*. At 0 ms they sit on
 * top of each other. Under lag they split, and that split is a mechanic
 * (in Duel, knockouts are decided on the shadow, not your pixels).
 *
 * Push the local player's pose from each authoritative snapshot.
 * `sample()` is the last non-stale host pose — no interpolation, no
 * guessing. Stale (reordered) snapshots are ignored, same rule as
 * PredictionClient.
 */
export class ShadowBody {
  constructor() {
    /** @type {{ x: number, y: number, [k: string]: unknown } | null} */
    this.pose = null;
    this.timestamp = -1;
  }

  /**
   * @param {{ x: number, y: number, [k: string]: unknown }} pose
   * @param {number} [timestamp]
   */
  push(pose, timestamp = Date.now()) {
    if (this.timestamp >= 0 && timestamp < this.timestamp) return;
    this.pose = pose;
    this.timestamp = timestamp;
  }

  /** @returns {{ x: number, y: number, [k: string]: unknown } | null} */
  sample() {
    return this.pose;
  }

  /**
   * How far the predicted body has run ahead of the host's last word.
   * @param {{ x: number, y: number } | null | undefined} predicted
   * @param {{ x: number, y: number } | null | undefined} shadow
   */
  static gap(predicted, shadow) {
    if (!predicted || !shadow) return 0;
    return Math.hypot(predicted.x - shadow.x, predicted.y - shadow.y);
  }
}
