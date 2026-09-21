/**
 * A synthetic, adjustable network channel: delivers messages after a
 * configurable latency (+ optional jitter) and drops a configurable
 * fraction at random. Used to connect a host and client within a single
 * page for a fully reproducible demo — turning a slider changes real,
 * measurable conditions instead of hoping a real network cooperates on
 * camera. The same interface (`send` / `onReceive`) is what a real
 * transport (e.g. a WebRTC data channel) implements too, so swapping one
 * for the other doesn't touch any of the netcode logic above it.
 */
export class NetworkLink {
  /** @param {{ latencyMs?: number, jitterMs?: number, lossRate?: number }} [opts] */
  constructor({ latencyMs = 0, jitterMs = 0, lossRate = 0 } = {}) {
    this.latencyMs = latencyMs;
    this.jitterMs = jitterMs;
    this.lossRate = lossRate;
    /** @type {((message: unknown) => void) | null} */
    this._onReceive = null;
  }

  /** @param {(message: unknown) => void} handler */
  onReceive(handler) {
    this._onReceive = handler;
  }

  /** @param {unknown} message */
  send(message) {
    if (this.lossRate > 0 && Math.random() < this.lossRate) return;
    const jitter =
      this.jitterMs > 0 ? (Math.random() * 2 - 1) * this.jitterMs : 0;
    const delay = Math.max(0, this.latencyMs + jitter);
    setTimeout(() => {
      if (this._onReceive) this._onReceive(message);
    }, delay);
  }

  /** @param {{ latencyMs?: number, jitterMs?: number, lossRate?: number }} conditions */
  setConditions(conditions) {
    if (conditions.latencyMs !== undefined) this.latencyMs = conditions.latencyMs;
    if (conditions.jitterMs !== undefined) this.jitterMs = conditions.jitterMs;
    if (conditions.lossRate !== undefined) this.lossRate = conditions.lossRate;
  }
}

/**
 * Creates a linked pair of NetworkLinks simulating a two-way connection
 * between a host and one client, entirely in-process — no real network
 * involved, but subject to the same latency/jitter/loss a real one would
 * impose.
 * @param {{ latencyMs?: number, jitterMs?: number, lossRate?: number }} [options]
 * @returns {{ toClient: NetworkLink, toHost: NetworkLink }}
 */
export function createLoopbackLink(options = {}) {
  return {
    toClient: new NetworkLink(options),
    toHost: new NetworkLink(options),
  };
}
