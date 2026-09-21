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

  // 2. Crank latency + loss up high so the naive-vs-predicted gap is stark.
  await page.locator('#latency').fill('350');
  await page.locator('#latency').dispatchEvent('input');
  await page.locator('#loss').fill('20');
  await page.locator('#loss').dispatchEvent('input');
  await page.waitForTimeout(100);

  const latencyLabel = await page.locator('#latencyOut').textContent();
  assert(latencyLabel.includes('350'), `latency slider didn't apply: ${latencyLabel}`);

  // 3. Hold the right-arrow key and sample the Risto (predictive) canvas's
  // underlying render state indirectly by reading pixel data before/after —
  // simpler and more robust: read the lane's pendingInputCount stat, which
  // only moves if local prediction is actually running ahead of host acks.
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

  // 5. Verify the interpolated opponent (p2) in the Risto lane moves
  // *smoothly* under jitter (which can reorder RemoteInterpolator.push()
  // calls), not just "moves at all". A naive "did the position change over
  // 300ms" check is too weak here: even a frozen/broken interpolator (e.g.
  // the clock-mismatch bug, where sample() always returned the oldest
  // buffered snapshot) still advances in discrete jumps as the buffer's
  // trim logic ages old entries out — so net displacement over a long
  // window can look nonzero either way. The real signature of correct
  // interpolation is that *every short step* is small and bounded (true
  // blending between two nearby snapshots); the signature of the bug is
  // long stretches of ~0 movement punctuated by an occasional big jump
  // (holding one stale snapshot, then snapping to the next one aged into
  // range). So sample frequently and check the *largest single step*,
  // not just start-vs-end displacement.
  await page.locator('#jitter').fill('60');
  await page.locator('#jitter').dispatchEvent('input');
  await page.waitForTimeout(200); // let a few snapshots flow through first

  const samples = [];
  for (let i = 0; i < 12; i++) {
    samples.push(await page.evaluate(() => window.__ristoDebugState.risto.p2));
    await page.waitForTimeout(25);
  }

  let maxStep = 0;
  let totalMoved = 0;
  for (let i = 1; i < samples.length; i++) {
    const step = Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y);
    maxStep = Math.max(maxStep, step);
    totalMoved += step;
  }

  // The bot's own top speed (demo/simulate.js: 140px amplitude / ~900ms
  // half-period on x, 110px / ~600ms on y) bounds true smooth per-25ms-step
  // movement at roughly 6px worst case; a discontinuous jump from the bug
  // is many multiples of that. 15px gives real headroom above the smooth
  // bound while staying well below a jump.
  assert(
    maxStep < 15,
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
