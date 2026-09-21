import { RING } from './simulate.js';

/**
 * Host-side bot. Deterministic given the state, so two comparison lanes
 * with identical host inputs produce the same opponent — the split you
 * see is the netcode, not a different fight.
 *
 * Orbits first so interpolation has motion and the player can feel
 * prediction. Short charge windows later, aimed through the player
 * toward the nearest lip.
 */
export function thinkBot(state) {
  const me = state.p2;
  const you = state.p1;
  const t = state.t / 1000;

  const toYouX = you.x - me.x;
  const toYouY = you.y - me.y;
  const dist = Math.hypot(toYouX, toYouY) || 1;

  const orbit = t * 1.15;
  const radius = RING.r * 0.52;
  const orbitX = RING.cx + Math.cos(orbit) * radius;
  const orbitY = RING.cy + Math.sin(orbit) * radius;

  const cycle = t % 5.5;
  const charge = t > 2.2 && cycle > 4.15 && cycle < 4.85;

  let tx;
  let ty;
  if (charge && dist < RING.r * 1.5) {
    const outX = you.x - RING.cx;
    const outY = you.y - RING.cy;
    tx = toYouX / dist + outX * 0.01;
    ty = toYouY / dist + outY * 0.01;
  } else {
    tx = orbitX - me.x;
    ty = orbitY - me.y;
  }

  const mag = Math.hypot(tx, ty) || 1;
  return { dx: tx / mag, dy: ty / mag };
}
