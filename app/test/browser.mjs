import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from '../../tools/visual-qa/node_modules/playwright-core/index.mjs';

const root = fileURLToPath(new URL('..', import.meta.url)),
  out = path.join(root, 'test/results');
await mkdir(out, { recursive: true });
const report = { when: new Date().toISOString(), samples: [], errors: [], externalRequests: [] };
let server, browser;
try {
  server = await createServer({
    root,
    base: '/',
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    logLevel: 'error',
  });
  await server.listen();
  const origin = server.resolvedUrls.local[0].replace(/\/$/, '');
  browser = await chromium.launch({ channel: 'chrome' });
  report.browser = browser.version();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
    serviceWorkers: 'block',
    acceptDownloads: true,
  });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
    report.externalRequests.push(url.href);
    return route.abort();
  });
  context.on('page', (page) => page.on('pageerror', (e) => report.errors.push(e.message)));
  const harness = await context.newPage();
  await harness.goto(`${origin}/test/harness.html`);
  await harness.waitForFunction(() => window.harness);
  report.gpu = await harness.evaluate(() => window.harness.gpu);
  for (const id of [
    'canal',
    'snow',
    'lighthouse',
    'oasis',
    'flat',
    'painterly',
    'pixel',
    'photo',
  ]) {
    const result = await harness.evaluate((id) => window.harness.sampleTest(id), id);
    report.samples.push(result);
    assert.equal(result.identity.psnrDb, 'Infinity', id);
    if (result.lossless) assert.equal(result.lossless.psnrDb, 'Infinity', `${id}/lossless WebP`);
    for (const end of result.endpoints)
      assert.equal(end.psnrDb, 'Infinity', `${id}/${end.preset}/${end.seconds}`);
    console.log(`${id}: shader identity + 3 preset endpoints PSNR Infinity`);
  }
  report.alpha = await harness.evaluate(() => window.harness.alphaTest());
  report.lightnessFallback = await harness.evaluate(() => window.harness.fallbackTest());
  assert.equal(report.alpha.rgb.psnrDb, 'Infinity');
  assert.ok(report.alpha.alphaExact);
  assert.deepEqual(report.lightnessFallback, [
    { diagnostic: 255, rgba: [0, 0, 0, 255] },
    { diagnostic: 255, rgba: [255, 255, 255, 255] },
  ]);
  await harness.close();
  const ui = await context.newPage();
  await ui.goto(origin);
  const ready = () =>
    ui.waitForFunction(
      () => {
        const text = document.querySelector('.sr-only[role="status"]')?.textContent;
        return (
          text?.includes('準備できました') &&
          !text.includes('確かめ') &&
          !document.querySelector('.picture-skeleton')
        );
      },
      null,
      { timeout: 120000 },
    );
  const clock = ui.locator('.when span'),
    timeline = ui.getByRole('slider', { name: '1周の中の時刻', exact: true }),
    canvasData = () => ui.locator('canvas').evaluate((c) => c.toDataURL());
  await ready();
  assert.equal(await ui.title(), 'ひとめぐり');
  assert.equal(await ui.locator('.thumb').count(), 7);
  const first = await canvasData();
  await ui.waitForTimeout(300);
  assert.equal(await clock.textContent(), '0.0 / 24 秒');
  assert.equal(await canvasData(), first);
  report.noAutoplay = true;
  await ui.getByRole('button', { name: '再生', exact: true }).click();
  await ui.waitForFunction(
    () => parseFloat(document.querySelector('.when span').textContent) > 0.15,
  );
  await ui.getByRole('button', { name: '一時停止', exact: true }).click();
  const stopped = await clock.textContent();
  await ui.waitForTimeout(250);
  assert.equal(await clock.textContent(), stopped);
  report.playPause = true;
  await timeline.press('Home');
  await timeline.press('Shift+ArrowRight');
  assert.ok((await clock.textContent()).startsWith('1.0'));
  assert.ok(await timeline.getAttribute('aria-valuetext'));
  await timeline.press('End');
  assert.ok((await clock.textContent()).startsWith('24.0'));
  await timeline.press('Home');
  const box = await timeline.boundingBox();
  await ui.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  assert.ok(Math.abs(parseFloat(await clock.textContent()) - 12) < 0.2);
  report.timelineKeyboardPointer = true;
  await ui.getByRole('button', { name: '長い夕暮れ', exact: true }).click();
  await ready();
  assert.equal(
    await ui.getByRole('button', { name: '長い夕暮れ', exact: true }).getAttribute('aria-pressed'),
    'true',
  );
  await ui.getByRole('button', { name: '1日の光', exact: true }).click();
  await ready();
  for (const label of ['長さ', '夜の深さ', '灯りの強さ']) {
    const control = ui.getByRole('slider', { name: label, exact: true });
    assert.equal(Number(await control.inputValue()), 50);
    await control.fill('0');
    await control.dispatchEvent('change');
    await ready();
    await control.fill('50');
    await control.dispatchEvent('change');
    await ready();
    assert.ok(await control.getAttribute('aria-valuetext'));
  }
  report.presetSliderPositions = [];
  for (const [name, seconds] of [
    ['長い夕暮れ', 20],
    ['夜の灯り', 32],
    ['1日の光', 24],
  ]) {
    await ui.getByRole('button', { name, exact: true }).click();
    await ready();
    const positions = [];
    for (const label of ['長さ', '夜の深さ', '灯りの強さ']) {
      const control = ui.getByRole('slider', { name: label, exact: true });
      positions.push(Number(await control.inputValue()));
      assert.equal(
        Number(await control.inputValue()),
        50,
        `${name}/${label} must reset to its preset default`,
      );
      assert.equal(
        await control.getAttribute('aria-valuetext'),
        label === '長さ' ? `${seconds} 秒` : 'ふつう',
      );
      await control.fill('75');
      await control.dispatchEvent('change');
      await ready();
    }
    report.presetSliderPositions.push({ name, positions });
  }
  // Re-select the same preset too: edited coefficients must return to their defaults.
  await ui.getByRole('button', { name: '1日の光', exact: true }).click();
  await ready();
  for (const label of ['長さ', '夜の深さ', '灯りの強さ'])
    assert.equal(
      Number(await ui.getByRole('slider', { name: label, exact: true }).inputValue()),
      50,
    );
  report.presetsAndScales = true;
  console.log('Presets: day/longDusk/nightLights reset all three sliders to [50, 50, 50].');
  await ui.getByRole('button', { name: '港町', exact: true }).click();
  await ready();
  const originalCount = await ui.locator('.swatch').count();
  await ui.locator('.swatch').first().click();
  assert.equal(await ui.locator('.swatch').first().getAttribute('aria-pressed'), 'true');
  const role = ui.getByRole('combobox', { name: '役割', exact: true }),
    initial = await role.inputValue();
  await role.selectOption(initial === 'sky' ? 'water' : 'sky');
  await ready();
  assert.notEqual(await role.inputValue(), initial);
  await ui.getByRole('button', { name: '自動に戻す', exact: true }).click();
  await ready();
  assert.equal(await role.inputValue(), initial);
  report.roleEditReset = true;
  await ui.getByRole('button', { name: '上下の線で分ける', exact: true }).click();
  const line = ui.getByRole('slider', { name: '島を分ける線' });
  const at = Number(await line.getAttribute('aria-valuenow'));
  await line.press('ArrowDown');
  assert.equal(Number(await line.getAttribute('aria-valuenow')), at + 1);
  await line.press('Shift+ArrowUp');
  assert.equal(Number(await line.getAttribute('aria-valuenow')), at - 9);
  await ui.getByRole('combobox', { name: '下の役割' }).selectOption('water');
  await ui.getByRole('button', { name: '分ける', exact: true }).click();
  await ready();
  assert.equal(await ui.locator('.swatch').count(), originalCount + 1);
  await ui
    .getByRole('button', { name: /（上）、面積/ })
    .first()
    .click();
  await ui.getByRole('button', { name: '分割を戻す' }).click();
  await ready();
  assert.equal(await ui.locator('.swatch').count(), originalCount);
  report.splitUndo = true;
  const pngWait = ui.waitForEvent('download');
  await ui.getByRole('button', { name: 'この瞬間を画像で保存' }).click();
  const png = await pngWait;
  assert.ok(png.suggestedFilename().startsWith('ひとめぐり'));
  await png.saveAs(path.join(out, 'saved.png'));
  assert.equal((await readFile(path.join(out, 'saved.png'))).subarray(1, 4).toString(), 'PNG');
  report.pngDownload = true;
  await ui.getByRole('button', { name: '動画を書き出す', exact: true }).click();
  await ui.getByRole('button', { name: '中止', exact: true }).waitFor();
  assert.equal(await ui.locator(':focus').textContent(), '中止');
  assert.ok(await ui.getByRole('progressbar').count());
  assert.ok(await ui.getByRole('button', { name: '自分の絵を開く' }).isDisabled());
  await ui.getByRole('button', { name: '中止', exact: true }).click();
  await ui.getByRole('button', { name: '動画を書き出す', exact: true }).waitFor();
  report.exportProgressCancellation = true;
  const file = path.join(root, '../assets/samples/raw/flat-dusk-harbor.png');
  await ui.getByLabel('画像ファイル', { exact: true }).setInputFiles(file);
  await ready();
  assert.equal(
    await ui.locator('canvas').getAttribute('aria-label'),
    `${path.basename(file, path.extname(file))}の色の台本`,
  );
  const bytes = (await readFile(file)).toString('base64');
  await ui.evaluate((bytes) => {
    const data = Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0)),
      transfer = new DataTransfer();
    transfer.items.add(new File([data], 'drop.png', { type: 'image/png' }));
    window.dispatchEvent(
      new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }),
    );
  }, bytes);
  await ready();
  assert.equal(await ui.locator('canvas').getAttribute('aria-label'), 'dropの色の台本');
  report.sampleFileDrop = true;
  // Observe the real store and Worker client without adding a test API to the product.
  await ui.evaluate(async () => {
    const { AppStore } = await import('/src/state.ts');
    const load = AppStore.prototype.load;
    AppStore.prototype.load = function (...args) {
      window.largeImageStore = this;
      return load.apply(this, args);
    };
    const { SafetyClient } = await import('/src/safety/client.ts');
    const evaluate = SafetyClient.prototype.evaluate;
    window.largeImageChecks = [];
    SafetyClient.prototype.evaluate = function (roles, preset) {
      const job = { preset: { ...preset }, started: performance.now() };
      window.largeImageChecks.push(job);
      return evaluate.call(this, roles, preset).then((result) => {
        Object.assign(job, { finished: performance.now(), result });
        return result;
      });
    };
  });
  const generatedJpeg = await ui.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 3000;
    const ctx = canvas.getContext('2d');
    const sky = ctx.createLinearGradient(0, 0, 0, 3000);
    sky.addColorStop(0, '#538fac');
    sky.addColorStop(0.5, '#c7976d');
    sky.addColorStop(0.51, '#34556c');
    sky.addColorStop(1, '#1d344c');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 3000, 3000);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    for (let y = 40; y < 2960; y += 50) {
      ctx.beginPath();
      ctx.moveTo(60, y);
      ctx.lineTo(2940, y + 30);
      ctx.stroke();
    }
    return canvas.toDataURL('image/jpeg', 0.94).split(',')[1];
  });
  const loadStarted = performance.now();
  await ui.getByLabel('画像ファイル', { exact: true }).setInputFiles({
    name: 'generated-white-lines-3000.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from(generatedJpeg, 'base64'),
  });
  await ready();
  const openMs = performance.now() - loadStarted;
  const large = await ui.evaluate(() => {
    const state = window.largeImageStore.getState();
    return {
      width: state.image.data.metadata.width,
      height: state.image.data.metadata.height,
      originalSize: state.image.originalSize,
      error: state.error,
      estimate: state.estimate,
    };
  });
  assert.deepEqual([large.width, large.height], [2048, 2048]);
  assert.deepEqual(large.originalSize, { width: 3000, height: 3000 });
  assert.equal(large.error, undefined);
  assert.equal(
    await ui
      .getByText('長辺 2048 px に縮めて開きました（元の大きさは 3000×3000）。', { exact: true })
      .count(),
    1,
  );
  await ui.evaluate(() => {
    window.largeImageChecks = [];
  });
  const night = ui.getByRole('slider', { name: '夜の深さ', exact: true });
  const inputs = [];
  let lastInputAt;
  for (const position of [51, 52, 53, 54, 55, 56]) {
    await night.fill(String(position));
    lastInputAt = performance.now();
    const immediate = await night.evaluate((control) => {
      const state = window.largeImageStore.getState();
      return {
        position: Number(control.value),
        disabled: control.disabled,
        checking: state.checking,
        draft: state.drafts.nightDepth,
        accepted: state.preset.nightDepth,
        output: control.closest('label').querySelector('output').textContent,
        valueText: control.getAttribute('aria-valuetext'),
      };
    });
    assert.equal(immediate.disabled, false);
    assert.equal(immediate.position, position);
    assert.equal(immediate.checking, true);
    assert.ok(Number.isFinite(immediate.draft));
    assert.equal(immediate.output, immediate.valueText);
    inputs.push(immediate);
  }
  await ready();
  const settleMs = performance.now() - lastInputAt;
  const settled = await ui.evaluate(async () => {
    const { nightPosition } = await import('/src/ui/scales.ts');
    const { PRESETS } = await import('/src/script/index.ts');
    const state = window.largeImageStore.getState();
    return {
      drafts: state.drafts,
      checking: state.checking,
      accepted: state.preset.nightDepth,
      position: nightPosition(state.preset.nightDepth, PRESETS[state.preset.id].nightDepth),
      limit: state.limits.nightDepth,
      error: state.editError,
      pass: state.estimate.pass,
      checks: window.largeImageChecks,
    };
  });
  assert.deepEqual(settled.drafts, {});
  assert.equal(settled.checking, false);
  assert.equal(settled.pass, true);
  assert.ok(Math.abs(Number(await night.inputValue()) - settled.position) <= 1);
  if (settled.error) assert.equal(settled.accepted, settled.limit[1]);
  else assert.equal(Number(await night.inputValue()), 56);
  // All six inputs landed before the first result: only the first and last were checked.
  assert.equal(settled.checks.length, settled.error ? 9 : 2);
  report.largeImage = { openMs, settleMs, ...large, inputs, settled };
  console.log(
    `Large image: 3000×3000 → 2048×2048, open ${openMs.toFixed(0)}ms, final input → accepted ${settleMs.toFixed(0)}ms.`,
  );
  await ui.getByRole('button', { name: '港町', exact: true }).click();
  await ready();
  assert.equal(await ui.getByText(/長辺 2048 px に縮めて開きました/).count(), 0);
  const beforeBad = await canvasData();
  await ui
    .getByLabel('画像ファイル', { exact: true })
    .setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('invalid') });
  await ui.getByRole('alert').first().waitFor();
  assert.equal(await canvasData(), beforeBad);
  report.loadErrorPreservesImage = true;
  await ui.setViewportSize({ width: 390, height: 844 });
  assert.equal(await ui.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  report.mobileNoOverflow = true;
  await ui.emulateMedia({ reducedMotion: 'reduce' });
  await ui.waitForFunction(() => document.querySelector('.play')?.disabled);
  await timeline.press('Home');
  await timeline.press('Shift+ArrowRight');
  const still = await canvasData(),
    time = await clock.textContent();
  await ui.waitForTimeout(5000);
  assert.equal(await canvasData(), still);
  assert.equal(await clock.textContent(), time);
  assert.ok(time.startsWith('1.0'));
  report.reducedMotionManualOnly = true;
  await ui.emulateMedia({ reducedMotion: 'no-preference' });
  await ui.getByRole('button', { name: '再生', exact: true }).click();
  await ui.waitForTimeout(200);
  await ui.emulateMedia({ reducedMotion: 'reduce' });
  await ui.waitForFunction(() => document.querySelector('.play')?.disabled);
  const interrupted = await clock.textContent();
  await ui.waitForTimeout(200);
  assert.equal(await clock.textContent(), interrupted);
  report.reducedMotionStopsPlayback = true;
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.externalRequests, []);
  report.passed = true;
  console.log(
    'Chrome: reconstruction, playback, strip, presets, scales, islands, split/undo, local loading, PNG, export cancellation, reduced motion passed.',
  );
} finally {
  await browser?.close();
  await server?.close();
  await writeFile(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
}
