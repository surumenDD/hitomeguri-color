import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { chromium } from '../../tools/visual-qa/node_modules/playwright-core/index.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const report = { pageCPUThrottle: 4, workerExtraBusyMs: 2000, cases: [] };
let server, browser;
try {
  server = await preview({ root, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  // Add CPU work inside the actual module Worker, never on the page or in product code.
  await page.route('**/assets/worker-*.js', async (route) => {
    const response = await route.fetch();
    const code = await response.text();
    if (!code.includes('conversion:')) return route.fulfill({ response });
    await route.fulfill({
      response,
      body: `${code}\nconst originalReceive=self.onmessage;self.onmessage=e=>{const end=performance.now()+2000;while(performance.now()<end){};originalReceive(e)};`,
    });
  });
  await page.addInitScript(() => {
    window.loadingMeasurements = [];
    let current;
    const start = (kind) => {
      if (current) current.done = true;
      current = { kind, start: performance.now(), paintMs: null, frameGaps: [] };
      current.trigger =
        document.activeElement.getAttribute('aria-label') ?? document.activeElement.textContent;
      window.loadingMeasurements.push(current);
      const row = current;
      let previous = performance.now();
      function tick(now) {
        if (row.done) return;
        row.frameGaps.push(now - previous);
        if (row.paintMs === null && document.querySelector('.picture-skeleton'))
          row.paintMs = performance.now() - row.start;
        previous = now;
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    };
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Enter' && event.target.closest('.thumb')) start('sample');
      },
      true,
    );
    document.addEventListener(
      'change',
      (event) => {
        if (event.target.matches('input[type=file]') && event.target.files.length) start('file');
      },
      true,
    );
    new MutationObserver(() => {
      if (current && current.paintMs === null && document.querySelector('.picture-skeleton')) {
        const row = current;
        requestAnimationFrame(() => {
          row.paintMs = performance.now() - row.start;
        });
      }
    }).observe(document, { childList: true, subtree: true });
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto(server.resolvedUrls.local[0]);
  const ready = () =>
    page.waitForFunction(
      () => document.querySelector('input[aria-label="長さ"]')?.disabled === false,
      null,
      { timeout: 30000 },
    );
  await ready();
  const file = Buffer.from(
    await page.locator('canvas').evaluate((source) => {
      const c = document.createElement('canvas');
      c.width = 1732;
      c.height = 1155;
      c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
      return c.toDataURL().split(',')[1];
    }),
    'base64',
  );
  const finish = async (kind) => {
    await page.waitForFunction(() => window.loadingMeasurements.at(-1)?.paintMs !== null);
    const focus = await page.evaluate(() => {
      const target = document.activeElement;
      return {
        tag: target.tagName,
        name: target.getAttribute('aria-label') ?? target.textContent,
        trigger: window.loadingMeasurements.at(-1).trigger,
      };
    });
    assert.equal(focus.tag, 'BUTTON');
    assert.equal(focus.name, focus.trigger);
    assert.equal(await page.locator('.presets button:disabled').count(), 3);
    assert.equal(await page.locator('.slider input:disabled').count(), 3);
    assert.ok(await page.getByRole('button', { name: '自分の絵を開く', exact: true }).isEnabled());
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '自分の絵を開く', exact: true }).focus();
    await page.keyboard.press('Enter');
    await (await chooser).setFiles([]);
    const focusStart = await page.evaluate(() => performance.now());
    await page.keyboard.press('Tab');
    const focusMs = await page.evaluate((start) => performance.now() - start, focusStart);
    assert.ok(await page.locator(':focus').count());
    await ready();
    const row = await page.evaluate(() => {
      const r = window.loadingMeasurements.at(-1);
      r.done = true;
      return {
        kind: r.kind,
        paintMs: r.paintMs,
        totalMs: performance.now() - r.start,
        maxRAFGapMs: Math.max(...r.frameGaps),
      };
    });
    assert.equal(row.kind, kind);
    assert.ok(row.paintMs <= 100);
    report.cases.push({
      ...row,
      focusRetained: true,
      presetsAndSlidersDisabled: true,
      openDuringLoad: true,
      keyboardTabResponseMs: focusMs,
    });
    console.log(report.cases.at(-1));
  };
  for (const sample of ['雪の村', '灯台の岬', '運河の街']) {
    await page.getByRole('button', { name: sample, exact: true }).focus();
    await page.keyboard.press('Enter');
    await finish('sample');
  }
  for (let i = 0; i < 3; i++) {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '自分の絵を開く', exact: true }).focus();
    await page.keyboard.press('Enter');
    await (await chooser).setFiles({
      name: 'loading-2mp.png',
      mimeType: 'image/png',
      buffer: file,
    });
    await finish('file');
  }
  await page.getByRole('button', { name: '雪の村', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !!document.querySelector('.picture-skeleton'));
  await page.keyboard.press('Tab');
  assert.equal(await page.locator(':focus').getAttribute('aria-label'), '灯台の岬');
  await page.keyboard.press('Enter');
  await finish('sample');
  assert.equal(
    await page.getByRole('button', { name: '灯台の岬', exact: true }).getAttribute('aria-pressed'),
    'true',
  );
  report.keyboardSampleChangeWhileLoading = true;
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.httpServer.close(resolve));
  await writeFile(`${root}/reports/M4-loading.json`, `${JSON.stringify(report, null, 2)}\n`);
}
