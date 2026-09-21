import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NetworkLink, createLoopbackLink } from '../src/network-link.js';

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
