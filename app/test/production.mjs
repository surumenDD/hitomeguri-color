import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { chromium } from '../../tools/visual-qa/node_modules/playwright-core/index.mjs';
import {
  assertSelection,
  exportedColours,
  luminance,
  measureSelection,
  selectionFixture,
  selectionPixels,
  splitPreview,
} from './selection.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = path.join(root, 'test/results');
await mkdir(out, { recursive: true });
const report = { errors: [], consoleErrors: [], cspViolations: [], externalRequests: [] };
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
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
  });
  page.on('console', (message) => {
    if (message.type() === 'error') report.consoleErrors.push(message.text().slice(0, 300));
  });
  await page.addInitScript(() => {
    window.cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      window.cspViolations.push({
        directive: e.effectiveDirective,
        blockedURI: e.blockedURI.slice(0, 100),
      }),
    );
  });
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
  const navigation = await page.goto(url);
  assert.doesNotMatch(navigation.headers()['content-security-policy'] ?? '', /ws:|wss:/);
  await page.waitForFunction(
    () => document.querySelector('[role="status"]')?.textContent.includes('準備できました'),
    null,
    { timeout: 30000 },
  );
  const canalBefore = await selectionPixels(page);
  const canalSwatch = page.getByRole('button', { name: /^空、/ }).first();
  report.canalIndex = await canalSwatch.getAttribute('data-testid');
  await canalSwatch.click();
  const canalAfter = await selectionPixels(page);
  report.canalSelection = {
    before: canalBefore,
    after: canalAfter,
    ratios: canalAfter.map((rgb, k) => luminance(rgb) / luminance(canalBefore[k])),
  };
  await page.screenshot({ path: path.join(out, 'production-island.png') });
  await canalSwatch.click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.querySelector('.play')?.disabled);
  assert.ok((await page.locator('.when span').textContent()).startsWith('0.0'));
  await page.getByRole('slider', { name: '1周の中の時刻', exact: true }).press('Shift+ArrowRight');
  assert.ok((await page.locator('.when span').textContent()).startsWith('1.0'));
  report.canvasSize = await page
    .locator('canvas')
    .evaluate((canvas) => [canvas.width, canvas.height]);
  assert.deepEqual(report.canvasSize, [1536, 1024]);
  await page.screenshot({ path: path.join(out, 'production.png'), fullPage: true });
  report.fonts = await page.evaluate(async () => {
    try {
      await document.fonts.load(
        '16px "Zen Kaku Gothic New"',
        'ひとめぐり台本色の島動画を書き出す残照',
      );
    } catch {
      /* Captured by the assertions below. */
    }
    await document.fonts.ready;
    return document.fonts.check(
      '16px "Zen Kaku Gothic New"',
      'ひとめぐり台本色の島動画を書き出す残照',
    );
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const timeline = page.getByRole('slider', { name: '1周の中の時刻', exact: true });
  await timeline.press('Home');
  for (let i = 0; i < 3; i++) await timeline.press('Shift+ArrowRight');
  await canalSwatch.click();
  await page.screenshot({ path: path.join(root, 'reports/M2-ui-island.png') });
  await page.getByRole('button', { name: '上下の線で分ける', exact: true }).click();
  await page.getByRole('combobox', { name: '下の役割' }).focus();
  await page.screenshot({ path: path.join(root, 'reports/M2-ui-split.png') });
  await page.getByRole('button', { name: 'やめる', exact: true }).click();
  await canalSwatch.click();
  report.cspViolations = await page.evaluate(() => window.cspViolations);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await selectionFixture(page);
  report.selection = await measureSelection(page);
  assertSelection(report.selection);
  report.playingSelection = await measureSelection(page, true);
  assertSelection(report.playingSelection);
  await page.getByRole('slider', { name: '1周の中の時刻', exact: true }).press('Home');
  report.splitPreview = await splitPreview(page);
  report.exports = await exportedColours(page, out);
  const priorCsp = await page.evaluate(() => window.cspViolations);
  const parameterUrl = new URL(url);
  parameterUrl.search = '?dimL=0.8&dimC=0.7';
  await page.goto(parameterUrl.href);
  await page.waitForFunction(() =>
    document.querySelector('.sr-only[role="status"]')?.textContent.includes('準備できました'),
  );
  await selectionFixture(page);
  report.parameterSelection = await measureSelection(page);
  assertSelection(report.parameterSelection, { L: 0.8, C: 0.7 });
  report.cspViolations = [...priorCsp, ...(await page.evaluate(() => window.cspViolations))];
  report.cssBytes = 0;
  for (const name of await readdir(path.join(root, 'dist/assets'))) {
    if (!name.endsWith('.css')) continue;
    const bytes = await readFile(path.join(root, 'dist/assets', name));
    report.cssBytes += bytes.length;
    assert.doesNotMatch(
      bytes.toString(),
      /data:font\//,
      'Fonts must be same-origin files, not data URLs',
    );
  }
  const policy = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  assert.doesNotMatch(policy, /ws:|wss:/, 'Production must not allow development WebSockets');
  assert.match(policy, /default-src 'self'/);
  assert.doesNotMatch(policy, /font-src[^;]*data:/);
  assert.equal(report.consoleErrors.length, 0, report.consoleErrors[0]);
  assert.deepEqual(report.cspViolations, []);
  assert.equal(report.fonts, true);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.externalRequests, []);
  const notices = await page.evaluate(async () => {
    const response = await fetch(new URL('THIRD-PARTY-LICENSES.txt', document.baseURI));
    if (!response.ok) throw new Error('Bundled notices are missing');
    return response.text();
  });
  assert.match(notices, /SIL OPEN FONT LICENSE/i);
  assert.match(notices, /MIT License/);
  report.bundledLicenses = true;
  report.relativeAssetsAndWorker = true;
  report.initialReducedMotion = true;
  report.passed = true;
  console.log(
    `Production: console errors ${report.consoleErrors.length}, CSP violations ${report.cspViolations.length}, fonts ${report.fonts}, CSS ${report.cssBytes} bytes; paused/playing selection, split, PNG/MP4, nested path, reduced motion passed.`,
  );
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.httpServer.close(resolve));
  await writeFile(path.join(out, 'production.json'), `${JSON.stringify(report, null, 2)}\n`);
}
