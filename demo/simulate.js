// Shared game rules for the Duel demo. This is the one function both the
// host and every client call — it must stay pure (never mutate `state`)
// since Ristro relies on being able to re-run it safely during replay.

export const ARENA = { width: 480, height: 320 };
export const RADIUS = 16;
const SPEED = 220; // px/sec

export function createInitialState() {
  return {
    t: 0,
    p1: { x: 120, y: 160 },
    p2: { x: 360, y: 160 },
  };
}

export function simulate(state, inputs, dt) {
  const seconds = dt / 1000;
  const t = state.t + dt;

  const input1 = inputs.p1 ?? { dx: 0, dy: 0 };
  const p1 = {
    x: clamp(state.p1.x + input1.dx * SPEED * seconds, RADIUS, ARENA.width - RADIUS),
    y: clamp(state.p1.y + input1.dy * SPEED * seconds, RADIUS, ARENA.height - RADIUS),
  };

  // The "opponent" is a deterministic bot: its position is purely a
  // function of elapsed time, not random and not fed in as input, so both
  // demo lanes compute exactly the same path given the same t. It exists
  // to give the RemoteInterpolator something to smooth.
  const p2 = {
    x: ARENA.width / 2 + Math.cos(t / 900) * 140,
    y: ARENA.height / 2 + Math.sin(t / 600) * 110,
  };

  return { t, p1, p2 };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
