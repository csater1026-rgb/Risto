# RISTO.md

Knowledge base for this repository. Read this before changing netcode,
the Duel demo, or the transport layer.

This is the Risto implementation of the "lagless" plan: a small
open-source client-side prediction / server-reconciliation /
entity-interpolation engine for browser games, plus one polished demo
that has to work every take.

Name map from that plan → this repo:

| Plan | This repo |
| --- | --- |
| `lagless-engine.js` | `src/*.js` (ESM, no runtime deps) |
| `lagless.html` | `demo/index.html` |
| `api/lagless-signal.js` | `api/signal.js` |
| `LAGLESS.md` | this file |

The library is an npm package (`risto`) with a real module graph and
tests. The demo still loads those modules as plain ESM — no bundler, no
build step to play Duel.

---

## Product bet

Native engines already have this. The browser/JS ecosystem has backends
and full frameworks, but not a small focused library that *just* does
prediction, reconciliation, and interpolation well — and can *show*
the difference under identical lag.

Duel exists so the README isn't a claim. Side by side, same input, same
injected network: left is naive ("send input, wait, then move"), right
is Risto.

---

## Reliability-first transport (do not reverse this)

Real peer-to-peer WebRTC has a real failure mode: NAT traversal can
just fail. A demo that flakes on camera is worse than no demo.

So transport is a swappable `send` / `onReceive` interface with two
implementations:

1. **Loopback** (`NetworkLink` / `createLoopbackLink`) — two simulated
   peers in the same page, through the synthetic lag/jitter/loss
   injector. This is what Duel and the naive-vs-predicted comparison
   run on. 100% reliable, every take, no network dependency.
2. **WebRTC** (`WebRtcTransport` + `api/signal.js`) — same engine code,
   real transport. Stretch goal. Not the default path. The data channel
   is unordered + unreliable (UDP-shaped); the engine already handles
   drops.

Swapping transports must not touch `simulate`, `PredictionClient`,
`AuthoritativeHost`, or `RemoteInterpolator`.

### Fair comparison

The two demo lanes must **not** roll packet loss independently.
`rollDelivery(conditions)` is applied once per direction per frame and
passed into both lanes. Otherwise you're comparing two different
networks, not two netcodes.

Messages are `structuredClone`d on send so a hop is a copy, like a wire.

---

## Engine pieces

**`InputHistory`** — sequenced local inputs so reconciliation can replay
whatever the host has not acknowledged.

**`PredictionClient`** — applies local input immediately; on snapshot,
snaps to host truth and replays unacked *local* inputs. Other entities
are left as the snapshot had them (we do not guess their keys). Stale
out-of-order snapshots (`tick` too old) are ignored.

**`AuthoritativeHost`** — single source of truth. Holds last input per
player across ticks (continuous hold + dropped-packet papering).
Monotonic `tick` on every snapshot.

**`RemoteInterpolator`** — render remotes in the past, blend between
the two snapshots that bracket render time. `push`/`sample` must share
a clock. On a delayed transport, stamp `push` with **arrival** time, not
the host send stamp — send stamps plus a short delayMs sit in the future
relative to the buffer and `sample()` underruns (never blends).
`push(state)` already defaults to `Date.now()`. Never mix in
`performance.now()`. Out-of-order pushes are dropped. When the buffer
runs dry, a short extrapolation (capped by `maxExtrapolateMs` and one
snapshot span) coasts instead of freezing; `lastStatus` is
`empty|hold|blend|extrapolate|underrun`. Use
`interpolationDelayMs(hostTickMs, jitterMs)` for the buffer depth.

**`PredictedView` / `createLoopbackSession`** — the attach recipe.
`PredictedView` is predict-you + interpolate-them + correction smoother +
Shadow Body. `createLoopbackSession` wires that to an `AuthoritativeHost`
through loopback. Duel's compare lane still owns two hosts (naive vs
Risto); new games should start at `examples/minimal.html`.

**`CorrectionSmoother`** — Valve-style error carry. Simulation snaps;
pixels ease. Distances ≥ `snapDistance` (round resets) snap.

**`ShadowBody`** — last authoritative pose for the local player. Not a
debug overlay: Duel renders it and knockouts are decided on it. Push
from each host snapshot; `ShadowBody.gap(predicted, shadow)` is how far
the player has run ahead of the world.

**`ProbeSampler` / `runProbe`** — one report for game devs covering
injected network, uplink vs downlink path, queues, host tick cost,
client interpolator health, and prediction accuracy. Live in the demo
lab strip; headless via `runProbe` for CI. This is a synthetic gym,
not real internet routing or a GPU profiler.

**`simulate(state, inputs, dt) => newState`** — game rules, **pure**.
A missing key in `inputs` means "this body is unknown this tick: freeze
it." A present `{dx:0,dy:0}` means "standing still." That distinction
is how client prediction avoids hallucinating the opponent.

---

## Duel

Two discs in a ring. Arrow keys / WASD, Space to dash. Knock the other
out. Unique physics: a **ring current** always drifts bodies, a **dash**
may overspeed, and a hard **lip-seeking clash** throws the outer disc
toward the rim.

- You are p1. A deterministic host-side bot is p2 (real inputs, including
  dashes, into the sim). Collision, clash, and knock-out live in
  `simulate`, so they reconcile.
- The hollow disc on the Risto lane is `ShadowBody` — where the host
  thinks you are. Toggle with the Shadow chip. Naive has no split
  (you *are* the delayed body).
- **Compare** mode: naive lane vs Risto lane, coupled network rolls.
- **Play** mode: the Risto lane full-width. Same sim.
- Network presets (LAN / Wi-Fi / 4G / Bad) plus sliders.
- Pro is a RevenueCat Web Billing *stub*. Simulate unlock stores
  `risto.pro` in localStorage and paints the gold ring. There is no
  API key in this repo.

Interpolation delay auto-tunes from tick rate + jitter so `sample()`
still has two snapshots to blend when the injector is being ugly.

---

## What "seamless" means here

The library can be correct and still *feel* broken:

- Predicting with frame `dt` while the host ticks at 50ms will always
  produce small errors. Continuous hold + correction smoothing is how
  those stay invisible.
- Collisions with a remote body will mispredict (you don't have their
  current input). Smoothing + interpolating *them* (not predicting
  them) is the right trade.
- Naive vs predicted only reads as a fair demo if both lanes share
  delivery rolls and the same input stream.

If a change makes the predicted lane rubber-band, hitch, or diverge
from the naive lane's *host* (not view) under identical rolls, it is a
bug.

---

## Stretch: WebRTC

Duel's **Peer** tab is this path: labeled experimental, loopback one
click away. Compare / Play never depend on it.

`createPeerSession({ role, transport })` is a listen-server (host = p1,
guest = p2). `WebRtcTransport.connect({ signaling, role, roomId })`
opens an unordered unreliable data channel. `HttpPollingSignaling`
talks to `api/signal.js`. `npm run signal` runs that relay locally.

Signaling is not a game server — it only swaps SDP/ICE. The host peer
*is* the authority, which is how you skip a global fleet: the sim sits
next to one of the players.

NAT traversal can still fail (no TURN in this repo). Time out, show the
error, stay on loopback. Do not hang the landing demo on this path.

---

## Tests

- `npm test` — `InputHistory`, `PredictionClient` + `AuthoritativeHost`,
  `RemoteInterpolator`, `PredictedView` / `createLoopbackSession` /
  `createPeerSession`, `NetworkLink` / `rollDelivery`,
  `CorrectionSmoother`, `runProbe`, Duel `simulate`, signaling relay.
- `node test/demo.e2e.mjs` — Playwright against `demo/index.html` and
  `examples/minimal.html`. Does not require WebRTC to pass.

---

## House rules

- No runtime dependencies in `src/`.
- Demo is static ESM. Don't introduce a bundler requirement to open it.
- Don't "fix" held-last-input by clearing inputs every tick — that
  makes dropped packets feel like a key release.
- Don't mix clocks on the interpolator.
- Don't invent opponent input on the client.
- Don't demote `ShadowBody` to a debug flag. It is the product.
