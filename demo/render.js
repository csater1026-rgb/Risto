import { ARENA, RING, RADIUS, isOut, COUNTDOWN_MS } from './simulate.js';

const YOU = '#5aa7ff';
const BOT = '#ff5d7a';
const YOU_GLOW = 'rgba(90, 167, 255, 0.55)';
const BOT_GLOW = 'rgba(255, 93, 122, 0.5)';

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const trails = { p1: [], p2: [] };
  let shake = 0;
  let flash = 0;
  let lastHit = 0;
  let lastKo = null;

  return {
    draw(state, { now, pro = false, labels = true } = {}) {
      if (!state) return;
      if (state.hit && state.t !== lastHit) {
        shake = 7;
        flash = 1;
        lastHit = state.t;
      }
      if (state.phase === 'ko' && state.lastKo && state.lastKo !== lastKo) {
        shake = 11;
        flash = 1;
      }
      lastKo = state.phase === 'ko' ? state.lastKo : null;

      pushTrail(trails.p1, state.p1);
      pushTrail(trails.p2, state.p2);

      const sx = (Math.random() - 0.5) * shake;
      const sy = (Math.random() - 0.5) * shake;
      shake *= 0.82;
      if (shake < 0.2) shake = 0;
      flash *= 0.88;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, ARENA.width, ARENA.height);
      ctx.translate(sx, sy);

      drawBackdrop(ctx, pro);
      drawRing(ctx, state, pro);
      drawTrails(ctx, trails.p1, YOU);
      drawTrails(ctx, trails.p2, BOT);
      drawPlayer(ctx, state.p2, BOT, BOT_GLOW, isOut(state.p2));
      drawPlayer(ctx, state.p1, YOU, YOU_GLOW, isOut(state.p1));
      if (labels) {
        drawTag(ctx, state.p1, 'YOU', YOU);
        drawTag(ctx, state.p2, 'BOT', BOT);
      }
      drawHud(ctx, state);
      drawBanner(ctx, state, now);
      if (flash > 0.05) {
        ctx.fillStyle = `rgba(255, 230, 200, ${0.07 * flash})`;
        ctx.fillRect(0, 0, ARENA.width, ARENA.height);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    },
    reset() {
      trails.p1.length = 0;
      trails.p2.length = 0;
      shake = 0;
      flash = 0;
    },
  };
}

function pushTrail(list, p) {
  list.push({ x: p.x, y: p.y });
  if (list.length > 14) list.shift();
}

function drawBackdrop(ctx, pro) {
  const g = ctx.createRadialGradient(RING.cx, RING.cy, 20, RING.cx, RING.cy, 280);
  g.addColorStop(0, pro ? '#1a1408' : '#121820');
  g.addColorStop(1, '#07090c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, ARENA.width, ARENA.height);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, ARENA.width, ARENA.height);
  ctx.arc(RING.cx, RING.cy, RING.r, 0, Math.PI * 2, true);
  ctx.clip('evenodd');
  ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
  ctx.fillRect(0, 0, ARENA.width, ARENA.height);
  ctx.restore();
}

function drawRing(ctx, state, pro) {
  const danger = state.phase === 'ko' ? 1 : 0;
  ctx.save();
  ctx.beginPath();
  ctx.arc(RING.cx, RING.cy, RING.r, 0, Math.PI * 2);
  ctx.strokeStyle = pro ? '#e7c36a' : danger ? '#ff6b6b' : 'rgba(170, 196, 220, 0.55)';
  ctx.lineWidth = 3;
  ctx.shadowColor = pro ? '#e7c36a' : danger ? '#ff4d4d' : 'rgba(90, 167, 255, 0.35)';
  ctx.shadowBlur = 18;
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.arc(RING.cx, RING.cy, RING.r - 10, 0, Math.PI * 2);
  ctx.setLineDash([5, 9]);
  ctx.strokeStyle = 'rgba(170, 196, 220, 0.18)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.setLineDash([]);

  // Center mark
  ctx.beginPath();
  ctx.arc(RING.cx, RING.cy, 3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(170, 196, 220, 0.35)';
  ctx.fill();
  ctx.restore();
}

function drawTrails(ctx, trail, color) {
  for (let i = 0; i < trail.length; i++) {
    const t = (i + 1) / trail.length;
    ctx.beginPath();
    ctx.arc(trail[i].x, trail[i].y, RADIUS * 0.35 * t, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.12 * t;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawPlayer(ctx, p, color, glow, out) {
  ctx.save();
  ctx.globalAlpha = out ? 0.45 : 1;
  ctx.beginPath();
  ctx.arc(p.x, p.y, RADIUS + 4, 0, Math.PI * 2);
  ctx.fillStyle = glow;
  ctx.filter = 'blur(4px)';
  ctx.fill();
  ctx.filter = 'none';

  ctx.beginPath();
  ctx.arc(p.x, p.y, RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(p.x - 4, p.y - 5, 6, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(p.x, p.y, RADIUS, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function drawTag(ctx, p, text, color) {
  ctx.font = '700 10px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = color;
  ctx.fillText(text, p.x, p.y - RADIUS - 8);
}

function drawHud(ctx, state) {
  ctx.font = '700 18px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = YOU;
  ctx.fillText(String(state.scores.p1), 16, 28);
  ctx.textAlign = 'right';
  ctx.fillStyle = BOT;
  ctx.fillText(String(state.scores.p2), ARENA.width - 16, 28);

  ctx.textAlign = 'center';
  ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(180, 196, 214, 0.7)';
  ctx.fillText(`ROUND ${state.round}`, RING.cx, 26);
}

function drawBanner(ctx, state, now) {
  if (state.phase === 'countdown') {
    const n = Math.max(1, Math.ceil((COUNTDOWN_MS - state.phaseT) / 250));
    banner(ctx, String(n), 'rgba(230, 237, 243, 0.92)');
    return;
  }
  if (state.phase === 'ko') {
    const text =
      state.lastKo === 'p1' ? "YOU'RE OUT" :
      state.lastKo === 'p2' ? 'BOT OUT' :
      'DOUBLE OUT';
    const color = state.lastKo === 'p2' ? YOU : BOT;
    banner(ctx, text, color);
    return;
  }
  // Tiny pulse so a still frame still feels alive
  if (now) {
    ctx.globalAlpha = 0.04 + 0.04 * Math.sin(now / 400);
    ctx.beginPath();
    ctx.arc(RING.cx, RING.cy, RING.r, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function banner(ctx, text, color) {
  ctx.save();
  ctx.font = '800 28px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, RING.cy - 28, ARENA.width, 56);
  ctx.fillStyle = color;
  ctx.fillText(text, RING.cx, RING.cy + 2);
  ctx.restore();
}
