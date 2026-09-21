import { ARENA, RING, RADIUS, isOut, COUNTDOWN_MS } from './simulate.js';

const YOU = '#5aa7ff';
const BOT = '#ff5d7a';
const YOU_GLOW = 'rgba(90, 167, 255, 0.55)';
const BOT_GLOW = 'rgba(255, 93, 122, 0.5)';
const SHADOW = 'rgba(180, 220, 255, 0.9)';

function orientState(state, localId) {
  if (!state || localId !== 'p2') return state;
  const lastKo =
    state.lastKo === 'p1' ? 'p2' :
    state.lastKo === 'p2' ? 'p1' :
    state.lastKo;
  return {
    ...state,
    p1: state.p2,
    p2: state.p1,
    scores: state.scores
      ? { p1: state.scores.p2, p2: state.scores.p1 }
      : state.scores,
    lastKo,
  };
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const trails = { p1: [], p2: [] };
  let shake = 0;
  let flash = 0;
  let lastHit = 0;
  let lastKo = null;
  let clashRing = 0;

  return {
    draw(state, {
      now,
      pro = false,
      labels = true,
      showShadow = true,
      localId = 'p1',
      opponentTag = 'BOT',
    } = {}) {
      if (!state) return;
      const view = orientState(state, localId);
      if (view.hit && view.t !== lastHit) {
        shake = view.clash ? 12 : 7;
        flash = view.clash ? 1 : 0.7;
        clashRing = view.clash ? 1 : 0;
        lastHit = view.t;
      }
      if (view.phase === 'ko' && view.lastKo && view.lastKo !== lastKo) {
        shake = 11;
        flash = 1;
      }
      lastKo = view.phase === 'ko' ? view.lastKo : null;

      pushTrail(trails.p1, view.p1);
      pushTrail(trails.p2, view.p2);

      const sx = (Math.random() - 0.5) * shake;
      const sy = (Math.random() - 0.5) * shake;
      shake *= 0.82;
      if (shake < 0.2) shake = 0;
      flash *= 0.88;
      clashRing *= 0.9;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, ARENA.width, ARENA.height);
      ctx.translate(sx, sy);

      drawBackdrop(ctx, pro);
      drawRing(ctx, view, pro);
      drawCurrent(ctx, view.t);
      if (showShadow && view.shadow) {
        drawLink(ctx, view.p1, view.shadow);
        drawShadow(ctx, view.shadow);
      }
      drawTrails(ctx, trails.p1, YOU);
      drawTrails(ctx, trails.p2, BOT);
      drawPlayer(ctx, view.p2, BOT, BOT_GLOW, isOut(view.p2));
      drawPlayer(ctx, view.p1, YOU, YOU_GLOW, isOut(view.p1), view.p1.dashCd > 500);
      if (clashRing > 0.08 && view.p1 && view.p2) {
        drawClash(ctx, view.p1, view.p2, clashRing);
      }
      if (labels) {
        drawTag(ctx, view.p1, 'YOU', YOU);
        drawTag(ctx, view.p2, opponentTag, BOT);
      }
      drawHud(ctx, view, showShadow);
      drawBanner(ctx, view, now, opponentTag);
      if (flash > 0.05) {
        ctx.fillStyle = `rgba(255, 230, 200, ${0.08 * flash})`;
        ctx.fillRect(0, 0, ARENA.width, ARENA.height);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    },
    reset() {
      trails.p1.length = 0;
      trails.p2.length = 0;
      shake = 0;
      flash = 0;
      clashRing = 0;
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

  ctx.beginPath();
  ctx.arc(RING.cx, RING.cy, 3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(170, 196, 220, 0.35)';
  ctx.fill();
  ctx.restore();
}

function drawCurrent(ctx, t) {
  ctx.save();
  ctx.translate(RING.cx, RING.cy);
  ctx.rotate((t || 0) / 1400);
  ctx.strokeStyle = 'rgba(90, 167, 255, 0.16)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * (RING.r - 22), Math.sin(a) * (RING.r - 22));
    ctx.lineTo(Math.cos(a) * (RING.r - 14), Math.sin(a) * (RING.r - 14));
    ctx.stroke();
  }
  ctx.restore();
}

function drawLink(ctx, a, b) {
  const dist = Math.hypot(a.x - b.x, a.y - b.y);
  if (dist < 6) return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = 'rgba(180, 220, 255, 0.28)';
  ctx.setLineDash([3, 5]);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

function drawShadow(ctx, p) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(p.x, p.y, RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(180, 220, 255, 0.07)';
  ctx.fill();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = SHADOW;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = '700 9px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(180, 220, 255, 0.75)';
  ctx.fillText('SHADOW', p.x, p.y + RADIUS + 11);
  ctx.restore();
}

function drawClash(ctx, a, b, amount) {
  const x = (a.x + b.x) / 2;
  const y = (a.y + b.y) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, 18 + (1 - amount) * 36, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(255, 210, 140, ${0.55 * amount})`;
  ctx.lineWidth = 3;
  ctx.stroke();
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

function drawPlayer(ctx, p, color, glow, out, dashing = false) {
  ctx.save();
  ctx.globalAlpha = out ? 0.45 : 1;
  ctx.beginPath();
  ctx.arc(p.x, p.y, RADIUS + (dashing ? 8 : 4), 0, Math.PI * 2);
  ctx.fillStyle = dashing ? 'rgba(255,255,255,0.35)' : glow;
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
  ctx.strokeStyle = dashing ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.35)';
  ctx.lineWidth = dashing ? 3 : 2;
  ctx.stroke();
  ctx.restore();
}

function drawTag(ctx, p, text, color) {
  ctx.font = '700 10px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = color;
  ctx.fillText(text, p.x, p.y - RADIUS - 8);
}

function drawHud(ctx, state, showShadow) {
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

  if (showShadow && state.shadowGap > 4) {
    ctx.font = '600 10px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(180, 220, 255, 0.7)';
    ctx.fillText(`shadow ${Math.round(state.shadowGap)} px ahead of the host`, RING.cx, ARENA.height - 12);
  }
}

function drawBanner(ctx, state, now, opponentTag = 'BOT') {
  if (state.phase === 'countdown') {
    const n = Math.max(1, Math.ceil((COUNTDOWN_MS - state.phaseT) / 250));
    banner(ctx, String(n), 'rgba(230, 237, 243, 0.92)');
    return;
  }
  if (state.phase === 'ko') {
    const text =
      state.lastKo === 'p1' ? "YOU'RE OUT" :
      state.lastKo === 'p2' ? (opponentTag === 'THEM' ? 'THEM OUT' : 'BOT OUT') :
      'DOUBLE OUT';
    const color = state.lastKo === 'p2' ? YOU : BOT;
    banner(ctx, text, color);
    return;
  }
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
