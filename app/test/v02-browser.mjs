import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import {
  chromium,
  firefox,
  webkit,
} from '../../tools/visual-qa/node_modules/playwright-core/index.mjs';
import { foregroundOperations } from './v02-ui.mjs';

const root = fileURLToPath(new URL('..', import.meta.url)),
  server = await preview({ root, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
const axe = await readFile(path.join(root, 'node_modules/axe-core/axe.min.js'), 'utf8'),
  report = [];
try {
  for (const [name, type] of [
    ['chrome', chromium],
    ['firefox', firefox],
    ['webkit', webkit],
  ]) {
    if (process.env.M4_BROWSERS && !process.env.M4_BROWSERS.split(',').includes(name)) continue;
    const browser = await type.launch(name === 'chrome' ? { channel: 'chrome' } : {}),
      row = { name, audits: [], errors: [], consoleErrors: [] };
    report.push(row);
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    page.on('pageerror', (e) => row.errors.push(e.message));
    page.on('console', (e) => {
      if (e.type() === 'error') row.consoleErrors.push(e.text());
    });
    try {
      await page.goto(server.resolvedUrls.local[0]);
      const ready = () =>
        page.waitForFunction(
          () => document.querySelector('input[aria-label="長さ"]')?.disabled === false,
          null,
          { timeout: 60000 },
        );
      await ready();
      const tabTo = async (target) => {
        for (const key of ['Tab', 'Shift+Tab'])
          for (let i = 0; i < 150; i++) {
            if (await target.evaluate((n) => n === document.activeElement)) return;
            await page.keyboard.press(key);
          }
        throw new Error(`Cannot tab to ${await target.textContent()}`);
      };
      const activate = async (target) => {
        await tabTo(target);
        await page.keyboard.press('Enter');
      };
      const audit = async (state) => {
        if (!(await page.evaluate(() => !!window.axe))) await page.evaluate(axe);
        const result = await page.evaluate(() => window.axe.run());
        row.audits.push({ state, violations: result.violations });
        assert.equal(result.violations.length, 0);
      };
      row.operations = await foregroundOperations(page, {
        root,
        name,
        activate,
        tabTo,
        audit,
        ready,
      });
      assert.deepEqual(row.errors, []);
      assert.deepEqual(row.consoleErrors, []);
      row.pass = true;
      console.log(`${name}: foreground operations and axe pass`);
    } catch (e) {
      row.failure = e.stack;
      console.error(name, e.stack);
      await page.screenshot({
        path: path.join(root, `reports/V02-${name}-failure.png`),
        fullPage: true,
      });
    } finally {
      await browser.close();
    }
  }
  assert.ok(report.every((r) => r.pass));
} finally {
  await new Promise((resolve) => server.httpServer.close(resolve));
  await writeFile(
    path.join(root, 'test/results/v02/browsers.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}
