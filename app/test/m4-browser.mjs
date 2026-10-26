import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createServer, preview } from 'vite';
import {
  chromium,
  firefox,
  webkit,
} from '../../tools/visual-qa/node_modules/playwright-core/index.mjs';
import { assertSelection, measureSelection, selectionFixture } from './selection.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = path.join(root, 'test/results/m4-browsers');
await mkdir(out, { recursive: true });
const axeSource = await readFile(path.join(root, 'node_modules/axe-core/axe.min.js'), 'utf8');
const report = { browsers: [], pendingVisualViolations: [] };
let server, dev;
try {
  server = await preview({ root, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  dev = await createServer({
    root,
    base: '/',
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    logLevel: 'error',
  });
  await dev.listen();
  for (const [name, type] of [
    ['chrome', chromium],
    ['firefox', firefox],
    ['webkit', webkit],
  ]) {
    if (process.env.M4_BROWSERS && !process.env.M4_BROWSERS.split(',').includes(name)) continue;
    let browser;
    const row = {
      name,
      errors: [],
      consoleErrors: [],
      externalRequests: [],
      audits: [],
      keyboardFocus: [],
      samples: [],
    };
    report.browsers.push(row);
    try {
      browser = await type.launch(name === 'chrome' ? { channel: 'chrome' } : {});
      row.version = browser.version();
      const context = await browser.newContext({
        viewport: { width: 1440, height: 960 },
        acceptDownloads: true,
      });
      const page = await context.newPage();
      page.on('pageerror', (e) => row.errors.push(e.message));
      page.on('console', (e) => {
        if (e.type() === 'error') row.consoleErrors.push(e.text());
      });
      const origin = new URL(server.resolvedUrls.local[0]).origin;
      await page.route('**/*', (route) => {
        const u = new URL(route.request().url());
        if (u.origin === origin || ['blob:', 'data:'].includes(u.protocol)) return route.continue();
        row.externalRequests.push(u.href);
        return route.abort();
      });
      const ready = () =>
        page.waitForFunction(
          () => document.querySelector('input[aria-label="長さ"]')?.disabled === false,
          null,
          { timeout: 60000 },
        );
      const tabTo = async (target) => {
        await page.bringToFront();
        for (const key of ['Tab', 'Shift+Tab']) {
          let previous = '',
            stuck = 0;
          for (let i = 0; i < 150; i++) {
            if (await target.evaluate((n) => n === document.activeElement)) {
              const focus = await target.evaluate((n) => ({
                visible: n.matches(':focus-visible'),
                width: getComputedStyle(n).outlineWidth,
                style: getComputedStyle(n).outlineStyle,
              }));
              assert.ok(focus.visible && parseFloat(focus.width) >= 2 && focus.style !== 'none');
              row.keyboardFocus.push(
                (await target.getAttribute('aria-label')) ?? (await target.textContent()),
              );
              return;
            }
            await page.keyboard.press(key);
            const active = await page.evaluate(() => document.activeElement.outerHTML);
            stuck = active === previous ? stuck + 1 : 0;
            previous = active;
            if (stuck >= 3) break;
          }
        }
        throw new Error(`Keyboard cannot reach ${await target.textContent()}`);
      };
      const activate = async (target) => {
        await tabTo(target);
        await page.keyboard.press('Enter');
      };
      const button = (label) => page.getByRole('button', { name: label, exact: true });
      const audit = async (state) => {
        if (!(await page.evaluate(() => !!window.axe))) await page.evaluate(axeSource);
        const result = await page.evaluate(() => window.axe.run());
        row.audits.push({ state, violations: result.violations, incomplete: result.incomplete });
        for (const violation of result.violations)
          report.pendingVisualViolations.push({
            browser: name,
            state,
            id: violation.id,
            nodes: violation.nodes,
          });
      };
      const requests = [];
      page.on('response', async (response) => {
        if (response.request().resourceType() !== 'image') return;
        requests.push({ url: response.url(), bytes: (await response.body()).length });
      });
      await page.goto(server.resolvedUrls.local[0]);
      await ready();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(200);
      row.initialImages = requests.slice();
      assert.equal(
        requests.filter((r) => r.bytes > 100000).length,
        1,
        'Only the selected full image may load',
      );
      row.startupTiming = await page.evaluate(() => ({
        navigation: performance.getEntriesByType('navigation')[0].toJSON(),
        resources: performance.getEntriesByType('resource').map((r) => r.toJSON()),
      }));
      assert.ok(page.url().includes('/hitomeguri-color/'));
      await audit('initial');
      await activate(page.getByRole('link', { name: '絵へ移る', exact: true }));
      assert.equal(await page.locator(':focus').getAttribute('id'), 'picture');
      const timeline = page.getByRole('slider', { name: '1周の中の時刻', exact: true });
      const clock = page.locator('.when span');
      assert.ok((await clock.textContent()).startsWith('0.0'));
      await activate(button('再生'));
      await page.waitForFunction(
        () => parseFloat(document.querySelector('.when span').textContent) > 0.1,
      );
      await activate(button('一時停止'));
      const stopped = await clock.textContent();
      await page.waitForTimeout(200);
      assert.equal(await clock.textContent(), stopped);
      await tabTo(timeline);
      await page.keyboard.press('Home');
      await page.keyboard.press('Shift+ArrowRight');
      assert.ok((await clock.textContent()).startsWith('1.0'));
      await page.keyboard.press('End');
      assert.ok((await clock.textContent()).startsWith('24.0'));
      await page.keyboard.press('Home');
      row.playbackAndTimeline = true;
      for (const sample of ['雪の村', '灯台の岬', 'オアシス', '港町', '運河の街']) {
        await activate(button(sample));
        await ready();
        assert.equal(await button(sample).getAttribute('aria-pressed'), 'true');
      }
      for (const preset of ['長い夕暮れ', '夜の灯り', '1日の光']) {
        await activate(button(preset));
        await ready();
        for (const label of ['長さ', '夜の深さ', '灯りの強さ']) {
          const slider = page.getByRole('slider', { name: label, exact: true });
          assert.equal(Number(await slider.inputValue()), 50);
          await tabTo(slider);
          await page.keyboard.press('ArrowRight');
          await ready();
          assert.notEqual(Number(await slider.inputValue()), 50);
        }
      }
      await activate(button('1日の光'));
      await ready();
      const swatch = page.getByRole('button', { name: /^空、/ }).first();
      await activate(swatch);
      await audit('island-selected');
      const role = page.getByRole('combobox', { name: '役割', exact: true });
      const originalRole = await role.inputValue();
      await tabTo(role);
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Tab');
      await ready();
      assert.notEqual(await role.inputValue(), originalRole);
      await activate(button('自動に戻す'));
      await ready();
      assert.equal(await role.inputValue(), originalRole);
      await activate(button('上下の線で分ける'));
      await audit('splitting');
      const line = page.getByRole('slider', { name: '島を分ける線' });
      const at = Number(await line.getAttribute('aria-valuenow'));
      await tabTo(line);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Shift+ArrowUp');
      assert.equal(Number(await line.getAttribute('aria-valuenow')), Math.max(1, at - 9));
      for (const label of ['上の役割', '下の役割']) {
        await tabTo(page.getByRole('combobox', { name: label }));
        await page.keyboard.press('Home');
        await page.keyboard.press('Enter');
        await page.keyboard.press('Tab');
      }
      const count = await page.locator('.swatch').count();
      await activate(button('分ける'));
      await ready();
      assert.equal(await page.locator('.swatch').count(), count + 1);
      await activate(page.getByRole('button', { name: /（上）、面積/ }).first());
      await activate(button('分割を戻す'));
      await ready();
      assert.equal(await page.locator('.swatch').count(), count);
      row.islandsAndSplits = true;
      await tabTo(timeline);
      await page.keyboard.press('Home');
      for (let i = 0; i < 12; i++) await page.keyboard.press('Shift+ArrowRight');
      await audit('midnight');
      row.videoSupport = await page.evaluate(
        async () =>
          typeof VideoEncoder !== 'undefined' &&
          (
            await VideoEncoder.isConfigSupported({
              codec: 'avc1.420033',
              width: 256,
              height: 128,
              bitrate: 12000000,
              framerate: 30,
              latencyMode: 'quality',
              avc: { format: 'avc' },
            })
          ).supported,
      );
      if (row.videoSupport) {
        await activate(button('動画を書き出す'));
        await page.getByRole('progressbar').waitFor();
        await audit('exporting');
        assert.equal(await page.locator(':focus').textContent(), '中止');
        await page.keyboard.press('Enter');
        await ready();
        row.exportCancelled = true;
      }
      await selectionFixture(page);
      row.selectionPixels = await measureSelection(page);
      assertSelection(row.selectionPixels);
      const pngWait = page.waitForEvent('download');
      await activate(button('この瞬間を画像で保存'));
      const png = await pngWait;
      await png.saveAs(path.join(out, `${name}.png`));
      assert.equal(
        (await readFile(path.join(out, `${name}.png`))).subarray(1, 4).toString(),
        'PNG',
      );
      row.png = true;
      const length = page.getByRole('slider', { name: '長さ', exact: true });
      await tabTo(length);
      await page.keyboard.press('Home');
      await ready();
      if (row.videoSupport) {
        const download = page.waitForEvent('download', { timeout: 120000 });
        await activate(button('動画を書き出す'));
        await (await download).saveAs(path.join(out, `${name}.mp4`));
        await ready();
        const probe = await promisify(execFile)(
          'ffprobe',
          [
            '-v',
            'error',
            '-select_streams',
            'v:0',
            '-show_entries',
            'stream=codec_name,width,height,duration,nb_frames',
            '-of',
            'json',
            path.join(out, `${name}.mp4`),
          ],
          { windowsHide: true },
        );
        row.mp4Probe = JSON.parse(probe.stdout).streams[0];
        assert.equal(row.mp4Probe.codec_name, 'h264');
        assert.equal(Number(row.mp4Probe.duration), 12);
        assert.equal(Number(row.mp4Probe.nb_frames), 360);
        row.mp4 = true;
      } else {
        await activate(button('動画を書き出す'));
        await page
          .getByRole('alert')
          .filter({ hasText: 'このブラウザでは動画を書き出せません' })
          .waitFor();
        await audit('unsupported-export');
        assert.ok(await button('この瞬間を画像で保存').isEnabled());
        const stillDownload = page.waitForEvent('download');
        await activate(button('この瞬間を画像で保存'));
        await (await stillDownload).saveAs(path.join(out, `${name}-after-unsupported.png`));
        row.unsupportedStillWorks = true;
      }
      const canvasBeforeError = await page.locator('canvas').evaluate((n) => n.toDataURL());
      await tabTo(button('自分の絵を開く'));
      row.fileChooserFocus = await page.evaluate(() => ({
        hasFocus: document.hasFocus(),
        active: document.activeElement.outerHTML,
        activation: navigator.userActivation.isActive,
      }));
      const chooser = page.waitForEvent('filechooser');
      await page.keyboard.press('Enter');
      await (await chooser).setFiles({
        name: 'broken.png',
        mimeType: 'image/png',
        buffer: Buffer.from('invalid'),
      });
      await page.getByRole('alert').filter({ hasText: 'この画像は開けませんでした' }).waitFor();
      assert.equal(await page.locator('canvas').evaluate((n) => n.toDataURL()), canvasBeforeError);
      await audit('load-error');
      const chooserGood = page.waitForEvent('filechooser');
      await activate(button('自分の絵を開く'));
      await (await chooserGood).setFiles(path.join(root, 'src/assets/samples/flat.webp'));
      await ready();
      row.fileChooser = true;
      const dropped = (await readFile(path.join(root, 'src/assets/samples/flat.webp'))).toString(
        'base64',
      );
      await page.evaluate((base64) => {
        const dt = new DataTransfer();
        dt.items.add(
          new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], 'drop.webp', {
            type: 'image/webp',
          }),
        );
        window.dispatchEvent(
          new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }),
        );
      }, dropped);
      await ready();
      assert.equal(await page.locator('canvas').getAttribute('aria-label'), 'dropの色の台本');
      row.drop = true;
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForFunction(() => document.querySelector('.play').disabled);
      await tabTo(timeline);
      await page.keyboard.press('Home');
      await page.keyboard.press('Shift+ArrowRight');
      const still = await page.locator('canvas').evaluate((n) => n.toDataURL());
      const time = await clock.textContent();
      await page.waitForTimeout(5000);
      assert.equal(await page.locator('canvas').evaluate((n) => n.toDataURL()), still);
      assert.equal(await clock.textContent(), time);
      row.reducedMotionFiveSecondsExact = true;
      for (const [width, height] of [
        [1440, 960],
        [390, 844],
      ]) {
        await page.setViewportSize({ width, height });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        const footer = await page.evaluate(() => {
          const main = document.querySelector('main');
          return {
            gap:
              document.querySelector('footer p').getBoundingClientRect().top -
              main.getBoundingClientRect().bottom +
              Number.parseFloat(getComputedStyle(main).paddingBottom),
            text: document.querySelector('footer').textContent,
          };
        });
        assert.equal(footer.gap, 48);
        assert.ok(footer.text.includes('GitHub にあります。使っている'));
        for (const label of ['GitHub にあります', '素材のライセンス'])
          await tabTo(page.getByRole('link', { name: label, exact: true }));
        await page.screenshot({
          path: path.join(root, `reports/M4-${name}-${width}.png`),
          fullPage: true,
        });
      }
      const harness = await context.newPage();
      await harness.goto(`${dev.resolvedUrls.local[0]}test/harness.html`);
      await harness.waitForFunction(() => window.harness);
      for (const id of ['canal', 'snow', 'lighthouse', 'oasis', 'flat']) {
        const sample = await harness.evaluate((id) => window.harness.sampleTest(id), id);
        row.samples.push(sample);
        assert.equal(sample.identity.psnrDb, 'Infinity');
        assert.equal(sample.lossless.psnrDb, 'Infinity');
        assert.ok(sample.endpoints.every((e) => e.psnrDb === 'Infinity'));
      }
      await harness.close();
      assert.deepEqual(row.errors, []);
      assert.deepEqual(row.consoleErrors, []);
      assert.deepEqual(row.externalRequests, []);
      row.passed = true;
      console.log(
        `${name} ${row.version}: all operations passed; MP4=${row.videoSupport}, axe=${row.audits.reduce((n, a) => n + a.violations.length, 0)}`,
      );
    } catch (e) {
      row.failure = e.stack;
      console.error(`${name}: ${e.stack}`);
    } finally {
      await browser?.close();
      await writeFile(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    }
  }
  assert.ok(
    report.browsers.every((r) => r.passed),
    'Every browser must complete its operation checks',
  );
} finally {
  await dev?.close();
  if (server) await new Promise((resolve) => server.httpServer.close(resolve));
  await writeFile(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
}
