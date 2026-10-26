import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { chromium } from '../../tools/visual-qa/node_modules/playwright-core/index.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = path.join(root, 'test/results');
await mkdir(out, { recursive: true });
const report = { errors: [], externalRequests: [] };
let server, browser;
try {
  server = await preview({
    root,
    base: '/nested/',
    preview: { host: '127.0.0.1', port: 0 },
    logLevel: 'error',
  });
  const url = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  page.on('pageerror', (error) => report.errors.push(error.message));
  await page.route('**/*', (route) => {
    const requestUrl = new URL(route.request().url());
    if (
      requestUrl.origin === new URL(url).origin ||
      ['blob:', 'data:'].includes(requestUrl.protocol)
    )
      return route.continue();
    report.externalRequests.push(requestUrl.href);
    return route.abort();
  });
  await page.goto(url);
  await page.waitForFunction(
    () => document.querySelector('[role="status"]')?.textContent.includes('準備できました'),
    null,
    { timeout: 30000 },
  );
  assert.equal(await page.getByRole('button', { name: '再生', exact: true }).isDisabled(), true);
  assert.ok((await page.locator('output').textContent()).startsWith('0.00'));
  await page.getByLabel('時刻', { exact: true }).fill('7.2');
  assert.ok((await page.locator('output').textContent()).startsWith('7.20'));
  report.canvasSize = await page
    .locator('canvas')
    .evaluate((canvas) => [canvas.width, canvas.height]);
  assert.deepEqual(report.canvasSize, [1536, 1024]);
  await page.screenshot({ path: path.join(out, 'production.png'), fullPage: true });
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.externalRequests, []);
  report.relativeAssetsAndWorker = true;
  report.initialReducedMotion = true;
  report.passed = true;
  console.log('Production: nested path assets + bundled Worker + initial reduced motion passed.');
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.httpServer.close(resolve));
  await writeFile(path.join(out, 'production.json'), `${JSON.stringify(report, null, 2)}\n`);
}
