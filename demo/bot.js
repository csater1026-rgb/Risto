import { RING } from './simulate.js';

/**
 * Host-side bot. Deterministic given the state, so two comparison lanes
 * with identical host inputs produce the same opponent — the split you
 * see is the netcode, not a different fight.
 *
 * Circles the ring and periodically cuts in to shove the player toward
 * the nearest lip. Always moving, so interpolation has something to do.
 */
export function thinkBot(state) {
  const me = state.p2;
  const you = state.p1;
  const t = state.t / 1000;

  const toYouX = you.x - me.x;
  const toYouY = you.y - me.y;
  const dist = Math.hypot(toYouX, toYouY) || 1;

  const orbit = t * 1.35;
  const radius = RING.r * 0.46;
  const orbitX = RING.cx + Math.cos(orbit) * radius;
  const orbitY = RING.cy + Math.sin(orbit) * radius;

  // Charge window: ~45% of a 2.4s cycle. Enough hits to look like a fight,
  // not so many that the player never gets a turn.
  const charge = Math.sin(t * 0.9 + 0.4) > 0.1;

  let tx;
  let ty;
  if (charge && dist < RING.r * 1.4) {
    const outX = you.x - RING.cx;
    const outY = you.y - RING.cy;
    tx = toYouX / dist * 1.1 + outX * 0.012;
    ty = toYouY / dist * 1.1 + outY * 0.012;
  } else {
    tx = orbitX - me.x;
    ty = orbitY - me.y;
  }

  const mag = Math.hypot(tx, ty) || 1;
  return { dx: tx / mag, dy: ty / mag };
}
