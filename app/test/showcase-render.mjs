// Exports one day of each picture as an MP4 with the app's exporter, for the README loop.
// Usage: node test/showcase-render.mjs [--size=<width>x<height>] <outDir> <name>=<sample id | image path>:<preset>[@<island>=<role>,...][#foreground=<image path>&x=0.68&y=1&size=0.7&blend=0.8] ...
// --size defaults to 960x640; the exporter takes even sizes up to 1920 on the long edge.
// The optional @ list overrides the automatic role of an island (by palette index).
// The optional # suffix adds a cut-out foreground over the moving background. x and y are its
// bottom-centre in picture coordinates (x 0..1, y 0.2..1+size/2), size is 0.2..1.2 of the picture
// height and blend is 0..1. Everything after # is URLSearchParams-style.
// An image path is copied under test/results/showcase-src/ so Vite can serve it. A foreground is
// copied with a foreground-<pid>-<job>- prefix, so it cannot collide with a background of the same
// name or with a foreground from a parallel run.
import { existsSync } from 'node:fs';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from '../../tools/visual-qa/node_modules/playwright-core/index.mjs';

const args = process.argv.slice(2);
const sizeArg = args.find((a) => a.startsWith('--size='));
const [width, height] = (sizeArg?.slice('--size='.length) ?? '960x640').split('x').map(Number);
const [out, ...jobs] = args.filter((a) => a !== sizeArg);
const root = fileURLToPath(new URL('..', import.meta.url));
const sources = path.join(root, 'test/results/showcase-src');
await mkdir(out, { recursive: true });
await mkdir(sources, { recursive: true });

/** The local file behind an image reference, resolved for relative, POSIX and Windows paths. */
function localImage(reference) {
  for (const candidate of [path.resolve(reference), reference])
    if (existsSync(candidate)) return candidate;
  return undefined;
}

function foregroundNumber(key, raw, name) {
  if (raw === null || raw.trim() === '')
    throw new Error(`${name}: #${key}= needs a number in the foreground suffix.`);
  const value = Number(raw);
  if (!Number.isFinite(value))
    throw new Error(`${name}: #${key}= must be a finite number in the foreground suffix.`);
  return value;
}

/** Parses #foreground=<path>&x=...&y=...&size=...&blend=... after the whole existing spec. */
function parseForeground(fragment, name) {
  if (fragment === undefined) return undefined;
  const params = new URLSearchParams(fragment);
  const source = params.get('foreground');
  if (!source) throw new Error(`${name}: #foreground=<image path> is required.`);
  const options = { source };
  for (const key of ['x', 'y', 'size', 'blend']) {
    const raw = params.get(key);
    if (raw !== null) options[key] = foregroundNumber(key, raw, name);
  }
  if (options.size !== undefined && (options.size < 0.2 || options.size > 1.2))
    throw new Error(`${name}: foreground size must be between 0.2 and 1.2.`);
  if (options.blend !== undefined && (options.blend < 0 || options.blend > 1))
    throw new Error(`${name}: foreground blend must be between 0 and 1.`);
  if (options.x !== undefined && (options.x < 0 || options.x > 1))
    throw new Error(`${name}: foreground x must be between 0 and 1.`);
  const size = options.size ?? 0.7;
  if (options.y !== undefined && (options.y < 0.2 || options.y > 1 + size * 0.5))
    throw new Error(`${name}: foreground y must be between 0.2 and 1 + size / 2.`);
  return options;
}

/** Copies a foreground next to the sources under a prefix unique to its job. */
async function copyForeground(reference, index, name) {
  const local = localImage(reference);
  if (!local) throw new Error(`${name}: foreground image not found: ${reference}`);
  const file = `foreground-${process.pid}-${index}-${path.basename(local)}`;
  await copyFile(local, path.join(sources, file));
  return `/test/results/showcase-src/${encodeURIComponent(file)}`;
}

const server = await createServer({
  root,
  base: '/',
  // Images are copied into test/results/ while the server runs; on Windows, watching a file that
  // is still being written fails with EBUSY, so that folder is left unwatched.
  server: {
    host: '127.0.0.1',
    port: 0,
    hmr: false,
    watch: { ignored: ['**/test/results/**'] },
  },
  logLevel: 'error',
});
await server.listen();
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage();
  await page.goto(`${server.resolvedUrls.local[0]}test/showcase-engine.html`);
  await page.waitForFunction(() => window.showcase);
  for (const [index, job] of jobs.entries()) {
    const equals = job.indexOf('=');
    if (equals < 0) throw new Error(`Showcase job needs <name>=<spec>: ${job}`);
    const name = job.slice(0, equals);
    let spec = job.slice(equals + 1);
    // Split # first: a foreground path may contain colons (C:\...) and commas that the existing
    // source:preset@roles parsing must not see.
    const hash = spec.indexOf('#');
    const fragment = hash < 0 ? undefined : spec.slice(hash + 1);
    if (hash >= 0) spec = spec.slice(0, hash);
    const foregroundOptions = parseForeground(fragment, name);
    const split = spec.lastIndexOf(':');
    let source = spec.slice(0, split);
    const [preset, roleList = ''] = spec.slice(split + 1).split('@');
    const overrides = Object.fromEntries(
      roleList
        .split(',')
        .filter(Boolean)
        .map((x) => x.split('=')),
    );
    const localSource = localImage(source);
    if (localSource) {
      await copyFile(localSource, path.join(sources, path.basename(localSource)));
      source = `/test/results/showcase-src/${path.basename(localSource)}`;
    }
    if (foregroundOptions) {
      foregroundOptions.source = await copyForeground(foregroundOptions.source, index, name);
      await page.evaluate(
        ([s, o, f]) => window.showcase.load(s, o, f),
        [source, overrides, foregroundOptions],
      );
    } else await page.evaluate(([s, o]) => window.showcase.load(s, o), [source, overrides]);
    const video = await page.evaluate(
      ([p, w, h]) => window.showcase.video(p, { width: w, height: h }),
      [preset, width, height],
    );
    await writeFile(path.join(out, `${name}.mp4`), Buffer.from(video.base64, 'base64'));
    console.log(name, preset, video.frames, 'frames');
  }
} finally {
  await browser.close();
  await server.close();
}
