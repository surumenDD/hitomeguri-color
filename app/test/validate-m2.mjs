import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from '../../tools/visual-qa/node_modules/playwright-core/index.mjs';

const root = fileURLToPath(new URL('..', import.meta.url)),
  out = path.join(root, 'test/results/m2-v42-videos');
await mkdir(out, { recursive: true });
let report;
try {
  report = JSON.parse(await readFile(path.join(out, 'report.json'), 'utf8'));
} catch {
  report = {
    version: 'v4.2',
    when: new Date().toISOString(),
    conditions: [],
    defaults: [],
    parity: [],
    errors: [],
  };
}
const command = (cmd, args) =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '',
      stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('error', reject);
    p.on('close', (code) =>
      code === 0 ? resolve(stdout) : reject(new Error(`${cmd}: ${stderr}`)),
    );
  });
let server, browser;
try {
  server = await createServer({
    root,
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    logLevel: 'error',
  });
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  page.on('pageerror', (e) => report.errors.push(e.message));
  await page.goto(`${server.resolvedUrls.local[0]}test/engine.html`);
  await page.waitForFunction(() => window.engine);
  for (const image of ['canal', 'snow', 'lighthouse', 'oasis', 'flat']) {
    const source = await page.evaluate((id) => window.engine.load(id), image);
    const error = await page.evaluate(() => window.engine.parity());
    if (!report.parity.some((p) => p.image === image))
      report.parity.push({ image, error, timing: source.timing });
    assert.equal(error, 0);
    for (const preset of ['day', 'longDusk', 'nightLights']) {
      if (report.defaults.some((row) => row.image === image && row.preset === preset)) continue;
      const output = await page.evaluate(
        (p) => window.engine.video(p, {}, { maxEdge: 384 }),
        preset,
      );
      const name = `${image}-${preset}-default.mp4`,
        file = path.join(out, name);
      await writeFile(file, Buffer.from(output.base64, 'base64'));
      delete output.base64;
      const verdict = JSON.parse(
        await command(process.execPath, [
          path.join(root, '../tools/visual-qa/flash-check.mjs'),
          file,
          '--css-px-per-px',
          String(1536 / output.width),
        ]),
      );
      report.defaults.push({
        image,
        preset,
        file: name,
        width: output.width,
        height: output.height,
        frames: output.frames,
        app: output.report,
        estimate: output.estimate,
        node: verdict,
      });
      await writeFile(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
      assert.ok(
        verdict.wcag.pass &&
          verdict.itu.pass &&
          output.estimate.pass &&
          output.report.wcag.pass &&
          output.report.itu.pass,
        name,
      );
      console.log(`default ${report.defaults.length}/15 ${name} pass`);
    }
    for (const preset of ['day', 'longDusk', 'nightLights'])
      for (const durationSec of [12, 48])
        for (const nightDepth of [0.2, 4])
          for (const glow of [0, 2]) {
            const name = `${image}-${preset}-${durationSec}-${nightDepth}-${glow}.mp4`,
              file = path.join(out, name);
            if (report.conditions.some((r) => r.file === name)) continue;
            const output = await page.evaluate(
              ({ preset, durationSec, nightDepth, glow }) =>
                window.engine.video(preset, { durationSec, nightDepth, glow }, { maxEdge: 384 }),
              { preset, durationSec, nightDepth, glow },
            );
            await writeFile(file, Buffer.from(output.base64, 'base64'));
            delete output.base64;
            const raw = await command(process.execPath, [
              path.join(root, '../tools/visual-qa/flash-check.mjs'),
              file,
              '--css-px-per-px',
              String(1536 / output.width),
            ]);
            const verdict = JSON.parse(raw);
            const row = {
              image,
              preset,
              durationSec,
              nightDepth,
              glow,
              file: name,
              width: output.width,
              height: output.height,
              frames: output.frames,
              app: output.report,
              estimate: output.estimate,
              node: verdict,
            };
            report.conditions.push(row);
            await writeFile(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
            console.log(
              `${report.conditions.length}/120 ${name} app=${output.report.wcag.pass && output.report.itu.pass} node=${verdict.wcag.pass && verdict.itu.pass} L=${output.estimate.maxClampedPixels}/${output.estimate.maxExcursion}`,
            );
            assert.ok(verdict.wcag.pass && verdict.itu.pass, name);
            assert.ok(output.estimate.pass, name);
            assert.ok(output.report.wcag.pass && output.report.itu.pass, name);
          }
  }
  await page.evaluate(() => window.engine.load('canal'));
  const full = await page.evaluate(() =>
    window.engine.video('day', { durationSec: 12 }, { width: 1920, height: 1080 }),
  );
  await writeFile(path.join(out, '1080p-12s.mp4'), Buffer.from(full.base64, 'base64'));
  delete full.base64;
  report.full = full;
  report.ffprobe = JSON.parse(
    await command('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=codec_name,width,height,nb_frames,duration',
      '-of',
      'json',
      path.join(out, '1080p-12s.mp4'),
    ]),
  );
  const stream = report.ffprobe.streams[0];
  assert.equal(stream.codec_name, 'h264');
  assert.equal(stream.width, 1920);
  assert.equal(stream.height, 1080);
  assert.equal(Number(stream.nb_frames), 360);
  assert.equal(Number(stream.duration), 12);
  assert.deepEqual(report.errors, []);
  report.passed = true;
} finally {
  await browser?.close();
  await server?.close();
  await writeFile(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
}
