/**
 * A synthetic, adjustable network channel: delivers messages after a
 * configurable latency (+ optional jitter) and drops a configurable
 * fraction at random. Used to connect a host and client within a single
 * page for a fully reproducible demo — turning a slider changes real,
 * measurable conditions instead of hoping a real network cooperates on
 * camera. The same interface (`send` / `onReceive`) is what a real
 * transport (e.g. a WebRTC data channel) implements too, so swapping one
 * for the other doesn't touch any of the netcode logic above it.
 *
 * Messages are structuredClone'd on send so each hop is a copy, matching
 * what a real wire would do (no shared references, no hidden mutation
 * leaking across the "network").
 */

/**
 * Roll whether a packet is dropped and how long it takes, given the
 * current conditions. Exposed so the demo can apply the *same* roll to
 * both comparison lanes — otherwise independent Math.random() calls make
 * the naive-vs-predicted split an unfair, different-network comparison.
 * @param {{ latencyMs?: number, jitterMs?: number, lossRate?: number }} [conditions]
 * @param {() => number} [rng]  returns [0, 1)
 * @returns {{ drop: boolean, delayMs: number }}
 */
export function rollDelivery(
  { latencyMs = 0, jitterMs = 0, lossRate = 0 } = {},
  rng = Math.random,
) {
  if (lossRate > 0 && rng() < lossRate) return { drop: true, delayMs: 0 };
  const jitter = jitterMs > 0 ? (rng() * 2 - 1) * jitterMs : 0;
  return { drop: false, delayMs: Math.max(0, latencyMs + jitter) };
}

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

  /**
   * @param {unknown} message
   * @param {{ drop?: boolean, delayMs?: number }} [delivery]
   *   Optional pre-rolled delivery. When omitted, this link rolls its own
   *   latency/jitter/loss from the current conditions.
   */
  send(message, delivery) {
    const rolled = delivery ?? rollDelivery(this);
    if (rolled.drop) return;
    const delay = Math.max(0, rolled.delayMs);
    const payload = cloneMessage(message);
    setTimeout(() => {
      if (this._onReceive) this._onReceive(payload);
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

function cloneMessage(message) {
  if (typeof structuredClone === 'function') return structuredClone(message);
  return JSON.parse(JSON.stringify(message));
}
