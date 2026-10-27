// Rebuild only the two new scenes. Full pictures: Pillow; thumbnails: the app's actual renderer.
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createServer } from 'vite';
import { chromium } from '../../tools/visual-qa/node_modules/playwright-core/index.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = path.join(root, 'test/results/v02s');
await mkdir(out, { recursive: true });
const converted = await promisify(execFile)('python', ['-X', 'utf8', 'test/v02s-convert.py'], {
  cwd: root,
  windowsHide: true,
});
const report = JSON.parse(converted.stdout);
const server = await createServer({
  root,
  base: '/',
  server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
  logLevel: 'error',
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  await page.goto(`${server.resolvedUrls.local[0]}test/v02-engine.html`);
  await page.waitForFunction(() => window.foregroundTest);
  report.thumbnails = [];
  for (const [id, person, settings] of [
    ['festival', 'girl-yukata', { x: 0.5, y: 1.26, size: 1.05, blend: 0.8 }],
    ['seaside', 'girl', { x: 0.76, y: 1.6, size: 1.2, blend: 0.8 }],
  ]) {
    await page.evaluate(
      ([id, person, settings]) =>
        window.foregroundTest.load(
          `/src/assets/samples/${id}.webp`,
          `/src/assets/samples/${person}.webp`,
          settings.x,
          settings,
        ),
      [id, person, settings],
    );
    const png = path.join(out, `${id}-thumb.png`);
    const base64 = await page.evaluate(() => window.foregroundTest.thumbnail());
    await writeFile(png, Buffer.from(base64, 'base64'));
    const destination = path.join(root, `src/assets/samples/thumbs/${id}.webp`);
    await promisify(execFile)(
      'python',
      [
        '-X',
        'utf8',
        '-c',
        'from PIL import Image; import sys; Image.open(sys.argv[1]).save(sys.argv[2], "WEBP", lossless=True, method=6)',
        png,
        destination,
      ],
      { windowsHide: true },
    );
    report.thumbnails.push({ id, settings, size: [96, 64], preset: 'day', seconds: 0 });
  }
  await writeFile(path.join(out, 'assets.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
