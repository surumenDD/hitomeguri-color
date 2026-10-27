import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { chromium } from '../../tools/visual-qa/node_modules/playwright-core/index.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await preview({ root, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  await page.goto(server.resolvedUrls.local[0]);
  const ready = () =>
    page.waitForFunction(
      () => document.querySelector('input[aria-label="長さ"]')?.disabled === false,
      null,
      { timeout: 60000 },
    );
  const button = (label) => page.getByRole('button', { name: label, exact: true });
  const timeline = page.getByRole('slider', { name: '1周の中の時刻', exact: true });
  const capture = async (name) => {
    await page.locator('.name').click();
    await page.screenshot({
      path: path.join(root, `test/results/V02S-${name}.png`),
      fullPage: true,
    });
  };
  const seek = async (seconds) => {
    await timeline.press('Home');
    for (let i = 0; i < seconds; i++) await timeline.press('Shift+ArrowRight');
  };
  await ready();
  await page.evaluate(() => document.fonts.ready);
  for (const id of ['seaside', 'riverbank']) {
    await page
      .getByLabel('画像ファイル', { exact: true })
      .setInputFiles(path.join(root, `../assets/showcase/layer/${id}.png`));
    await ready();
    await seek(0);
    await capture(`${id}-without`);
    await page
      .getByLabel('人物の画像ファイル', { exact: true })
      .setInputFiles(path.join(root, '../assets/showcase/layer/girl.png'));
    await ready();
    assert.equal(await page.locator('.foreground-summary span').textContent(), 'girl');
    if (id === 'riverbank') {
      const position = button('人物の位置。矢印キーで動かします');
      for (let i = 0; i < 4; i++) await position.press('Shift+ArrowLeft');
      for (let i = 0; i < 3; i++) await position.press('ArrowLeft');
    }
    for (const [name, seconds] of [
      ['evening', 0],
      ['midnight', 12],
      ['day', 20],
    ]) {
      await seek(seconds);
      await capture(`${id}-${name}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await seek(12);
    await capture(`${id}-mobile`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.setViewportSize({ width: 1440, height: 1080 });
    await button('外す').click();
  }
  console.log(
    'Captured both real backgrounds, empty and present, evening/midnight/day and mobile.',
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
