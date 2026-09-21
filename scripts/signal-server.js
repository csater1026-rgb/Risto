#!/usr/bin/env node
/**
 * Local stretch-goal signaling server for WebRtcTransport.
 *   node scripts/signal-server.js
 * Then point HttpPollingSignaling at http://localhost:8787/?roomId=...
 */
import http from 'node:http';
import handler from '../api/signal.js';

const port = Number(process.env.PORT ?? 8787);
http.createServer((req, res) => {
  handler(req, res).catch((err) => {
    res.statusCode = 500;
    res.end(String(err));
  });
}).listen(port, () => {
  console.log(`Risto signaling relay on http://localhost:${port}`);
});
