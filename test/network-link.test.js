import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NetworkLink, createLoopbackLink, rollDelivery } from '../src/network-link.js';

test('delivers a message after roughly the configured latency', async () => {
  const link = new NetworkLink({ latencyMs: 30 });
  const received = [];
  link.onReceive((msg) => received.push(msg));

  const start = Date.now();
  link.send('hello');

  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.deepEqual(received, ['hello']);
  assert.ok(Date.now() - start >= 30);
});

test('lossRate of 1 drops every message', async () => {
  const link = new NetworkLink({ latencyMs: 5, lossRate: 1 });
  const received = [];
  link.onReceive((msg) => received.push(msg));

  link.send('a');
  link.send('b');
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.deepEqual(received, []);
});

test('createLoopbackLink wires two independent directions', async () => {
  const { toClient, toHost } = createLoopbackLink({ latencyMs: 5 });
  const clientSaw = [];
  const hostSaw = [];
  toClient.onReceive((m) => clientSaw.push(m));
  toHost.onReceive((m) => hostSaw.push(m));

  toClient.send('from-host');
  toHost.send('from-client');
  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.deepEqual(clientSaw, ['from-host']);
  assert.deepEqual(hostSaw, ['from-client']);
});

test('rollDelivery drops every packet at lossRate 1 and none at 0', () => {
  const drop = rollDelivery({ lossRate: 1 }, () => 0);
  assert.equal(drop.drop, true);
  const keep = rollDelivery({ latencyMs: 40, jitterMs: 0, lossRate: 0 }, () => 0.5);
  assert.equal(keep.drop, false);
  assert.equal(keep.delayMs, 40);
});

test('send clones the payload so later mutation cannot leak across the hop', async () => {
  const link = new NetworkLink({ latencyMs: 5 });
  const received = [];
  link.onReceive((msg) => received.push(msg));
  const payload = { n: 1, nested: { x: 2 } };
  link.send(payload);
  payload.n = 99;
  payload.nested.x = 99;
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(received, [{ n: 1, nested: { x: 2 } }]);
});

test('pre-rolled delivery override skips the link\'s own loss roll', async () => {
  const link = new NetworkLink({ latencyMs: 5, lossRate: 1 });
  const received = [];
  link.onReceive((msg) => received.push(msg));
  link.send('kept', { drop: false, delayMs: 5 });
  link.send('dumped', { drop: true, delayMs: 0 });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(received, ['kept']);
});
