// Drives the export spike in headless Chrome.
//
//   node run-export.mjs             # render references + export everything
//   node run-export.mjs --reuse-ref # keep existing out/ref-* frames
//
// The page is served over http://127.0.0.1 because WebCodecs is [SecureContext]:
// on about:blank `VideoEncoder` is simply undefined. Files come back the other way
// as POST bodies to /upload, so multi-MB videos never cross the CDP boundary.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '../../tools/visual-qa/node_modules/playwright-core/index.mjs';

const HERE = import.meta.dirname;
const OUT = path.join(HERE, 'out');
const FPS = 30;
const GIF_FPS = 20;
const SECONDS = 8;
const FRAMES = FPS * SECONDS;
const GIF_FRAMES = GIF_FPS * SECONDS;
const reuseRef = process.argv.includes('--reuse-ref');

const VIDEO_JOBS = [
  { format: 'mp4', width: 1280, height: 720, bitrate: 4_000_000, name: 'loop-1280x720-h264.mp4' },
  { format: 'mp4', width: 1920, height: 1080, bitrate: 8_000_000, name: 'loop-1920x1080-h264.mp4' },
  { format: 'webm', width: 1280, height: 720, bitrate: 4_000_000, name: 'loop-1280x720-vp9.webm' },
  { format: 'webm', width: 1920, height: 1080, bitrate: 8_000_000, name: 'loop-1920x1080-vp9.webm' },
];

const GIF_JOBS = [
  { width: 960, height: 540, fps: GIF_FPS, paletteMode: 'per-frame', name: 'loop-960x540-20fps.gif' },
  { width: 960, height: 540, fps: GIF_FPS, paletteMode: 'global', name: 'loop-960x540-20fps-global-palette.gif' },
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.map': 'application/json; charset=utf-8',
};

const log = (...args) => console.log(new Date().toISOString().slice(11, 19), ...args);

function startServer() {
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'POST' && req.url.startsWith('/upload/')) {
        const rel = decodeURIComponent(req.url.slice('/upload/'.length));
        // Only plain relative paths, and only ever inside out/.
        if (!/^[A-Za-z0-9._\-/]+$/.test(rel) || rel.includes('..')) {
          res.writeHead(400).end('bad path');
          return;
        }
        const dest = path.resolve(OUT, rel);
        if (!dest.startsWith(OUT + path.sep)) {
          res.writeHead(400).end('bad path');
          return;
        }
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        await fsp.writeFile(dest, body);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ bytes: body.length }));
        return;
      }
      const url = new URL(req.url, 'http://127.0.0.1');
      const rel = url.pathname === '/' ? '/index.html' : url.pathname;
      const file = path.resolve(HERE, '.' + rel);
      if (!file.startsWith(HERE)) {
        res.writeHead(403).end('no');
        return;
      }
      const data = await fsp.readFile(file);
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(data);
    } catch (e) {
      res.writeHead(e.code === 'ENOENT' ? 404 : 500).end(String(e.message));
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}

async function clearDir(dir) {
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(dir, { recursive: true });
}

const run = {
  startedAt: new Date().toISOString(),
  page: 'experiments/export-spike/index.html',
  settings: { fps: FPS, gifFps: GIF_FPS, seconds: SECONDS, frames: FRAMES, gifFrames: GIF_FRAMES },
  determinism: null,
  browser: null,
  capabilities: null,
  smokeTest: null,
  references: [],
  exports: [],
};

const { server, origin } = await startServer();
await fsp.mkdir(OUT, { recursive: true });
log('serving', HERE, 'at', origin);

const browser = await chromium.launch({ channel: 'chrome', protocolTimeout: 900_000 });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => {
  const text = m.text();
  if (/error|warn/i.test(m.type())) log(`[page ${m.type()}]`, text.slice(0, 400));
});
page.on('pageerror', (e) => log('[pageerror]', e.message));

try {
  await page.goto(`${origin}/index.html?preview=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__spikeReady === true);

  run.browser = {
    version: browser.version(),
    userAgent: await page.evaluate(() => navigator.userAgent),
    gpu: await page.evaluate(() => window.spike.gpu),
  };
  log('chrome', run.browser.version, '|', run.browser.gpu.renderer);

  run.capabilities = await page.evaluate(() => window.spike.capabilityMatrix());
  log('capabilities', JSON.stringify(run.capabilities));

  run.smokeTest = await page.evaluate(() => window.spike.smokeTest());
  log('smoke test', JSON.stringify(run.smokeTest));

  // Determinism: the same t must hash the same before and after a long run.
  const probeTimes = [0, 1.234, 2, 4, 6.5, 7.999];
  const hashArgs = { width: 1280, height: 720, times: probeTimes };
  const hashBefore = await page.evaluate((a) => window.spike.hashFrames(a), hashArgs);
  log('hashed', hashBefore.length, 'frames before export');

  // Reference frames, one set per resolution, taken from the same renderer.
  if (!reuseRef) {
    for (const [width, height, fps, frames] of [
      [1280, 720, FPS, FRAMES],
      [1920, 1080, FPS, FRAMES],
      [960, 540, GIF_FPS, GIF_FRAMES],
    ]) {
      const prefix = `ref-${width}x${height}-${fps}fps`;
      const dir = path.join(OUT, prefix);
      await clearDir(dir);
      await page.evaluate(({ w, h }) => window.spike.setSize(w, h), { w: width, h: height });
      const t0 = Date.now();
      const info = await page.evaluate(
        ({ fps, seconds, prefix }) => window.spike.captureReferenceFrames({ fps, seconds, prefix }),
        { fps, seconds: SECONDS, prefix },
      );
      const files = (await fsp.readdir(dir)).filter((f) => f.endsWith('.png'));
      run.references.push({ prefix, width, height, fps, frames, files: files.length, ...info, wallMs: Date.now() - t0 });
      log(`reference ${prefix}: ${files.length} frames in ${Date.now() - t0} ms`);
    }
  } else {
    log('keeping existing reference frames');
  }

  // Stills at t=0 and t=8: the seam check needs to know the source closes exactly.
  run.stills = [];
  for (const [width, height] of [[1280, 720], [1920, 1080], [960, 540]]) {
    await page.evaluate(({ w, h }) => window.spike.setSize(w, h), { w: width, h: height });
    for (const t of [0, 8]) {
      const info = await page.evaluate(
        ({ t, name }) => window.spike.captureStill({ t, name }),
        { t, name: `stills-${width}x${height}/t${t}.png` },
      );
      run.stills.push({ ...info, dir: `stills-${width}x${height}` });
    }
  }
  log('captured', run.stills.length, 'stills for the seam check');

  // Video exports.
  for (const job of VIDEO_JOBS) {
    log('export', job.name);
    const t0 = Date.now();
    try {
      const stats = await page.evaluate((opts) => window.spike.exportVideo(opts), {
        format: job.format,
        width: job.width,
        height: job.height,
        fps: FPS,
        seconds: SECONDS,
        bitrate: job.bitrate,
        keyframeSeconds: 1,
        name: job.name,
      });
      const size = (await fsp.stat(path.join(OUT, job.name))).size;
      run.exports.push({ ...stats, name: job.name, fileBytes: size, wallMs: Date.now() - t0 });
      log(`  ${job.name}: ${size} bytes, encode ${stats.encodeMs} ms, total ${stats.totalMs} ms`);
    } catch (e) {
      run.exports.push({ name: job.name, format: job.format, width: job.width, height: job.height, error: String(e?.message ?? e) });
      log(`  FAILED ${job.name}: ${e?.message ?? e}`);
    }
  }

  // GIF exports (per-frame palette is the deliverable, global palette the comparison).
  for (const job of GIF_JOBS) {
    log('export', job.name);
    const t0 = Date.now();
    try {
      const stats = await page.evaluate((opts) => window.spike.exportGif(opts), {
        width: job.width,
        height: job.height,
        fps: job.fps,
        seconds: SECONDS,
        maxColors: 256,
        paletteMode: job.paletteMode,
        name: job.name,
      });
      const size = (await fsp.stat(path.join(OUT, job.name))).size;
      run.exports.push({ ...stats, name: job.name, fileBytes: size, wallMs: Date.now() - t0 });
      log(`  ${job.name}: ${size} bytes, total ${stats.totalMs} ms`);
    } catch (e) {
      run.exports.push({ name: job.name, format: 'gif', paletteMode: job.paletteMode, error: String(e?.message ?? e) });
      log(`  FAILED ${job.name}: ${e?.message ?? e}`);
    }
  }

  const hashAfter = await page.evaluate((a) => window.spike.hashFrames(a), hashArgs);
  run.determinism = {
    times: probeTimes,
    before: hashBefore,
    after: hashAfter,
    identical: JSON.stringify(hashBefore) === JSON.stringify(hashAfter),
    uniqueHashes: new Set(hashBefore.map((h) => h.hash)).size,
  };
  log('determinism', run.determinism.identical ? 'identical' : 'DRIFTED', '|', run.determinism.uniqueHashes, 'distinct frames');
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  log('browser closed, server stopped');
}

run.finishedAt = new Date().toISOString();
await fsp.writeFile(path.join(OUT, 'run.json'), JSON.stringify(run, null, 2));
log('wrote', path.join(OUT, 'run.json'));
