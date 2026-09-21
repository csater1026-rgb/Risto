// Shared game rules for Duel. Pure: never mutate `state`, always return a
// new object. Risto replays this during prediction and reconciliation, so
// any hidden mutation would desync the host from every client.

export const ARENA = { width: 560, height: 400 };
export const RING = { cx: 280, cy: 200, r: 168 };
export const RADIUS = 18;

const ACCEL = 1680; // px/s^2 — snappy enough that a keypress is obvious
const MAX_SPEED = 280;
const FRICTION = 5.2;
const RESTITUTION = 0.92;
export const KO_MS = 900;
export const COUNTDOWN_MS = 750;

export function createInitialState() {
  return {
    t: 0,
    round: 1,
    phase: 'play', // play | ko | countdown
    phaseT: 0,
    scores: { p1: 0, p2: 0 },
    lastKo: null, // 'p1' | 'p2' | 'double' | null
    hit: 0, // 1 the tick a collision impulse was applied, else 0
    p1: spawn(-1),
    p2: spawn(1),
  };
}

function spawn(side) {
  return {
    x: RING.cx + side * 72,
    y: RING.cy,
    vx: 0,
    vy: 0,
  };
}

export function simulate(state, inputs, dt) {
  const seconds = dt / 1000;
  const t = state.t + dt;

  if (state.phase === 'ko') {
    const phaseT = state.phaseT + dt;
    if (phaseT >= KO_MS) {
      return {
        ...state,
        t,
        phase: 'countdown',
        phaseT: 0,
        lastKo: null,
        hit: 0,
        round: state.round + 1,
        p1: spawn(-1),
        p2: spawn(1),
      };
    }
    return { ...state, t, phaseT, hit: 0 };
  }

  if (state.phase === 'countdown') {
    const phaseT = state.phaseT + dt;
    if (phaseT >= COUNTDOWN_MS) {
      return { ...state, t, phase: 'play', phaseT: 0, hit: 0 };
    }
    return { ...state, t, phaseT, hit: 0 };
  }

  // Missing input (client predicting without the opponent's keys) freezes
  // that body so we don't hallucinate their movement. A present {dx:0,dy:0}
  // still integrates — that's a real "I'm standing still" command.
  let p1 = inputs.p1 !== undefined ? integrate(state.p1, inputs.p1, seconds) : copyBody(state.p1);
  let p2 = inputs.p2 !== undefined ? integrate(state.p2, inputs.p2, seconds) : copyBody(state.p2);

  const collided = collide(p1, p2);
  p1 = collided.p1;
  p2 = collided.p2;

  const p1Out = isOut(p1);
  const p2Out = isOut(p2);
  if (p1Out || p2Out) {
    const scores = { p1: state.scores.p1, p2: state.scores.p2 };
    let lastKo = 'double';
    if (p1Out && !p2Out) {
      lastKo = 'p1';
      scores.p2 += 1;
    } else if (p2Out && !p1Out) {
      lastKo = 'p2';
      scores.p1 += 1;
    }
    return {
      ...state,
      t,
      p1,
      p2,
      scores,
      phase: 'ko',
      phaseT: 0,
      lastKo,
      hit: collided.hit,
    };
  }

  return { ...state, t, p1, p2, hit: collided.hit };
}

export function isOut(p) {
  return Math.hypot(p.x - RING.cx, p.y - RING.cy) > RING.r;
}

function copyBody(p) {
  return { x: p.x, y: p.y, vx: p.vx, vy: p.vy };
}

function integrate(p, input, dt) {
  const dx = input?.dx ?? 0;
  const dy = input?.dy ?? 0;
  let vx = p.vx + dx * ACCEL * dt;
  let vy = p.vy + dy * ACCEL * dt;
  const damp = Math.exp(-FRICTION * dt);
  vx *= damp;
  vy *= damp;
  const speed = Math.hypot(vx, vy);
  if (speed > MAX_SPEED) {
    const s = MAX_SPEED / speed;
    vx *= s;
    vy *= s;
  }
  return { x: p.x + vx * dt, y: p.y + vy * dt, vx, vy };
}

function collide(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 1e-6;
  const minDist = RADIUS * 2;
  if (dist >= minDist) return { p1: a, p2: b, hit: 0 };

  const nx = dx / dist;
  const ny = dy / dist;
  const overlap = minDist - dist;

  a = { ...a, x: a.x - nx * overlap * 0.5, y: a.y - ny * overlap * 0.5 };
  b = { ...b, x: b.x + nx * overlap * 0.5, y: b.y + ny * overlap * 0.5 };

  const relVelN = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (relVelN >= 0) return { p1: a, p2: b, hit: 1 };

  const impulse = -(1 + RESTITUTION) * relVelN / 2;
  a = { ...a, vx: a.vx - impulse * nx, vy: a.vy - impulse * ny };
  b = { ...b, vx: b.vx + impulse * nx, vy: b.vy + impulse * ny };
  return { p1: a, p2: b, hit: 1 };
}
