import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from '../../tools/visual-qa/node_modules/playwright-core/index.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = path.join(root, 'test/results');
await mkdir(out, { recursive: true });
let server, browser;
const result = { cpuThrottleRate: 4 };
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
  const cdp = await page.context().newCDPSession(page);
  const calibrate = () =>
    page.evaluate(async () => {
      const code = `onmessage=()=>{const start=performance.now();let sum=0;for(let i=0;i<5000000;i++)sum+=Math.sqrt(i%1024);postMessage({ms:performance.now()-start,sum})}`;
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      const worker = new Worker(url);
      const runs = [];
      for (let n = 0; n < 4; n++) {
        const mainStart = performance.now();
        let sum = 0;
        for (let i = 0; i < 5000000; i++) sum += Math.sqrt(i % 1024);
        const mainMs = performance.now() - mainStart;
        const result = await new Promise((resolve) => {
          worker.onmessage = (e) => resolve(e.data);
          worker.postMessage(null);
        });
        if (n) runs.push({ mainMs, workerMs: result.ms, sum });
      }
      worker.terminate();
      URL.revokeObjectURL(url);
      return runs;
    });
  result.calibrationNormal = await calibrate();
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  result.calibrationThrottled = await calibrate();
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
    const source = await decodeImage(SAMPLES[0].url),
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
  const proxy = async () =>
    page.evaluate(async () => {
      const { preprocess } = await import('/src/palette/preprocess.ts');
      const { decodeImage } = await import('/src/image.ts');
      const { SAMPLES } = await import('/src/samples.ts');
      const source = await decodeImage(SAMPLES[0].url);
      const original = new OffscreenCanvas(source.width, source.height);
      original.getContext('2d').putImageData(source, 0, 0);
      const canvas = new OffscreenCanvas(1732, 1155);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(original, 0, 0, canvas.width, canvas.height);
      const input = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const runs = [];
      for (let i = 0; i < 3; i++) {
        const start = performance.now();
        const data = preprocess(input.data, canvas.width, canvas.height);
        runs.push({ ...data.metadata.timing, wallMs: performance.now() - start });
      }
      return { size: [canvas.width, canvas.height], runs };
    });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  result.mainThreadAlgorithmNormal = await proxy();
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  result.mainThreadAlgorithmThrottled = await proxy();
  result.workerThrottleLimitation =
    'CDP Emulation throttles the page, not workers. Calibration confirms this. Main-thread proxy runs the identical preprocessing function under verified 4x throttling; it is not a measured throttled Worker.';
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  await server?.close();
  await writeFile(
    path.join(root, 'reports/M4-performance.json'),
    `${JSON.stringify(result, null, 2)}\n`,
  );
}
