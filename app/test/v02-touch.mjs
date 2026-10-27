import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { chromium } from '../../tools/visual-qa/node_modules/playwright-core/index.mjs';

const root = fileURLToPath(new URL('..', import.meta.url)),
  server = await preview({ root, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome' });
  const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    }),
    page = await context.newPage();
  await page.goto(server.resolvedUrls.local[0]);
  const ready = () =>
    page.waitForFunction(
      () => document.querySelector('input[aria-label="長さ"]')?.disabled === false,
      null,
      { timeout: 60000 },
    );
  await ready();
  await page.getByRole('button', { name: '運河の街', exact: true }).click();
  await ready();
  await page
    .getByLabel('人物の画像ファイル', { exact: true })
    .setInputFiles(path.join(root, '../assets/showcase/layer/girl.png'));
  await ready();
  const position = page.getByRole('button', {
    name: '人物の位置。矢印キーで動かします',
    exact: true,
  });
  await position.scrollIntoViewIfNeeded();
  const before = await position.evaluate((n) => ({
      left: parseFloat(n.style.left),
      top: parseFloat(n.style.top),
    })),
    box = await position.boundingBox(),
    client = await context.newCDPSession(page);
  const x = box.x + box.width * 0.5,
    y = box.y + box.height * 0.4;
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y, id: 1 }],
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: x + 30, y: y - 20, id: 1 }],
  });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const after = await position.evaluate((n) => ({
    left: parseFloat(n.style.left),
    top: parseFloat(n.style.top),
  }));
  assert.ok(after.left > before.left && after.top < before.top);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({
    path: path.join(root, 'test/results/V02S-touch-mobile.png'),
    fullPage: true,
  });
  await writeFile(
    path.join(root, 'test/results/v02/touch.json'),
    `${JSON.stringify({ before, after, pass: true }, null, 2)}\n`,
  );
  console.log('Chrome: real touch drag moves the person on a 390px screen.');
} finally {
  await browser?.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
