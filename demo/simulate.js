// Shared game rules for Duel. Pure: never mutate `state`, always return a
// new object. Risto replays this during prediction and reconciliation, so
// any hidden mutation would desync the host from every client.
//
// Physics that other "two circles" demos don't have:
//   - Ring current: a slow spin field. Standing still still drifts.
//   - Dash: a cooldown burst that is allowed to overspeed.
//   - Lip-seeking clash: a hard hit throws the outer disc toward the rim.
// Those three make prediction *matter* — a dash you feel instantly is a
// KO the shadow (host body) still has to survive.

export const ARENA = { width: 560, height: 400 };
export const RING = { cx: 280, cy: 200, r: 168 };
export const RADIUS = 18;

const ACCEL = 1680;
const MAX_SPEED = 280;
const FRICTION = 5.2;
const RESTITUTION = 0.92;
const RING_CURRENT = 70; // px/s^2 tangential
const DASH_BURST = 520; // extra px/s, applied once per cooldown
export const DASH_COOLDOWN_MS = 700;
export const CLASH_SPEED = 240; // closing speed that triggers a lip-seeker
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
    hit: 0,
    clash: 0, // closing speed of a lip-seeking clash this tick, else 0
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
    dashCd: 0,
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
        clash: 0,
        round: state.round + 1,
        p1: spawn(-1),
        p2: spawn(1),
      };
    }
    return { ...state, t, phaseT, hit: 0, clash: 0 };
  }

  if (state.phase === 'countdown') {
    const phaseT = state.phaseT + dt;
    if (phaseT >= COUNTDOWN_MS) {
      return { ...state, t, phase: 'play', phaseT: 0, hit: 0, clash: 0 };
    }
    return { ...state, t, phaseT, hit: 0, clash: 0 };
  }

  // Missing input (client predicting without the opponent's keys) freezes
  // that body so we don't hallucinate their movement. A present {dx:0,dy:0}
  // still integrates — that's a real "I'm standing still" command.
  let p1 = inputs.p1 !== undefined ? integrate(state.p1, inputs.p1, seconds, dt) : copyBody(state.p1);
  let p2 = inputs.p2 !== undefined ? integrate(state.p2, inputs.p2, seconds, dt) : copyBody(state.p2);

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
      clash: collided.clash,
    };
  }

  return { ...state, t, p1, p2, hit: collided.hit, clash: collided.clash };
}

export function isOut(p) {
  return Math.hypot(p.x - RING.cx, p.y - RING.cy) > RING.r;
}

function copyBody(p) {
  return { x: p.x, y: p.y, vx: p.vx, vy: p.vy, dashCd: p.dashCd ?? 0 };
}

function integrate(p, input, dt, dtMs) {
  const dx = input?.dx ?? 0;
  const dy = input?.dy ?? 0;
  let vx = p.vx + dx * ACCEL * dt;
  let vy = p.vy + dy * ACCEL * dt;

  // Ring current: a clockwise-tangent field. Makes interpolation of the
  // opponent obviously necessary — the whole arena is always moving.
  const rx = p.x - RING.cx;
  const ry = p.y - RING.cy;
  const rlen = Math.hypot(rx, ry) || 1;
  vx += (-ry / rlen) * RING_CURRENT * dt;
  vy += (rx / rlen) * RING_CURRENT * dt;

  const damp = Math.exp(-FRICTION * dt);
  vx *= damp;
  vy *= damp;

  const speed = Math.hypot(vx, vy);
  if (speed > MAX_SPEED) {
    const s = MAX_SPEED / speed;
    vx *= s;
    vy *= s;
  }

  let dashCd = Math.max(0, (p.dashCd ?? 0) - dtMs);
  if (input?.dash && dashCd <= 0) {
    let fx = dx;
    let fy = dy;
    const facing = Math.hypot(fx, fy);
    if (facing < 0.15) {
      const v = Math.hypot(vx, vy);
      if (v > 8) {
        fx = vx / v;
        fy = vy / v;
      } else {
        fx = -rx / rlen;
        fy = -ry / rlen;
      }
    } else {
      fx /= facing;
      fy /= facing;
    }
    vx += fx * DASH_BURST;
    vy += fy * DASH_BURST;
    dashCd = DASH_COOLDOWN_MS;
  }

  return { x: p.x + vx * dt, y: p.y + vy * dt, vx, vy, dashCd };
}

function collide(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 1e-6;
  const minDist = RADIUS * 2;
  if (dist >= minDist) return { p1: a, p2: b, hit: 0, clash: 0 };

  const nx = dx / dist;
  const ny = dy / dist;
  const overlap = minDist - dist;

  a = { ...a, x: a.x - nx * overlap * 0.5, y: a.y - ny * overlap * 0.5 };
  b = { ...b, x: b.x + nx * overlap * 0.5, y: b.y + ny * overlap * 0.5 };

  const relVelN = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (relVelN >= 0) return { p1: a, p2: b, hit: 1, clash: 0 };

  const impulse = -(1 + RESTITUTION) * relVelN / 2;
  a = { ...a, vx: a.vx - impulse * nx, vy: a.vy - impulse * ny };
  b = { ...b, vx: b.vx + impulse * nx, vy: b.vy + impulse * ny };

  // Lip-seeker: a hard clash throws whoever is closer to the rim further
  // *out*. That's the unique KO skill — time a dash when they're already
  // near the edge, and the ring itself finishes the job.
  const closing = -relVelN;
  let clash = 0;
  if (closing > CLASH_SPEED) {
    clash = closing;
    const bite = (closing - CLASH_SPEED) * 0.45;
    const aR = Math.hypot(a.x - RING.cx, a.y - RING.cy);
    const bR = Math.hypot(b.x - RING.cx, b.y - RING.cy);
    if (aR >= bR) a = radialKick(a, bite);
    else b = radialKick(b, bite);
  }

  return { p1: a, p2: b, hit: 1, clash };
}

function radialKick(p, scale) {
  const rx = p.x - RING.cx;
  const ry = p.y - RING.cy;
  const len = Math.hypot(rx, ry) || 1;
  return { ...p, vx: p.vx + (rx / len) * scale, vy: p.vy + (ry / len) * scale };
}
