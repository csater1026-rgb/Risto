/**
 * Real peer-to-peer transport over an RTCDataChannel.
 *
 * Stretch-goal path: the engine's send/onReceive shape is identical to
 * NetworkLink, so PredictionClient / AuthoritativeHost don't change when
 * you swap loopback for this. NAT traversal can still fail (that's why
 * the shipped demo runs on loopback). See RISTO.md and api/signal.js.
 *
 * The data channel is unordered + unreliable on purpose — game snapshots
 * and inputs are like UDP. The engine already papers over drops
 * (held-last-input on the host, interpolation on remotes).
 */

/**
 * @typedef {{ send: (msg: object) => void, onMessage: (handler: (msg: object) => void) => void }} Signaling
 */

export class WebRtcTransport {
  /** @param {{ iceServers?: RTCIceServer[] }} [opts] */
  constructor({ iceServers } = {}) {
    this.iceServers = iceServers ?? [{ urls: 'stun:stun.l.google.com:19302' }];
    /** @type {((message: unknown) => void) | null} */
    this._onReceive = null;
    /** @type {RTCPeerConnection | null} */
    this._pc = null;
    /** @type {RTCDataChannel | null} */
    this._channel = null;
    this.ready = new Promise((resolve, reject) => {
      this._resolveReady = resolve;
      this._rejectReady = reject;
    });
  }

  /** @param {(message: unknown) => void} handler */
  onReceive(handler) {
    this._onReceive = handler;
  }

  /** @param {unknown} message */
  send(message) {
    if (!this._channel || this._channel.readyState !== 'open') return;
    this._channel.send(JSON.stringify(message));
  }

  /**
   * @param {{ signaling: Signaling, role: 'host' | 'client', roomId: string }} opts
   * @returns {Promise<void>}
   */
  async connect({ signaling, role, roomId }) {
    if (typeof RTCPeerConnection === 'undefined') {
      throw new Error('WebRTC is not available in this environment');
    }
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this._pc = pc;

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        signaling.send({ roomId, type: 'ice', candidate: ev.candidate, role });
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this._rejectReady(new Error(`WebRTC ${pc.connectionState}`));
      }
    };

    const handleChannel = (channel) => {
      this._channel = channel;
      channel.onmessage = (ev) => {
        let parsed = ev.data;
        try {
          parsed = JSON.parse(ev.data);
        } catch {
          // non-JSON payloads still get delivered
        }
        if (this._onReceive) this._onReceive(parsed);
      };
      channel.onopen = () => this._resolveReady();
      channel.onerror = (err) => this._rejectReady(err);
    };

    signaling.onMessage(async (msg) => {
      if (!msg || msg.roomId !== roomId || msg.role === role) return;
      try {
        if (msg.type === 'ice' && msg.candidate) {
          await pc.addIceCandidate(msg.candidate);
        } else if (msg.type === 'offer' && role === 'client' && msg.sdp) {
          await pc.setRemoteDescription(msg.sdp);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          signaling.send({ roomId, type: 'answer', sdp: pc.localDescription, role });
        } else if (msg.type === 'answer' && role === 'host' && msg.sdp) {
          await pc.setRemoteDescription(msg.sdp);
        }
      } catch {
        // ICE candidates can arrive before setRemoteDescription; ignore.
      }
    });

    if (role === 'host') {
      handleChannel(
        pc.createDataChannel('risto', { ordered: false, maxRetransmits: 0 }),
      );
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      signaling.send({ roomId, type: 'offer', sdp: pc.localDescription, role });
    } else {
      pc.ondatachannel = (ev) => handleChannel(ev.channel);
    }

    return this.ready;
  }

  close() {
    try {
      this._channel?.close();
    } catch {
      /* already closed */
    }
    try {
      this._pc?.close();
    } catch {
      /* already closed */
    }
    this._channel = null;
    this._pc = null;
  }
}

/**
 * Tiny HTTP polling signaling adapter matching api/signal.js.
 * Not used by the loopback demo; exists so the WebRTC path has a real,
 * swappable signaling implementation rather than a comment.
 */
export class HttpPollingSignaling {
  /** @param {{ url: string, roomId: string, intervalMs?: number }} opts */
  constructor({ url, roomId, intervalMs = 400 }) {
    this.url = url.replace(/\/$/, '');
    this.roomId = roomId;
    this.intervalMs = intervalMs;
    this._since = 0;
    this._handler = null;
    this._timer = null;
  }

  /** @param {object} msg */
  send(msg) {
    fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
    }).catch(() => {});
  }

  /** @param {(msg: object) => void} handler */
  onMessage(handler) {
    this._handler = handler;
    if (this._timer) return;
    this._timer = setInterval(() => this._poll(), this.intervalMs);
    this._poll();
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  async _poll() {
    try {
      const res = await fetch(
        `${this.url}?roomId=${encodeURIComponent(this.roomId)}&since=${this._since}`,
      );
      const body = await res.json();
      const messages = body.messages ?? [];
      for (const msg of messages) {
        if (msg.ts) this._since = Math.max(this._since, msg.ts);
        if (this._handler) this._handler(msg);
      }
    } catch {
      /* signaling down — WebRTC path is a stretch goal for a reason */
    }
  }
}
