// Exports one day of each picture as a 960x640 MP4 with the app's exporter, for the README loop.
// Usage: node test/showcase-render.mjs <outDir> <name>=<sample id | image path>:<preset> ...
// An image path is copied under test/results/showcase-src/ so Vite can serve it.
import { existsSync } from 'node:fs';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from '../../tools/visual-qa/node_modules/playwright-core/index.mjs';

const [out, ...jobs] = process.argv.slice(2);
const root = fileURLToPath(new URL('..', import.meta.url));
const sources = path.join(root, 'test/results/showcase-src');
await mkdir(out, { recursive: true });
await mkdir(sources, { recursive: true });
const server = await createServer({
  root,
  base: '/',
  server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
  logLevel: 'error',
});
await server.listen();
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage();
  await page.goto(`${server.resolvedUrls.local[0]}test/showcase-engine.html`);
  await page.waitForFunction(() => window.showcase);
  for (const job of jobs) {
    const [name, spec] = job.split('=');
    const split = spec.lastIndexOf(':');
    let source = spec.slice(0, split);
    const preset = spec.slice(split + 1);
    if (existsSync(source)) {
      await copyFile(source, path.join(sources, path.basename(source)));
      source = `/test/results/showcase-src/${path.basename(source)}`;
    }
    await page.evaluate((s) => window.showcase.load(s), source);
    const video = await page.evaluate(
      (p) => window.showcase.video(p, { width: 960, height: 640 }),
      preset,
    );
    await writeFile(path.join(out, `${name}.mp4`), Buffer.from(video.base64, 'base64'));
    console.log(name, preset, video.frames, 'frames');
  }
} finally {
  await browser.close();
  await server.close();
}
