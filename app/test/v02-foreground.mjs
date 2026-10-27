import assert from 'node:assert/strict';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from '../../tools/visual-qa/node_modules/playwright-core/index.mjs';

const root = fileURLToPath(new URL('..', import.meta.url)),
  out = path.join(root, 'test/results/v02');
await mkdir(out, { recursive: true });
for (const name of ['girl', 'seaside', 'riverbank'])
  await copyFile(
    path.join(root, '../assets/showcase/layer', `${name}.png`),
    path.join(out, `${name}.png`),
  );
const server = await createServer({
  root,
  base: '/',
  server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
  logLevel: 'error',
});
let browser;
const report = { formula: 'v2', specCommit: 'b6e3f17', scenes: [], errors: [] };
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  page.on('pageerror', (e) => report.errors.push(e.message));
  await page.goto(`${server.resolvedUrls.local[0]}test/v02-engine.html`);
  await page.waitForFunction(() => window.foregroundTest);
  for (const [id, fg, x] of [
    ['synthetic', undefined, 0.68],
    ['seaside', 'girl', 0.68],
    ['riverbank', 'girl', 0.25],
  ]) {
    const source = `/test/results/v02/${id === 'synthetic' ? 'seaside' : id}.png`;
    const scene = await page.evaluate(
      ([s, f, x]) => window.foregroundTest.load(s, f, x),
      [source, fg ? '/test/results/v02/girl.png' : undefined, x],
    );
    const result = await page.evaluate(() => window.foregroundTest.verify());
    report.scenes.push({ id, ...scene, ...result });
    assert.ok(
      result.endpoints.every((e) => e.max <= 1),
      `${id}: start/end linear-light composite`,
    );
    assert.ok(
      result.noForeground.every((e) => e.max === 0),
      `${id}: no foreground shader parity`,
    );
    assert.ok(
      result.backgroundEndpoints.every((e) => e.max === 0),
      `${id}: background endpoints match original image exactly`,
    );
    assert.ok(
      result.loopSeams.every((e) => e.max === 0),
      `${id}: foreground loop seam exact`,
    );
    assert.ok(
      result.adaptation.every((e) => e.max <= 1),
      `${id}: shader follows CPU adaptation, including blend 0`,
    );
    assert.notDeepEqual(result.preview[0].original, result.preview[0].selected);
    assert.deepEqual(result.preview[0].original, result.preview[0].split);
    assert.notDeepEqual(result.preview[1].original, result.preview[1].selected);
    assert.deepEqual(result.preview[1].selected, result.preview[1].split);
    for (const [time, seconds] of [
      ['evening', 0],
      ['midnight', 12],
      ['day', 21],
    ]) {
      const png = await page.evaluate(
        ([preset, seconds]) => window.foregroundTest.png(preset, seconds),
        ['day', seconds],
      );
      assert.equal(png.comparison.max, 0, `${id}/${time}: PNG matches actual composite`);
      const row = report.scenes.at(-1);
      row.pngs ??= [];
      row.pngs.push({ time, ...png.comparison });
      await writeFile(path.join(out, `${id}-${time}.png`), Buffer.from(png.bytes));
    }
    if (id === 'seaside')
      report.performance = await page.evaluate(() => window.foregroundTest.performanceTest());
    console.log(`${id}: endpoints <=1 byte, no-foreground exact at 18 times`);
  }
  assert.deepEqual(report.errors, []);
  report.resize = await page.evaluate(() => window.foregroundTest.resizeTest());
  assert.deepEqual(report.resize, { width: 2048, height: 1 });
  assert.ok(report.performance.wallMedianMs < 1000 / 60, '1080p wall median fits 60fps');
  assert.ok(report.performance.rafMedianMs < 17.5, '1080p RAF median sustains 60fps');
  console.log(JSON.stringify(report.performance, null, 2));
} finally {
  await browser?.close();
  await server.close();
  await writeFile(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
}
