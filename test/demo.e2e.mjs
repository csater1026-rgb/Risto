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
