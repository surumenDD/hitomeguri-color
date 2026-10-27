import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from '../../tools/visual-qa/node_modules/playwright-core/index.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = path.join(root, 'test/results');
await mkdir(out, { recursive: true });
let server, browser;
const result = {};
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
  result.render = await page.evaluate(async () => {
    const { Renderer, rolePaletteAt, PRESETS, getScene } = window.engine,
      scene = getScene(),
      renderer = new Renderer(document.createElement('canvas'));
    renderer.upload(scene.data);
    renderer.size(1920, 1080);
    const gl = renderer.gl,
      ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'),
      queries = [],
      wall = [],
      pixel = new Uint8Array(4);
    for (let i = 0; i < 12; i++)
      renderer.draw(rolePaletteAt(scene.data.metadata.palette, scene.roles, i, PRESETS.day));
    gl.finish();
    for (let i = 0; i < 31; i++) {
      const q = ext ? gl.createQuery() : null;
      const now = performance.now();
      if (q) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      renderer.draw(rolePaletteAt(scene.data.metadata.palette, scene.roles, i % 24, PRESETS.day));
      if (q) {
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        queries.push(q);
      }
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      wall.push(performance.now() - now);
      await new Promise((r) => setTimeout(r, 0));
    }
    let gpu = [];
    if (ext) {
      while (!queries.every((q) => gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)))
        await new Promise((r) => setTimeout(r, 10));
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT))
        gpu = queries.map((q) => gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
      queries.forEach((q) => {
        gl.deleteQuery(q);
      });
    }
    const gaps = [];
    await new Promise((resolve) => {
      let previous;
      function frame(now) {
        if (previous) gaps.push(now - previous);
        previous = now;
        renderer.draw(
          rolePaletteAt(scene.data.metadata.palette, scene.roles, (now / 1000) % 24, PRESETS.day),
        );
        if (gaps.length < 120) requestAnimationFrame(frame);
        else resolve();
      }
      requestAnimationFrame(frame);
    });
    renderer.dispose();
    const sorted = (a) => [...a].sort((a, b) => a - b);
    return {
      size: [1920, 1080],
      gpuMedianMs: gpu.length ? sorted(gpu)[15] : null,
      wallMedianMs: sorted(wall)[15],
      rafMedianMs: sorted(gaps)[60],
      rafP95Ms: sorted(gaps)[114],
      rafMaxMs: Math.max(...gaps),
    };
  });
  result.preprocess = await page.evaluate(async () => {
    const { decodeImage } = await import('/src/image.ts'),
      { SAMPLES } = await import('/src/samples.ts'),
      { preprocessInWorker } = await import('/src/palette/client.ts');
    const source = await decodeImage(SAMPLES.find((s) => s.id === 'canal').url),
      a = new OffscreenCanvas(source.width, source.height);
    a.getContext('2d').putImageData(source, 0, 0);
    const b = new OffscreenCanvas(1732, 1155),
      ctx = b.getContext('2d');
    ctx.drawImage(a, 0, 0, b.width, b.height);
    const runs = [];
    for (let i = 0; i < 3; i++) {
      const start = performance.now(),
        data = await preprocessInWorker(ctx.getImageData(0, 0, b.width, b.height));
      runs.push({ ...data.metadata.timing, wallMs: performance.now() - start });
    }
    return { size: [b.width, b.height], runs };
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  await server?.close();
  await writeFile(path.join(out, 'performance-m2.json'), `${JSON.stringify(result, null, 2)}\n`);
}
