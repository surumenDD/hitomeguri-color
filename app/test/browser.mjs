import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from '../../tools/visual-qa/node_modules/playwright-core/index.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = path.join(root, 'test/results');
await mkdir(out, { recursive: true });
const report = { when: new Date().toISOString(), samples: [], errors: [], externalRequests: [] };
let server, browser;
try {
  server = await createServer({ root, server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  await server.listen();
  const origin = server.resolvedUrls.local[0].replace(/\/$/, '');
  browser = await chromium.launch({ channel: 'chrome' });
  report.browser = browser.version();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    serviceWorkers: 'block',
  });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
    report.externalRequests.push(url.href);
    return route.abort();
  });
  context.on('page', (page) => page.on('pageerror', (error) => report.errors.push(error.message)));
  const harness = await context.newPage();
  await harness.goto(`${origin}/test/harness.html`);
  await harness.waitForFunction(() => window.harness, null, { timeout: 30000 });
  report.gpu = await harness.evaluate(() => window.harness.gpu);
  for (const id of ['flat', 'painterly', 'pixel', 'photo']) {
    const result = await harness.evaluate(
      (id) => window.harness.sampleTest(id, ['flat', 'painterly'].includes(id)),
      id,
    );
    report.samples.push({ ...result, moments: result.moments.map(({ png, ...m }) => m) });
    if (result.moments.length) {
      const jpeg = await harness.evaluate(
        ({ id, moments }) => window.harness.contactSheet(id, moments),
        result,
      );
      await writeFile(
        path.join(out, `${id}-eight-times.jpg`),
        Buffer.from(jpeg.split(',')[1], 'base64'),
      );
    }
    for (const [index, moment] of result.moments.entries()) {
      const filename = `${id}-${index}.png`;
      await writeFile(path.join(out, filename), Buffer.from(moment.png.split(',')[1], 'base64'));
      delete moment.png;
      moment.file = filename;
      assert.equal(
        moment.sameWeights.psnrDb,
        'Infinity',
        `${id}/${moment.seconds}: identical weights must reproduce the spike`,
      );
      // Record invalid L without changing the fixed v2 values; coefficient bounds belong to M2.
    }
    for (const mode of ['identity', 'start', 'end'])
      assert.equal(
        result[mode].psnrDb,
        'Infinity',
        `${id}/${mode}: original RGB must survive the shader`,
      );
    if (result.moments.length) {
      assert.equal(result.paletteMaxError, 0, `${id}: extraction changed`);
      assert.equal(result.rolesMatch, true, `${id}: role inference changed`);
      assert.ok(result.scriptMaxError < 1e-12, `${id}: v2 script changed`);
    }
    console.log(
      `${id}: identity/start/end PSNR Infinity; v2 max error ${result.scriptMaxError ?? 'n/a'}; preprocessing ${result.timing.total.toFixed(1)} ms`,
    );
  }
  report.alpha = await harness.evaluate(() => window.harness.alphaTest());
  report.lightnessFallback = await harness.evaluate(() => window.harness.fallbackTest());
  assert.deepEqual(report.lightnessFallback, [
    { diagnostic: 255, rgba: [0, 0, 0, 255] },
    { diagnostic: 255, rgba: [255, 255, 255, 255] },
  ]);
  assert.equal(report.alpha.rgb.psnrDb, 'Infinity');
  assert.equal(report.alpha.alphaExact, true);
  report.preprocessing2MP = await harness.evaluate(() => window.harness.benchmark());
  report.render1080p = await harness.evaluate(() => window.harness.renderBenchmark());
  console.log(
    `2MP preprocessing (ms): ${report.preprocessing2MP.runs.map((run) => run.total.toFixed(1)).join(', ')}`,
  );
  const ui = await context.newPage();
  await ui.goto(origin);
  const ready = () =>
    ui.waitForFunction(
      () => document.querySelector('[role="status"]')?.textContent.includes('準備できました'),
      null,
      { timeout: 120000 },
    );
  await ready();
  const clock = ui.locator('output');
  const canvasData = () => ui.locator('canvas').evaluate((canvas) => canvas.toDataURL());
  const first = await canvasData();
  await ui.waitForTimeout(300);
  report.noAutoplay =
    (await clock.textContent()).startsWith('0.00') && first === (await canvasData());
  assert.ok(report.noAutoplay);
  await ui.getByRole('button', { name: '再生', exact: true }).click();
  await ui.waitForFunction(() => parseFloat(document.querySelector('output').textContent) > 0.15);
  await ui.getByRole('button', { name: '一時停止', exact: true }).click();
  const stopped = await clock.textContent();
  await ui.waitForTimeout(200);
  assert.equal(await clock.textContent(), stopped);
  report.playPause = true;
  await ui.getByLabel('時刻', { exact: true }).fill('11.4');
  assert.ok((await clock.textContent()).startsWith('11.40'));
  const beforeRole = await canvasData();
  const role = ui.getByLabel('色 1 の役割', { exact: true });
  const inferredRole = await role.inputValue();
  await role.selectOption(inferredRole === 'light' ? 'shadow' : 'light');
  assert.notEqual(await canvasData(), beforeRole);
  await ui.getByRole('button', { name: '自動推定に戻す' }).click();
  assert.equal(await role.inputValue(), inferredRole);
  report.sliderAndRole = true;
  await ui.getByRole('button', { name: '色 1 の場所を確認', exact: true }).click();
  assert.equal(
    await ui
      .getByRole('button', { name: '色 1 の場所を確認', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  await ui.screenshot({ path: path.join(out, 'ui-night.png'), fullPage: true });
  await ui.getByLabel('見本の画像').selectOption('painterly');
  await ready();
  assert.equal(await ui.locator('figcaption').textContent(), '湖の夕景');
  // A real file input followed by a DOM DataTransfer covers both local-only load paths.
  const file = path.join(root, '../assets/samples/raw/flat-dusk-harbor.png');
  await ui.getByLabel('画像ファイル').setInputFiles(file);
  await ready();
  assert.equal(await ui.locator('figcaption').textContent(), path.basename(file));
  const bytes = (await readFile(file)).toString('base64');
  await ui.evaluate((bytes) => {
    const data = Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([data], 'drop.png', { type: 'image/png' }));
    window.dispatchEvent(
      new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }),
    );
  }, bytes);
  await ready();
  assert.equal(await ui.locator('figcaption').textContent(), 'drop.png');
  report.sampleFileAndDrop = true;
  await ui.setViewportSize({ width: 390, height: 900 });
  assert.equal(await ui.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await ui.screenshot({ path: path.join(out, 'ui-mobile.png'), fullPage: true });
  report.mobileNoOverflow = true;
  await ui.emulateMedia({ reducedMotion: 'reduce' });
  await ui.waitForFunction(() => document.querySelector('main > button')?.disabled);
  assert.equal(await ui.getByRole('button', { name: '再生', exact: true }).isDisabled(), true);
  await ui.getByLabel('時刻', { exact: true }).fill('7.2');
  const still = await canvasData(),
    stillClock = await clock.textContent();
  await ui.waitForTimeout(5000);
  report.reducedMotion = {
    seconds: 5,
    pixelsUnchanged: still === (await canvasData()),
    clockUnchanged: stillClock === (await clock.textContent()),
    manualSeek: stillClock.startsWith('7.20'),
  };
  assert.ok(Object.values(report.reducedMotion).every(Boolean));
  await ui.emulateMedia({ reducedMotion: 'no-preference' });
  await ui.getByRole('button', { name: '再生', exact: true }).click();
  await ui.waitForTimeout(200);
  await ui.emulateMedia({ reducedMotion: 'reduce' });
  await ui.waitForFunction(() => document.querySelector('main > button')?.disabled);
  const interrupted = await clock.textContent();
  await ui.waitForTimeout(200);
  assert.equal(await clock.textContent(), interrupted);
  report.reducedMotionStopsActivePlayback = true;
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.externalRequests, []);
  report.passed = true;
  console.log(
    'Chrome: exact shader reconstruction, v2 parity, controls, file/drop and reduced motion passed.',
  );
} finally {
  await browser?.close();
  await server?.close();
  await writeFile(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
}
