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
  assert.equal(await ui.locator('.thumb').count(), 5);
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
  for (const name of ['長い夕暮れ', '夜の灯り', '1日の光']) {
    await ui.getByRole('button', { name, exact: true }).click();
    await ready();
    for (const label of ['夜の深さ', '灯りの強さ']) {
      const control = ui.getByRole('slider', { name: label, exact: true });
      assert.equal(
        Number(await control.inputValue()),
        50,
        `${name}/${label} must reset to its preset default`,
      );
      assert.equal(await control.getAttribute('aria-valuetext'), 'ふつう');
      await control.fill('75');
      await control.dispatchEvent('change');
      await ready();
    }
  }
  // Re-select the same preset too: edited coefficients must return to their defaults.
  await ui.getByRole('button', { name: '1日の光', exact: true }).click();
  await ready();
  for (const label of ['夜の深さ', '灯りの強さ'])
    assert.equal(
      Number(await ui.getByRole('slider', { name: label, exact: true }).inputValue()),
      50,
    );
  report.presetsAndScales = true;
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
  await ui.getByLabel('画像ファイル').setInputFiles(file);
  await ready();
  assert.equal(
    await ui.locator('canvas').getAttribute('aria-label'),
    `${path.basename(file)}の色の台本`,
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
  assert.equal(await ui.locator('canvas').getAttribute('aria-label'), 'drop.pngの色の台本');
  report.sampleFileDrop = true;
  const beforeBad = await canvasData();
  await ui
    .getByLabel('画像ファイル')
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
