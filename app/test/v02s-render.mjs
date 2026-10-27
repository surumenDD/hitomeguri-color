import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from '../../tools/visual-qa/node_modules/playwright-core/index.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = path.join(root, 'test/results/v02s');
await mkdir(out, { recursive: true });
const report = { scenes: [], backgroundRegression: [], errors: [] };
const server = await createServer({
  root,
  base: '/',
  server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
  logLevel: 'error',
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  page.on('pageerror', (e) => report.errors.push(e.message));
  await page.goto(`${server.resolvedUrls.local[0]}test/v02-engine.html`);
  await page.waitForFunction(() => window.foregroundTest);
  const samples = await page.evaluate(async () => (await import('/src/samples.ts')).SAMPLES);
  for (const sample of samples) {
    const loaded = await page.evaluate(
      (s) => window.foregroundTest.load(s.url, s.foreground?.url, s.foreground?.x, s.foreground),
      sample,
    );
    const result = await page.evaluate(() => window.foregroundTest.verify());
    if (sample.foreground) report.scenes.push({ id: sample.id, ...loaded, ...result });
    assert.ok(
      result.backgroundEndpoints.every((r) => r.max === 0),
      `${sample.id}: WebP endpoints`,
    );
    assert.ok(
      result.noForeground.every((r) => r.max === 0),
      `${sample.id}: old shader parity`,
    );
    report.backgroundRegression.push({ id: sample.id, comparisons: result.noForeground });
    if (!sample.foreground) continue;
    assert.ok(
      result.endpoints.every((r) => r.max <= 1),
      `${sample.id}: CPU composite`,
    );
    assert.ok(
      result.loopSeams.every((r) => r.max === 0),
      `${sample.id}: exact seam`,
    );
    assert.ok(
      result.adaptation.every((r) => r.max <= 1),
      `${sample.id}: v2 CPU formula`,
    );
    const performance = await page.evaluate(() => window.foregroundTest.performanceTest());
    assert.ok(performance.wallMedianMs < 1000 / 60);
    assert.ok(performance.rafMedianMs < 17.5);
    const thumbnail = await page.evaluate(async (url) => {
      const { decodeImage } = await import('/src/image.ts');
      const generated = await decodeImage(
        `data:image/png;base64,${window.foregroundTest.thumbnail()}`,
      );
      const distributed = await decodeImage(url);
      let max = 0;
      for (let i = 0; i < generated.data.length; i++)
        max = Math.max(max, Math.abs(generated.data[i] - distributed.data[i]));
      return { width: distributed.width, height: distributed.height, max };
    }, sample.thumbnail);
    assert.deepEqual(thumbnail, { width: 96, height: 64, max: 0 });
    Object.assign(report.scenes.at(-1), { performance, thumbnail });
    console.log(
      `${sample.id}: WebP exact; CPU <=1 byte; thumbnail exact; RAF ${performance.rafMedianMs}ms`,
    );
  }
  assert.deepEqual(report.errors, []);
} finally {
  await browser?.close();
  await server.close();
  await writeFile(path.join(out, 'render.json'), `${JSON.stringify(report, null, 2)}\n`);
}
