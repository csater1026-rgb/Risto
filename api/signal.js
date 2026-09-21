/**
 * Stretch-goal signaling relay for the WebRTC transport.
 *
 * Vercel-style default export (req, res). Also usable from a tiny local
 * Node listener (scripts/signal-server.js).
 *
 * This is deliberately not durable: a Map in the isolate. Fine for two
 * browsers on one demo box; not a production mesh. NAT traversal can
 * still fail after signaling succeeds — that's why Duel ships on
 * loopback. See RISTO.md.
 */

const rooms = globalThis.__ristoSignalRooms ?? (globalThis.__ristoSignalRooms = new Map());

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method === 'POST') {
    const body = await readJson(req);
    if (!body?.roomId) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'roomId required' }));
      return;
    }
    const room = rooms.get(body.roomId) ?? { messages: [] };
    const stamped = { ...body, ts: Date.now() };
    room.messages.push(stamped);
    if (room.messages.length > 48) {
      room.messages.splice(0, room.messages.length - 48);
    }
    rooms.set(body.roomId, room);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'GET') {
    const url = new URL(req.url, 'http://localhost');
    const roomId = url.searchParams.get('roomId');
    const since = Number(url.searchParams.get('since') ?? 0);
    const room = roomId ? rooms.get(roomId) : null;
    const messages = (room?.messages ?? []).filter((m) => m.ts > since);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ messages }));
    return;
  }

  res.statusCode = 405;
  res.end();
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function readJson(req) {
  if (req.body) {
    return Promise.resolve(typeof req.body === 'string' ? JSON.parse(req.body) : req.body);
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8') || '{}';
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}
