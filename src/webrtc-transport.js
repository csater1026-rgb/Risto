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
 * @typedef {{ send: (msg: object) => void, onMessage: (handler: (msg: object) => void) => void, stop?: () => void }} Signaling
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
    this._pendingIce = [];
    this._remoteSet = false;
    this._settled = false;
    this._connecting = false;
    this.connectionState = 'new';
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
   * @param {{ signaling: Signaling, role: 'host' | 'client', roomId: string, timeoutMs?: number }} opts
   * @returns {Promise<void>}
   */
  async connect({ signaling, role, roomId, timeoutMs = 12_000 }) {
    if (typeof RTCPeerConnection === 'undefined') {
      throw new Error('WebRTC is not available in this environment');
    }
    this._connecting = true;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this._pc = pc;

    const timeout = setTimeout(() => {
      this._settle(false, new Error('WebRTC connect timed out (signaling down or NAT blocked the path)'));
    }, timeoutMs);

    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return;
      signaling.send({
        roomId,
        type: 'ice',
        candidate: ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate,
        role,
      });
    };
    pc.onconnectionstatechange = () => {
      this.connectionState = pc.connectionState;
      if (pc.connectionState === 'failed') {
        this._settle(false, new Error('WebRTC failed — NAT traversal often needs a TURN relay'));
      }
    };

    const handleChannel = (channel) => {
      this._channel = channel;
      channel.binaryType = 'arraybuffer';
      channel.onmessage = (ev) => {
        let parsed = ev.data;
        try {
          parsed = JSON.parse(ev.data);
        } catch {
          // non-JSON payloads still get delivered
        }
        if (this._onReceive) this._onReceive(parsed);
      };
      channel.onopen = () => this._settle(true);
      channel.onerror = (err) => this._settle(false, err instanceof Error ? err : new Error('data channel error'));
    };

    signaling.onMessage(async (msg) => {
      if (!msg || msg.roomId !== roomId || msg.role === role) return;
      try {
        if (msg.type === 'ice' && msg.candidate) {
          await this._addIce(msg.candidate);
        } else if (msg.type === 'offer' && role === 'client' && msg.sdp) {
          await pc.setRemoteDescription(msg.sdp);
          this._remoteSet = true;
          await this._flushIce();
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          signaling.send({
            roomId,
            type: 'answer',
            sdp: describe(pc.localDescription),
            role,
          });
        } else if (msg.type === 'answer' && role === 'host' && msg.sdp) {
          await pc.setRemoteDescription(msg.sdp);
          this._remoteSet = true;
          await this._flushIce();
        }
      } catch {
        // ICE can still lose a race; queued candidates cover the common case.
      }
    });

    if (role === 'host') {
      handleChannel(
        pc.createDataChannel('risto', { ordered: false, maxRetransmits: 0 }),
      );
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      signaling.send({
        roomId,
        type: 'offer',
        sdp: describe(pc.localDescription),
        role,
      });
    } else {
      pc.ondatachannel = (ev) => handleChannel(ev.channel);
    }

    try {
      await this.ready;
    } finally {
      clearTimeout(timeout);
    }
  }

  async _addIce(candidate) {
    if (!this._pc) return;
    if (!this._remoteSet) {
      this._pendingIce.push(candidate);
      return;
    }
    try {
      await this._pc.addIceCandidate(candidate);
    } catch {
      /* stale candidate */
    }
  }

  async _flushIce() {
    const queued = this._pendingIce.splice(0, this._pendingIce.length);
    for (const candidate of queued) {
      await this._addIce(candidate);
    }
  }

  _settle(ok, err) {
    if (this._settled) return;
    this._settled = true;
    if (ok) this._resolveReady();
    else this._rejectReady(err ?? new Error('WebRTC failed'));
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
    this.connectionState = 'closed';
    if (this._connecting) this._settle(false, new Error('WebRTC closed'));
  }
}

function describe(desc) {
  if (!desc) return desc;
  return desc.toJSON ? desc.toJSON() : { type: desc.type, sdp: desc.sdp };
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
      body: JSON.stringify({ roomId: this.roomId, ...msg }),
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
