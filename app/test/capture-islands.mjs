import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from '../../tools/visual-qa/node_modules/playwright-core/index.mjs';

const root = fileURLToPath(new URL('..', import.meta.url)),
  out = path.join(root, 'reports');
await mkdir(out, { recursive: true });
let server, browser;
const report = {};
try {
  server = await createServer({
    root,
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    logLevel: 'error',
  });
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  await page.goto(`${server.resolvedUrls.local[0]}test/engine.html`);
  await page.waitForFunction(() => window.engine);
  for (const id of ['oasis', 'flat']) {
    await page.evaluate((id) => window.engine.load(id), id);
    const result = await page.evaluate(async (id) => {
      const { Renderer, getScene, rolePaletteAt, PRESETS } = window.engine,
        { MOMENTS } = await import('/src/script/index.ts'),
        { splitIsland, materializeIslands } = await import('/src/palette/islands.ts');
      const source = getScene();
      let { data, islands } = source;
      if (id === 'flat') {
        islands = splitIsland(
          islands,
          0,
          { kind: 'line', bounds: [0, 0.5, 1, 1], invert: false, feather: 3 },
          'water',
        );
        data = materializeIslands(source.base, islands);
      }
      const roles = islands.map((i) => i.role),
        canvas = document.createElement('canvas'),
        renderer = new Renderer(canvas),
        sheet = document.createElement('canvas');
      sheet.width = 1600;
      sheet.height = 700;
      const ctx = sheet.getContext('2d');
      ctx.fillStyle = '#181818';
      ctx.fillRect(0, 0, 1600, 700);
      ctx.fillStyle = '#ECECEC';
      ctx.font = '20px sans-serif';
      ctx.fillText(
        id === 'oasis' ? 'オアシス / テントを矩形で分離' : '港町 / 色1を上:空・下:水に分離',
        12,
        28,
      );
      renderer.upload(data);
      const diagnostics = [];
      for (const [index, [seconds, label]] of MOMENTS.entries()) {
        const q = rolePaletteAt(data.metadata.palette, roles, seconds, PRESETS.day);
        renderer.size(960, 640);
        renderer.draw(q);
        const x = (index % 4) * 400,
          y = 40 + Math.floor(index / 4) * 330;
        ctx.fillStyle = '#ECECEC';
        ctx.fillText(`${seconds.toFixed(1)}秒 / ${label}`, x + 8, y + 25);
        ctx.drawImage(canvas, x, y + 40, 400, (400 * 2) / 3);
        renderer.size(data.metadata.width, data.metadata.height);
        renderer.draw(q, { diagnostic: true });
        const pixels = renderer.read();
        let count = 0;
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i]) count++;
        diagnostics.push({ seconds, clampedPixels: count });
      }
      let maxSumError = 0,
        outsideRegionWeight = 0;
      for (let i = 0; i < data.metadata.width * data.metadata.height; i++) {
        let sum = 0;
        for (let k = 0; k < islands.length; k++) {
          const w = data.weights[Math.floor(k / 4)][i * 4 + (k % 4)];
          sum += w;
          const gate = islands[k].gates.at(-1);
          if (id === 'oasis' && gate?.kind === 'rect' && !gate.invert) {
            const x = ((i % data.metadata.width) + 0.5) / data.metadata.width,
              y = (Math.floor(i / data.metadata.width) + 0.5) / data.metadata.height;
            if (x > 0.4 || y > 0.62 || y < 0.4)
              outsideRegionWeight = Math.max(outsideRegionWeight, w);
          }
        }
        maxSumError = Math.max(maxSumError, Math.abs(sum - 1));
      }
      renderer.dispose();
      return {
        jpeg: sheet.toDataURL('image/jpeg', 0.9),
        diagnostics,
        islands,
        maxSumError,
        outsideRegionWeight,
      };
    }, id);
    await writeFile(
      path.join(out, `M2-${id}-eight-times.jpg`),
      Buffer.from(result.jpeg.split(',')[1], 'base64'),
    );
    delete result.jpeg;
    report[id] = result;
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await server?.close();
  await writeFile(path.join(out, 'M2-islands.json'), `${JSON.stringify(report, null, 2)}\n`);
}
