import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import {
  chromium,
  firefox,
  webkit,
} from '../../tools/visual-qa/node_modules/playwright-core/index.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = path.join(root, 'test/results/v02s');
await mkdir(out, { recursive: true });
const axe = await readFile(path.join(root, 'node_modules/axe-core/axe.min.js'), 'utf8');
const report = [];
const server = await preview({ root, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
try {
  for (const [name, type] of [
    ['chrome', chromium],
    ['firefox', firefox],
    ['webkit', webkit],
  ]) {
    const row = {
      name,
      errors: [],
      consoleErrors: [],
      externalRequests: [],
      audits: [],
      rules: [],
    };
    report.push(row);
    const browser = await type.launch(name === 'chrome' ? { channel: 'chrome' } : {});
    row.version = browser.version();
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 960 },
      });
      const page = await context.newPage();
      page.on('pageerror', (e) => row.errors.push(e.message));
      page.on('console', (e) => {
        if (e.type() === 'error') row.consoleErrors.push(e.text());
      });
      const origin = new URL(server.resolvedUrls.local[0]).origin;
      page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.origin !== origin && !['blob:', 'data:'].includes(url.protocol))
          row.externalRequests.push(url.href);
      });
      const ready = () =>
        page.waitForFunction(
          () => document.querySelector('input[aria-label="長さ"]')?.disabled === false,
          null,
          { timeout: 60000 },
        );
      const button = (label) => page.getByRole('button', { name: label, exact: true });
      const select = async (label) => {
        await button(label).click();
        await ready();
        assert.equal(await button(label).getAttribute('aria-pressed'), 'true');
      };
      const person = () => page.locator('.foreground-summary span').textContent();
      const settings = () =>
        page.evaluate(() => {
          const node = document.querySelector('.foreground-position');
          if (!node) return null;
          return {
            left: parseFloat(node.style.left),
            top: parseFloat(node.style.top),
            width: parseFloat(node.style.width),
            height: parseFloat(node.style.height),
            size: document.querySelector('[aria-label="大きさ"]').value,
            blend: document.querySelector('[aria-label="光のなじみ"]').value,
          };
        });
      const assertPlacement = async (x, y, size) => {
        const at = await settings();
        assert.ok(Math.abs(at.left + at.width / 2 - x * 100) < 1e-3);
        assert.ok(Math.abs(at.top + at.height - y * 100) < 1e-3);
        assert.equal(at.size, String(Math.round(size * 100)));
        assert.equal(at.blend, '50');
      };
      const capture = (state) =>
        page.screenshot({
          path: path.join(root, `reports/V02S-${name}-${state}.png`),
          fullPage: true,
        });
      const audit = async (state) => {
        if (!(await page.evaluate(() => !!window.axe))) await page.evaluate(axe);
        const result = await page.evaluate(() => window.axe.run());
        row.audits.push({ state, violations: result.violations });
        assert.equal(result.violations.length, 0, `${name}/${state}: axe`);
      };
      const replace = async (filename = '自分の人物.png') => {
        const chooser = page.waitForEvent('filechooser');
        // Exercise the visible replacement button with the keyboard.
        await page.locator('[aria-label="光のなじみ"]').focus();
        await page.keyboard.press('Tab');
        assert.ok(
          await button('人物の絵を替える').evaluate(
            (n) => n === document.activeElement && n.matches(':focus-visible'),
          ),
        );
        await page.keyboard.press('Enter');
        await (await chooser).setFiles({
          name: filename,
          mimeType: 'image/png',
          buffer: await readFile(path.join(root, '../assets/showcase/layer/girl.png')),
        });
        await ready();
      };
      await page.goto(server.resolvedUrls.local[0]);
      await ready();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(200);
      row.loading = await page.evaluate(() => {
        const navigation = performance.getEntriesByType('navigation')[0].toJSON();
        const resources = performance.getEntriesByType('resource').map((r) => r.toJSON());
        return {
          navigation,
          resources,
          transferBytes:
            navigation.transferSize + resources.reduce((n, r) => n + r.transferSize, 0),
        };
      });
      assert.ok(row.loading.transferBytes <= 3000000, `${name}: cold startup <= 3.0MB`);
      const fullImages = [
        ...new Map(
          row.loading.resources
            .filter((r) => r.name.endsWith('.webp') && r.decodedBodySize > 100000)
            .map((r) => [r.name, r]),
        ).values(),
      ];
      assert.equal(fullImages.length, 2);
      assert.ok(fullImages.some((r) => /\/seaside-/.test(r.name)));
      assert.ok(fullImages.some((r) => /\/girl-(?!yukata)/.test(r.name)));
      row.loading.unselectedFullImages = 0;
      assert.equal(await person(), '海辺の女の子');
      assert.equal(await button('海辺').getAttribute('aria-pressed'), 'true');
      await assertPlacement(0.76, 1.6, 1.2);
      assert.equal(await page.locator('.when span').textContent(), '0.0 / 24 秒');
      assert.equal(await page.locator('.thumb').count(), 7);
      assert.deepEqual(
        await page
          .locator('.thumb')
          .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-label'))),
        ['海辺', 'お祭り', '運河の街', '雪の村', '灯台の岬', 'オアシス', '港町'],
      );
      assert.ok(
        await page
          .locator('.thumb img')
          .evaluateAll((nodes) =>
            nodes.every((n) => n.naturalWidth === 96 && n.naturalHeight === 64),
          ),
      );
      await capture('initial');
      await page
        .locator('.samples')
        .screenshot({ path: path.join(root, `reports/V02S-${name}-samples.png`) });
      await audit('initial-seaside');
      await select('海辺');
      assert.equal(await person(), '海辺の女の子');
      await assertPlacement(0.76, 1.6, 1.2);
      await capture('seaside');
      await audit('seaside');
      await page.getByRole('slider', { name: '大きさ', exact: true }).fill('80');
      await select('お祭り');
      await assertPlacement(0.5, 1.26, 1.05);
      row.rules.push('sample replaces person and resets settings');
      await button('外す').click();
      assert.equal(await page.locator('.foreground-position').count(), 0);
      await select('お祭り');
      assert.equal(await person(), '浴衣の女の子');
      row.rules.push('reopening restores removed sample person');
      await select('運河の街');
      assert.equal(await page.locator('.foreground-position').count(), 0);
      await select('海辺');
      await page
        .getByLabel('画像ファイル', { exact: true })
        .setInputFiles(path.join(root, 'src/assets/samples/flat.webp'));
      await ready();
      assert.equal(await page.locator('.foreground-position').count(), 0);
      row.rules.push('person-free sample and local picture remove sample person');
      await select('お祭り');
      const placement = await settings();
      await replace();
      assert.equal(await person(), '自分の人物');
      assert.deepEqual(await settings(), placement, 'replacement preserves placement and blend');
      await audit('user-replacement');
      await replace('次の人物.png');
      assert.equal(await person(), '次の人物');
      assert.deepEqual(await settings(), placement);
      const invalid = page.waitForEvent('filechooser');
      await button('人物の絵を替える').click();
      await (await invalid).setFiles(path.join(root, 'src/assets/samples/flat.webp'));
      await ready();
      await page
        .getByRole('alert')
        .filter({ hasText: 'この画像には透けた部分がありません' })
        .waitFor();
      assert.equal(await person(), '次の人物');
      assert.deepEqual(await settings(), placement);
      row.opaqueReplacementPreservesPerson = true;
      for (const label of ['運河の街', '雪の村', '灯台の岬', 'オアシス', '港町']) {
        await select(label);
        assert.equal(await person(), '次の人物');
        assert.deepEqual(await settings(), placement);
      }
      await page
        .getByLabel('画像ファイル', { exact: true })
        .setInputFiles(path.join(root, 'src/assets/samples/flat.webp'));
      await ready();
      assert.equal(await person(), '次の人物');
      assert.deepEqual(await settings(), placement);
      row.rules.push(
        'replacement is user-owned and survives person-free samples and local pictures',
      );
      await select('海辺');
      assert.equal(await person(), '海辺の女の子');
      await assertPlacement(0.76, 1.6, 1.2);
      await select('お祭り');
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await capture('mobile');
      await audit('mobile-festival');
      const png = page.waitForEvent('download');
      await button('この瞬間を画像で保存').click();
      assert.equal((await png).suggestedFilename(), 'ひとめぐり-お祭り-0秒.png');
      row.pngName = true;
      assert.deepEqual(row.errors, []);
      assert.deepEqual(row.consoleErrors, []);
      assert.deepEqual(row.externalRequests, []);
      row.passed = true;
      console.log(
        `${name}: four rules, replacement, axe 0; cold startup ${row.loading.transferBytes} bytes`,
      );
    } catch (error) {
      row.failure = error.stack;
      throw error;
    } finally {
      await browser.close();
      await writeFile(path.join(out, 'browsers.json'), `${JSON.stringify(report, null, 2)}\n`);
    }
  }
} finally {
  await new Promise((resolve) => server.httpServer.close(resolve));
}
