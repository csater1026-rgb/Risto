# Risto

<p align="center">
  <img src="demo/risto-logo.png" alt="Ristro" width="220" />
</p>

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
- **Shadow Body is the differentiator.** Other stacks hide the split
  between your predicted pixels and the server's pose. Risto exposes it
  as a first-class object you can render and design around. In Duel, the
  hollow disc is where knockouts are actually decided — high ping becomes
  a skill, not just a bug.

## Install

```bash
npm install risto
```

Or drop `dist/risto.global.js` on a page with a `<script>` tag — it exposes
a `Risto` global with the same exports.

## Attach your game

Risto is not a game engine. You keep Phaser, Three.js, Canvas, whatever.
You attach at **one function**:

```js
function simulate(state, inputs, dt) {
  // YOUR rules. Pure: do not mutate `state`, return a new one.
  // `inputs.p1`, `inputs.p2`, … are whatever you sent (stick, buttons, dash).
  // `dt` is milliseconds.
  return nextState;
}
```

That same function runs on the host (truth) and on each client
(prediction + replay). If it isn’t pure, reconciliation will desync.

### 1. Drop the library in

```bash
npm install risto
```

```js
import {
  PredictionClient,
  AuthoritativeHost,
  RemoteInterpolator,
  CorrectionSmoother,
  ShadowBody,
  PredictedView,        // client bundle: predict + interpolate + shadow
  createLoopbackSession, // host + PredictedView + fake network
  createPeerSession,    // listen-server over any send/onReceive transport
  createLoopbackLink,   // in-page fake network (start here)
  WebRtcTransport,      // later: real peer
  ProbeSampler,         // live lab meters in your debug HUD
  runProbe,             // CI: one report, no canvas
} from 'risto';
```

### Fastest path: `createLoopbackSession`

Open [`examples/minimal.html`](examples/minimal.html) (static ESM, same as Duel).
That file is the whole attach recipe: your `simulate`, one session object,
your renderer.

```js
import { createLoopbackSession, lerpPose } from 'risto';

const session = createLoopbackSession({
  simulate,
  initialState,
  playerId: 'p1',
  conditions: { latencyMs: 150, jitterMs: 20, lossRate: 0.02 },
});

function frame(dt, input, now) {
  session.applyLocalInput(input, dt);
  session.stepHost(dt, { p2: botInput }); // or omit if the host gets real peers
  const { you, them, shadow, shadowGap, pending, interpStatus } =
    session.sample(now, dt / 1000, lerpPose);
  render({ you, them, shadow, shadowGap, pending, interpStatus });
}
```

When you swap loopback for WebRTC, use `createPeerSession({ role, transport })`
with a `WebRtcTransport`. Remotes are still stamped on arrival.

### 2. Host peer (or dedicated server)

Whoever is authority constructs an `AuthoritativeHost` with **your**
`simulate` and **your** `initialState`. On a fixed tick (e.g. 20 Hz):

```js
host.receiveInput(playerId, seq, input);
const snapshot = host.tick(50);
transport.send(snapshot);
```

### 3. Each player’s client

```js
const client = new PredictionClient({ simulate, playerId: 'p1', initialState });
const remote = new RemoteInterpolator({ delayMs: 100 });
const smoother = new CorrectionSmoother();
const shadow = new ShadowBody();

function onLocalInput(input, dt) {
  const { seq, state } = client.applyLocalInput(input, dt);
  transport.send({ seq, input });
  drawYou(smoother.apply(state.p1, dt / 1000));
}

transport.onReceive((snapshot) => {
  const prev = client.getState().p1;
  client.reconcile(snapshot);
  smoother.note(prev, client.getState().p1);
  shadow.push(snapshot.state.p1, snapshot.timestamp); // hollow disc
  remote.push(snapshot.state.p2); // arrival clock (default Date.now())
});

function frame(now) {
  const you = smoother.apply(client.getState().p1, 1 / 60);
  const them = remote.sample(Date.now(), lerp);
  const hostYou = shadow.sample(); // where the world actually hits you
  render({ you, them, hostYou });
}
```

Your renderer only reads positions. Risto never touches the canvas.

### 4. Transport is a plug

Start with loopback (two players in one tab, sliders for lag). When you
want a friend on another device, swap in `WebRtcTransport` or your own
socket — anything with `send` / `onReceive`. The sim does not change.

```js
const { toHost, toClient } = createLoopbackLink({ latencyMs: 150, jitterMs: 30, lossRate: 0.05 });
toHost.onReceive((msg) => host.receiveInput('p1', msg.seq, msg.input));
toClient.onReceive((snapshot) => client.reconcile(snapshot));
```

### 5. Lab / CI (optional)

In your game loop, `probe.record({ frameMs, hostTickMs, pending, shadowGap, … })`
and show `probe.report(conditions)` on a debug HUD — same six cells as Duel.

In tests, don’t boot the game at all:

```js
import { runProbe, mulberry32 } from 'risto';

test('4G still feels ok', () => {
  const report = runProbe({
    simulate,              // the same function production uses
    initialState,
    seconds: 4,
    conditions: { latencyMs: 150, jitterMs: 30, lossRate: 0.05 },
    inputAt: () => ({ dx: 1, dy: 0 }),
    rng: mulberry32(1),
  });
  assert.ok(report.feel.score > 60);
  assert.ok(report.server.onBudget);
});
```

Duel (`demo/`) is that recipe with two discs. The copy-paste version of
the loop is `createLoopbackSession` in `examples/minimal.html` — do not
copy `demo/lane.js` (that file is the naive-vs-Risto comparison).

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

onRemoteSnapshot((state) => remote.push(state)); // arrival time, default Date.now()

// Every render frame — same clock you stamped `push` with (Date.now()).
// Do not pass the host's send stamp after a delayed hop: `now - delayMs`
// will sit ahead of the buffer and sample() will never blend.
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
`send` / `onReceive` shape. `createPeerSession({ role, transport })`
is the listen-server wiring: host ticks, guest predicts.

## One lab report for game devs

```js
import { runProbe, mulberry32 } from 'risto';

const report = runProbe({
  simulate,
  initialState,
  seconds: 4,
  conditions: { latencyMs: 150, jitterMs: 30, lossRate: 0.05 },
  inputAt: (t) => ({ dx: 1, dy: 0 }),
  rng: mulberry32(1),
});
// report.network / routing / queueing / server / rendering / prediction / feel
```

That is a synthetic gym (injected lag, uplink vs downlink, queues, host
tick time, interpolator underruns, Shadow Body gap). It is not real
internet routing or a GPU profiler. The Duel page shows the same six
layers live and can copy the JSON.

## Demo

`demo/` is **Duel**: two discs, one ring, knock the other out. Open
`demo/index.html` via any static server (no bundler). Compare mode runs
the same fight twice under identical injected lag — naive networking on
the left, Risto on the right, with your **Shadow Body** drawn as a hollow
disc. Space dashes. A hard clash near the lip throws the outer disc out.
Play mode is the predicted lane full-width.

The page uses loopback transport on purpose for Compare / Play. **Peer**
is an opt-in experimental listen-server over WebRTC (same `simulate`,
host is p1 in one tab, guest is p2 in another). NAT can fail; loopback
is one click away.

```bash
npx --yes serve -l 8123   # or: python3 -m http.server 8123
npm run signal            # http://localhost:8787 — not a game server
# open http://localhost:8123/demo/index.html → Peer → Host
# other machine: Peer → same room → Join  (or use Copy join link)
```

`createPeerSession` is the attach recipe for any `send` / `onReceive`
transport, including `WebRtcTransport`.

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
