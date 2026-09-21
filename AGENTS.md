# Agent notes

This repository is **Risto**, a dependency-free browser netcode library
(client-side prediction, server reconciliation, entity interpolation)
plus the Duel demo that proves it.

Before changing engine behavior, the demo loop, or the transport
interface, read [RISTO.md](RISTO.md). It is the project knowledge base:
architecture decisions, what is allowed to flake, and what must never
flake on camera.

## Non-negotiables

- The video / landing demo runs on **loopback transport** (two simulated
  peers in one page, through the synthetic lag/loss injector). Do not
  make the main demo depend on real WebRTC or a signaling server.
- `simulate(state, inputs, dt)` must stay **pure**. Prediction and
  reconciliation replay it.
- `ShadowBody` is a first-class mechanic (where the host thinks you
  are), not a debug overlay. Don't hide it by default in the demo.
- Transports share one shape: `send(message)` / `onReceive(handler)`.
  New transports implement that; they do not fork the sim.
- `demo/` is a self-contained page. No bundler required to open it
  (`python3 -m http.server` is enough). `npm run build` is only for
  the npm/UMD artifact.

## Tests

```
npm test              # node:test unit tests, no extra runtime deps
node test/demo.e2e.mjs  # Playwright, needs a static server on :8123
```
