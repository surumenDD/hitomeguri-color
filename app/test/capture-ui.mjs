import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from '../../tools/visual-qa/node_modules/playwright-core/index.mjs';

const root = fileURLToPath(new URL('..', import.meta.url)),
  out = path.join(root, 'reports');
await mkdir(out, { recursive: true });
let server, browser;
try {
  server = await createServer({
    root,
    base: '/',
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    logLevel: 'error',
  });
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on('pageerror', (e) => {
    errors.push(e.message);
    console.log('PAGEERROR', e.message);
  });
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('CONSOLE', m.text());
  });
  await page.goto(server.resolvedUrls.local[0]);
  await page.waitForTimeout(3000);
  console.log((await page.locator('body').textContent()).slice(0, 1500));
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('[role="status"]')].some((x) =>
        x.textContent.includes('準備できました'),
      ),
    null,
    { timeout: 10000 },
  );
  await page.evaluate(() => document.fonts.ready);
  const timeline = page.getByRole('slider', { name: '1周の中の時刻' });
  await timeline.focus();
  for (let i = 0; i < 30; i++) await timeline.press('ArrowRight');
  await page.locator('h1').click();
  await page.screenshot({ path: path.join(out, 'M2-ui-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(out, 'M2-ui-mobile.png') });
  await page.screenshot({ path: path.join(out, 'M2-ui-mobile-full.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.evaluate(() => scrollTo(0, 0));
  await page.locator('.swatch').first().click();
  await page.screenshot({ path: path.join(out, 'M2-ui-island.png') });
  await page.getByRole('button', { name: '上下の線で分ける', exact: true }).click();
  await page.getByRole('combobox', { name: '下の役割' }).focus();
  await page.screenshot({ path: path.join(out, 'M2-ui-split.png') });
  await page.getByRole('button', { name: 'やめる', exact: true }).click();
  await page.getByRole('button', { name: '動画を書き出す', exact: true }).click();
  await page.getByRole('progressbar').waitFor();
  await page.screenshot({ path: path.join(out, 'M2-ui-export-progress.png') });
  await page.getByRole('button', { name: '中止', exact: true }).click();
  await page.getByRole('button', { name: '動画を書き出す', exact: true }).waitFor();
  await page
    .getByLabel('画像ファイル')
    .setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('invalid') });
  await page.getByRole('alert').first().waitFor();
  await page.screenshot({ path: path.join(out, 'M2-ui-error.png') });
  await writeFile(path.join(root, 'test/results/ui-console.json'), JSON.stringify(errors, null, 2));
  console.log(errors);
} finally {
  await browser?.close();
  await server?.close();
}
