import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPeerSession } from '../src/session.js';
import { WebRtcTransport } from '../src/webrtc-transport.js';
import handler from '../api/signal.js';

function simulate(state, inputs, dt) {
  const s = dt / 1000;
  const step = (p, inp) => {
    if (!inp) return { ...p };
    return { x: p.x + (inp.dx ?? 0) * 100 * s, y: p.y + (inp.dy ?? 0) * 100 * s };
  };
  return { p1: step(state.p1, inputs.p1), p2: step(state.p2, inputs.p2) };
}

const initialState = { p1: { x: 0, y: 0 }, p2: { x: 40, y: 0 } };

function pairTransports() {
  const handlers = { a: null, b: null };
  const make = (side, other) => ({
    send(msg) {
      const copy = typeof structuredClone === 'function' ? structuredClone(msg) : JSON.parse(JSON.stringify(msg));
      handlers[other]?.(copy);
    },
    onReceive(handler) {
      handlers[side] = handler;
    },
  });
  return { host: make('a', 'b'), client: make('b', 'a') };
}

test('createPeerSession host tick reaches the client predicted view', () => {
  const link = pairTransports();
  const host = createPeerSession({
    simulate,
    initialState,
    role: 'host',
    transport: link.host,
    hostTickMs: 50,
    delayMs: 100,
  });
  const client = createPeerSession({
    simulate,
    initialState,
    role: 'client',
    transport: link.client,
    hostTickMs: 50,
    delayMs: 100,
  });

  host.applyLocalInput({ dx: 1, dy: 0 }, 50);
  host.step(50);
  client.applyLocalInput({ dx: 0, dy: 0 }, 50);
  client.step(0);

  assert.ok(host.host.state.p1.x > 0);
  const sampled = client.sample(Date.now() + 200, 0);
  const shown = client.renderState(sampled);
  assert.ok(shown.p1.x > 0, `client should see host p1 move, x=${shown.p1.x}`);
});

test('createPeerSession client input is held on the host', () => {
  const link = pairTransports();
  const host = createPeerSession({
    simulate,
    initialState,
    role: 'host',
    transport: link.host,
    hostTickMs: 50,
  });
  const client = createPeerSession({
    simulate,
    initialState,
    role: 'client',
    transport: link.client,
    hostTickMs: 50,
  });

  client.applyLocalInput({ dx: 1, dy: 0 }, 50);
  host.step(50);
  assert.ok(host.host.state.p2.x > 40, `host should integrate client input, p2.x=${host.host.state.p2.x}`);
});

test('WebRtcTransport.send is a no-op before connect', () => {
  const t = new WebRtcTransport();
  t.onReceive(() => {
    throw new Error('should not receive');
  });
  assert.doesNotThrow(() => t.send({ kind: 'ping' }));
  assert.doesNotThrow(() => t.close());
});

function mockRes() {
  const out = { statusCode: 0, body: '', headers: {} };
  return {
    out,
    statusCode: 0,
    setHeader(k, v) { out.headers[k] = v; },
    end(chunk) {
      this.statusCode = this.statusCode || 200;
      out.statusCode = this.statusCode;
      out.body = chunk ? String(chunk) : '';
    },
  };
}

function mockReq(method, url, body) {
  return {
    method,
    url,
    body,
  };
}

test('signaling relay stores and returns room messages', async () => {
  const roomId = `t${Date.now()}`;
  const post = mockRes();
  await handler(mockReq('POST', '/', { roomId, type: 'offer', role: 'host', sdp: 'x' }), post);
  assert.equal(post.out.statusCode, 200);

  const get = mockRes();
  await handler(mockReq('GET', `/?roomId=${roomId}&since=0`), get);
  const parsed = JSON.parse(get.out.body);
  assert.equal(parsed.messages.length, 1);
  assert.equal(parsed.messages[0].type, 'offer');
});
