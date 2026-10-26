import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createServer } from 'vite';
import { chromium } from '../../tools/visual-qa/node_modules/playwright-core/index.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = fileURLToPath(new URL('../reports/showcase/', import.meta.url));
await mkdir(out, { recursive: true });
const command = promisify(execFile);
const report = { image: 'canal', preset: 'day', durationSec: 24, nightDepth: 2.1, glow: 1.3 };
let server, browser;
try {
  server = await createServer({
    root,
    base: '/',
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    logLevel: 'error',
  });
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  await page.goto(`${server.resolvedUrls.local[0]}test/engine.html`);
  await page.waitForFunction(() => window.engine);
  await page.evaluate(() => window.engine.load('canal'));
  const output = await page.evaluate(() =>
    window.engine.video('day', {}, { width: 1280, height: 854 }),
  );
  await writeFile(`${out}/hitomeguri-canal-day.mp4`, Buffer.from(output.base64, 'base64'));
  report.mp4 = {
    width: output.width,
    height: output.height,
    frames: output.frames,
    bytes: (await stat(`${out}/hitomeguri-canal-day.mp4`)).size,
    app: output.report,
    estimate: output.estimate,
  };
  await browser.close();
  browser = undefined;
  await server.close();
  server = undefined;
  for (const fps of [20, 12]) {
    const destination = `${root}/test/results/m4-showcase-${fps}fps.gif`;
    await command(
      'ffmpeg',
      [
        '-v',
        'error',
        '-y',
        '-i',
        `${out}/hitomeguri-canal-day.mp4`,
        '-filter_complex',
        `fps=${fps},crop=iw:iw/1.6:0:(ih-iw/1.6)/2,scale=800:500:flags=lanczos,split[a][b];[a]palettegen=stats_mode=single:max_colors=256[p];[b][p]paletteuse=new=1:dither=sierra2_4a`,
        '-loop',
        '0',
        destination,
      ],
      { windowsHide: true, maxBuffer: 1024 * 1024 },
    );
    const bytes = (await stat(destination)).size;
    report[`gif${fps}`] = {
      file: `hitomeguri-canal-day-${fps}fps.gif`,
      width: 800,
      height: 500,
      fps,
      bytes,
      palettePerFrame: true,
    };
    if (bytes <= 5_000_000) break;
  }
  report.selectedGifFPS = report.gif12 ? 12 : 20;
  await copyFile(
    `${root}/test/results/m4-showcase-${report.selectedGifFPS}fps.gif`,
    `${out}/hitomeguri-canal-day-${report.selectedGifFPS}fps.gif`,
  );
  const probe = await command(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=codec_name,width,height,nb_frames,duration',
      '-of',
      'json',
      `${out}/hitomeguri-canal-day.mp4`,
    ],
    { windowsHide: true },
  );
  report.ffprobe = JSON.parse(probe.stdout);
  assert.equal(Number(report.ffprobe.streams[0].nb_frames), 720);
  assert.equal(Number(report.ffprobe.streams[0].duration), 24);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await server?.close();
  await writeFile(`${out}/metrics.json`, `${JSON.stringify(report, null, 2)}\n`);
}
