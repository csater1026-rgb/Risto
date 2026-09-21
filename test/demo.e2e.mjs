// Headless Playwright check for the Duel demo page. Not part of `npm test`
// (which stays dependency-free) — run explicitly with:
//   node test/demo.e2e.mjs
// against a local static server (e.g. `python3 -m http.server 8123`).
import { chromium } from 'playwright';

const BASE_URL = process.env.RISTO_DEMO_URL ?? 'http://localhost:8123/demo/index.html';

async function main() {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
  });
  const page = await browser.newPage();
  // Only real thrown JS exceptions fail the check — incidental console
  // noise (e.g. a missing favicon.ico) isn't a demo bug.
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto(BASE_URL, { waitUntil: 'load' });
  await page.waitForTimeout(300);

  // 1. Page loaded with no JS errors and both canvases present.
  const canvasCount = await page.locator('canvas').count();
  assert(canvasCount === 2, `expected 2 canvases, got ${canvasCount}`);

  // 1b. Verify smooth interpolation at the page's own untouched defaults
  // (150ms latency, 30ms jitter) — before any slider is touched. This is
  // exactly the regime a real visitor/judge sees first, and exactly the
  // regime a real bug lived in: RemoteInterpolator's delayMs was a
  // constant (100ms) smaller than the default latency (150ms), so
  // sample() always clamped to the *newest* buffered snapshot instead of
  // ever blending — see demo/lane.js's setNetworkConditions.
  const defaultLatency = await page.locator('#latencyOut').textContent();
  assert(defaultLatency.includes('150'), `expected default latency to still be 150ms, got: ${defaultLatency}`);
  await assertSmoothInterpolation(page, 'at default settings (150ms latency)');

  // 2. Crank latency + loss up high so the naive-vs-predicted gap is stark.
  await page.locator('#latency').fill('350');
  await page.locator('#latency').dispatchEvent('input');
  await page.locator('#loss').fill('20');
  await page.locator('#loss').dispatchEvent('input');
  await page.waitForTimeout(100);

  const latencyLabel = await page.locator('#latencyOut').textContent();
  assert(latencyLabel.includes('350'), `latency slider didn't apply: ${latencyLabel}`);

  // 2b. Interpolation must still work at a much higher latency too — this
  // is what setNetworkConditions' dynamic delayMs (latency + jitter + 2
  // host ticks) exists for for; a fixed delay tuned only for the default
  // would fail again the moment latency changes.
  await page.waitForTimeout(200); // let snapshots at the new latency start flowing
  await assertSmoothInterpolation(page, 'at 350ms latency');

  // 3. Hold the right-arrow key and confirm local prediction is actually
  // running ahead of host acknowledgment (pendingInputCount > 0) while RTT
  // is high — this only happens if applyLocalInput() predicts immediately
  // instead of waiting for the network.
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(120); // a few animation frames, well under the 350ms host RTT
  const statRisto = await page.locator('#statRisto').textContent();
  await page.keyboard.up('ArrowRight');

  const pending = parseInt(statRisto, 10);
  assert(
    Number.isInteger(pending) && pending > 0,
    `expected Risto lane to have unacknowledged predicted inputs while host RTT is high, got: "${statRisto}"`
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

  // 5. Interpolation under jitter specifically (which can reorder
  // RemoteInterpolator.push() calls — guarded against separately).
  await page.locator('#jitter').fill('60');
  await page.locator('#jitter').dispatchEvent('input');
  await page.waitForTimeout(200); // let a few snapshots flow through first
  await assertSmoothInterpolation(page, 'under 60ms jitter');

  assert(errors.length === 0, `page threw errors: ${errors.join('\n')}`);

  await browser.close();
  console.log('demo.e2e.mjs: all checks passed');
}

/**
 * Samples the Risto lane's interpolated opponent (p2) at high frequency
 * and checks for both known failure signatures, since neither alone is a
 * reliable detector:
 *
 * - Jump discontinuity (bug: sample() frozen on the *oldest* buffered
 *   snapshot, e.g. from a clock-unit mismatch): long stretches of ~0
 *   movement punctuated by an occasional big jump when the buffer's trim
 *   logic finally ages the stale entry out. Net displacement over a long
 *   window can look nonzero even when broken, so this checks the *largest
 *   single step* between samples, not start-vs-end displacement.
 *
 * - Exact-duplicate holds (bug: sample() clamped to the *newest* buffered
 *   snapshot instead of ever blending, e.g. from delayMs being smaller
 *   than actual transit latency): the returned value is literally
 *   `buf[last].state`, fixed until the next snapshot arrives — so
 *   consecutive samples taken faster than the host's tick rate repeat the
 *   *exact* same value. True interpolation is a continuous function of
 *   real time and, modulo floating-point noise, should never return two
 *   bit-for-bit identical points in a row. Total per-window movement can
 *   look fine here too (clamp-to-newest still advances every host tick,
 *   just in steps instead of a blend), so jump-size alone doesn't catch
 *   this — only the repeated-value pattern does.
 */
async function assertSmoothInterpolation(page, label) {
  const samples = [];
  for (let i = 0; i < 12; i++) {
    samples.push(await page.evaluate(() => window.__ristoDebugState.risto.p2));
    await page.waitForTimeout(25);
  }

  let maxStep = 0;
  let totalMoved = 0;
  let exactDuplicates = 0;
  for (let i = 1; i < samples.length; i++) {
    const step = Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y);
    maxStep = Math.max(maxStep, step);
    totalMoved += step;
    if (samples[i].x === samples[i - 1].x && samples[i].y === samples[i - 1].y) {
      exactDuplicates += 1;
    }
  }

  // The bot's own top speed (demo/simulate.js: 140px amplitude / ~900ms
  // half-period on x, 110px / ~600ms on y) bounds true smooth per-25ms-step
  // movement at roughly 6px worst case; a discontinuous jump from the
  // clock-mismatch bug is many multiples of that. 15px gives real headroom
  // above the smooth bound while staying well below a jump.
  assert(
    maxStep < 15,
    `${label}: expected smooth interpolation (small, bounded per-step movement); saw a ${maxStep.toFixed(2)}px single-step jump — samples: ${JSON.stringify(samples)}`
  );
  assert(
    totalMoved > 3,
    `${label}: expected the interpolated opponent to move at all over the sampling window, total movement was only ${totalMoved.toFixed(2)}px`
  );
  // Zero tolerance would be strictly correct but brittle against a coincidental
  // exact-float-repeat; allow at most one as noise margin.
  assert(
    exactDuplicates <= 1,
    `${label}: expected interpolation to vary continuously; saw ${exactDuplicates}/11 consecutive samples with an *exact* duplicate position (the signature of sample() clamping to a held snapshot instead of blending) — samples: ${JSON.stringify(samples)}`
  );
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

main().catch((err) => {
  console.error('demo.e2e.mjs FAILED:', err.message);
  process.exit(1);
});
