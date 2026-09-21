# Risto

Client-side prediction, server reconciliation, and entity interpolation for
real-time browser games — the same techniques competitive multiplayer games
(Counter-Strike, Overwatch, Rocket League) use to hide network latency,
packaged as a small, dependency-free library instead of something you have
to build from scratch.

Most web games either accept the lag of "send input, wait for the server,
then move" or never attempt real-time multiplayer at all, because the
theory is scattered across blog posts and the implementation has enough
subtle edge cases (replay ordering, interpolation timing, reconciliation
without visible rewinding) that it's easy to get wrong. Risto is the
reusable, tested version of that theory.

## Why this exists

- **In native engines this is solved.** Unity, Unreal, and friends have
  mature production netcode libraries. In the browser/JS ecosystem, options
  are much thinner — full backend frameworks exist, but there wasn't a
  small, focused library that *just* does prediction, reconciliation, and
  interpolation well.
- **It's meant to be understood, not just used.** The included demo runs
  the same game two ways side by side under identical injected latency and
  packet loss — naive networking vs. Risto — so the difference (and the
  reason for it) is visible, not just claimed.

## Install

```bash
npm install risto
```

Or drop `dist/risto.global.js` on a page with a `<script>` tag — it exposes
a `Risto` global with the same exports.

## The three pieces

**1. Predict locally, the instant input happens.**

```js
import { PredictionClient } from 'risto';

const client = new PredictionClient({
  simulate, // (state, inputs, dt) => newState — your game's rules, pure
  playerId: 'p1',
  initialState,
});

// Call this the moment the player does something. It applies the input to
// the local state right away and remembers it for later replay.
const { seq, state } = client.applyLocalInput(input, dt);
render(state); // no waiting on the network
sendToHost({ seq, input });
```

**2. The host stays authoritative, and reconciles clients that predicted wrong.**

```js
import { AuthoritativeHost } from 'risto';

const host = new AuthoritativeHost({ simulate, initialState });

onInputReceived((playerId, seq, input) => {
  host.receiveInput(playerId, seq, input);
});

// On a fixed tick:
const snapshot = host.tick(dt);
broadcastToClients(snapshot);
```

```js
// Back on the client, when a snapshot arrives:
onSnapshotReceived((snapshot) => {
  // Snaps to the host's truth, then replays every input the host hasn't
  // acknowledged yet — corrects instantly without visibly rewinding.
  const state = client.reconcile(snapshot);
  render(state);
});
```

**3. Smooth out everyone *else*, since you can't predict their input.**

```js
import { RemoteInterpolator } from 'risto';

const remote = new RemoteInterpolator({ delayMs: 100 });

onRemoteSnapshot((state, timestamp) => remote.push(state, timestamp));

// Every render frame — same clock the host stamped the snapshot with
// (Date.now(), not performance.now()).
const smoothed = remote.sample(Date.now(), (a, b, t) => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
}));
```

## Testing under real conditions without a real network

```js
import { createLoopbackLink } from 'risto';

// Two-way channel with adjustable, reproducible latency/jitter/loss —
// useful for demos and for testing your own game's feel before you ever
// touch real WebRTC.
const { toClient, toHost } = createLoopbackLink({
  latencyMs: 150,
  jitterMs: 30,
  lossRate: 0.05,
});
```

A real transport (e.g. a WebRTC data channel) implements the same
`send` / `onReceive` shape, so swapping one for the other doesn't touch any
of the netcode logic above it.

## Demo

`demo/` is **Duel**: two discs, one ring, knock the other out. Open
`demo/index.html` via any static server (no bundler). Compare mode runs
the same fight twice under identical injected lag — naive networking on
the left, Risto on the right. Play mode is the predicted lane full-width.

The page uses loopback transport on purpose. Real WebRTC is implemented
(`WebRtcTransport` + `api/signal.js`) but is a stretch goal; NAT
traversal can fail, and a demo that flakes on camera is worse than no
demo. See `RISTO.md`.

## Development

```bash
npm install
npm test    # unit tests for the engine + Duel simulate — node:test
npm run build   # produces dist/risto.esm.js and dist/risto.global.js
```

## Design notes

- `simulate(state, inputs, dt) => newState` must be **pure** — treat
  `state` as immutable and return a new value. Both prediction/replay and
  reconciliation depend on being able to re-run it safely on old states.
- The host "holds" the last input it received per player across ticks
  rather than clearing it every tick. This is deliberate: it represents
  continuous input (a key still being held) rather than one-off events, and
  it papers over the occasional dropped input packet.
- Reconciliation only replays the *local* player's own unacknowledged
  inputs on top of the host's snapshot. It does not attempt to predict
  what other players did in that same window — that's what
  `RemoteInterpolator` is for.
- `CorrectionSmoother` carries visual error after a reconcile so a
  collision the client didn't predict eases instead of popping. Round
  resets snap (they are supposed to teleport).
- A missing key in `inputs` means "freeze this body"; a present
  `{dx:0,dy:0}` means "standing still." Client prediction omits the
  opponent's keys on purpose.

## License

MIT
