// Headless Playwright check for the Duel demo page. Not part of `npm test`
// (which stays dependency-free) — run explicitly with:
//   node test/demo.e2e.mjs
// against a local static server (e.g. `python3 -m http.server 8123`).
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const BASE_URL = process.env.RISTO_DEMO_URL ?? 'http://localhost:8123/demo/index.html';
const CHROME_CANDIDATES = [
  process.env.PLAYWRIGHT_CHROMIUM,
  '/opt/pw-browsers/chromium',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
].filter(Boolean);

async function main() {
  const executablePath = CHROME_CANDIDATES.find((p) => existsSync(p));
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  // Only real thrown JS exceptions fail the check — incidental console
  // noise (e.g. a missing favicon.ico) isn't a demo bug.
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto(BASE_URL, { waitUntil: 'load' });
  await page.waitForFunction(
    () => window.__ristoDebugState?.risto?.phase === 'play',
    { timeout: 4000 },
  );

  // 1. Page loaded with no JS errors and both canvases present.
  const canvasCount = await page.locator('.lanes canvas').count();
  assert(canvasCount === 2, `expected 2 compare-mode canvases, got ${canvasCount}`);

  // 2. Crank latency + loss up high so the naive-vs-predicted gap is stark.
  await page.locator('#latency').fill('350');
  await page.locator('#latency').dispatchEvent('input');
  await page.locator('#loss').fill('20');
  await page.locator('#loss').dispatchEvent('input');
  await page.waitForTimeout(100);

  const latencyLabel = await page.locator('#latencyOut').textContent();
  assert(latencyLabel.includes('350'), `latency slider didn't apply: ${latencyLabel}`);

  // 3. Hold right. Prediction must queue unacked inputs AND the predicted
  // disc must lead the naive disc — that's the product claim.
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(180);
  const statRisto = await page.locator('#statRisto').textContent();
  const lead = await page.evaluate(() => {
    const { naive, risto } = window.__ristoDebugState;
    return {
      naiveX: naive.p1.x,
      ristoX: risto.p1.x,
      phase: risto.phase,
    };
  });
  await page.keyboard.up('ArrowRight');

  const pending = parseInt(statRisto, 10);
  assert(
    Number.isInteger(pending) && pending > 0,
    `expected Risto lane to have unacknowledged predicted inputs while host RTT is high, got: "${statRisto}"`
  );
  assert(
    lead.phase === 'play',
    `expected to sample during play, got phase=${lead.phase}`
  );
  assert(
    lead.ristoX > lead.naiveX + 8,
    `expected predicted p1 to lead naive p1 under 350ms latency; naive=${lead.naiveX.toFixed(1)} risto=${lead.ristoX.toFixed(1)}`
  );

  // 4. Drop latency/loss back to near zero and confirm the backlog actually
  // drains — proves reconciliation is acknowledging and trimming the input
  // buffer, not just accumulating forever. (Under sustained high latency the
  // buffer is *expected* to stay large — every frame's input is sent even
  // at rest, so backlog size tracks round-trip time, not "settling" time.)
  await page.locator('#latency').fill('10');
  await page.locator('#latency').dispatchEvent('input');
  await page.locator('#loss').fill('0');
  await page.locator('#loss').dispatchEvent('input');
  await page.waitForTimeout(1000);

  const statAfterSettle = await page.locator('#statRisto').textContent();
  const pendingAfter = parseInt(statAfterSettle, 10);
  assert(
    pendingAfter < pending,
    `expected pending input count to drain once latency dropped, before=${pending} after=${pendingAfter}`
  );

  // 5. Verify the interpolated opponent (p2) in the Risto lane moves
  // *smoothly* under jitter (which can reorder RemoteInterpolator.push()
  // calls), not just "moves at all". Sample only while the round is in
  // play so a knockout reset cannot look like an interpolation jump.
  await page.locator('#jitter').fill('60');
  await page.locator('#jitter').dispatchEvent('input');
  await page.waitForFunction(
    () => window.__ristoDebugState?.risto?.phase === 'play',
    { timeout: 4000 },
  );
  await page.waitForTimeout(200);

  const samples = [];
  for (let i = 0; i < 16 && samples.length < 12; i++) {
    const snap = await page.evaluate(() => {
      const s = window.__ristoDebugState.risto;
      return { phase: s.phase, p2: s.p2 };
    });
    if (snap.phase === 'play') samples.push(snap.p2);
    await page.waitForTimeout(25);
  }
  assert(samples.length >= 8, `not enough in-play interpolation samples (${samples.length})`);

  let maxStep = 0;
  let totalMoved = 0;
  for (let i = 1; i < samples.length; i++) {
    const step = Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y);
    maxStep = Math.max(maxStep, step);
    totalMoved += step;
  }

  // MAX_SPEED is 280 px/s → ~7px in 25ms. Interpolation should stay
  // under that plus a little impulse slack. A broken interpolator snaps
  // by tens of pixels.
  assert(
    maxStep < 18,
    `expected smooth interpolation (small, bounded per-step movement); saw a ${maxStep.toFixed(2)}px single-step jump — samples: ${JSON.stringify(samples)}`
  );
  assert(
    totalMoved > 3,
    `expected the interpolated opponent to move at all over the sampling window, total movement was only ${totalMoved.toFixed(2)}px`
  );

  assert(errors.length === 0, `page threw errors: ${errors.join('\n')}`);

  await browser.close();
  console.log('demo.e2e.mjs: all checks passed');
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

main().catch((err) => {
  console.error('demo.e2e.mjs FAILED:', err.message);
  process.exit(1);
});
