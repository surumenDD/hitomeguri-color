import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from '../../tools/visual-qa/node_modules/playwright-core/index.mjs';

const root = fileURLToPath(new URL('..', import.meta.url)),
  out = new URL('./results/v42-preflight.json', import.meta.url);
await mkdir(new URL('./results/', import.meta.url), { recursive: true });
const report = { defaults: [], conditions: [], parity: [] };
let server, browser;
try {
  server = await createServer({
    root,
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    logLevel: 'error',
  });
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  await page.goto(`${server.resolvedUrls.local[0]}test/engine.html`);
  await page.waitForFunction(() => window.engine);
  for (const image of ['canal', 'snow', 'lighthouse', 'oasis', 'flat']) {
    await page.evaluate((id) => window.engine.load(id), image);
    report.parity.push({ image, error: await page.evaluate(() => window.engine.parity()) });
    for (const preset of ['day', 'longDusk', 'nightLights']) {
      report.defaults.push({
        image,
        preset,
        estimate: await page.evaluate((p) => window.engine.estimate(p), preset),
      });
      for (const durationSec of [12, 48])
        for (const nightDepth of [0.2, 4])
          for (const glow of [0, 2]) {
            const request = { durationSec, nightDepth, glow },
              estimate = await page.evaluate(
                ({ preset, request }) => window.engine.estimate(preset, request),
                { preset, request },
              );
            report.conditions.push({ image, preset, ...request, estimate });
            await writeFile(out, JSON.stringify(report, null, 2));
            console.log(
              `${report.conditions.length}/120 ${image}/${preset}/${durationSec}/${nightDepth}/${glow}: ${estimate.pass} count=${estimate.maxClampedPixels} excursion=${estimate.maxExcursion}`,
            );
          }
    }
  }
} finally {
  await browser?.close();
  await server?.close();
  await writeFile(out, JSON.stringify(report, null, 2));
}
