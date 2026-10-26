import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from '../../tools/visual-qa/node_modules/playwright-core/index.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const oldFragment = await readFile(
  new URL('./fixtures/highlight-linear.glsl', import.meta.url),
  'utf8',
);
let server, browser;
try {
  server = await createServer({
    root,
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    logLevel: 'error',
  });
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome' });
  const versions = {};
  for (const version of ['old', 'current']) {
    const page = await browser.newPage();
    if (version === 'old') {
      await page.route(
        (url) => url.pathname.endsWith('/src/render/fragment.glsl') && url.searchParams.has('raw'),
        (route) =>
          route.fulfill({
            contentType: 'application/javascript',
            body: `export default ${JSON.stringify(oldFragment)};`,
          }),
      );
    }
    await page.goto(`${server.resolvedUrls.local[0]}test/engine.html`);
    await page.waitForFunction(() => window.engine);
    await page.evaluate(() => window.engine.load('canal'));
    const frames = await page.evaluate(() => {
      const { data, roles } = window.engine.getScene(),
        { Renderer, rolePaletteAt, PRESETS } = window.engine;
      const c = document.createElement('canvas'),
        r = new Renderer(c);
      r.upload(data);
      r.size(600, 400);
      const q = rolePaletteAt(data.metadata.palette, roles, 3, PRESETS.day),
        selected = ['sky', 'light'].map(
          (role) =>
            roles
              .map((_, k) => k)
              .filter((k) => roles[k] === role)
              .sort((a, b) => data.metadata.counts[b] - data.metadata.counts[a])[0],
        );
      const rows = selected.map((k) => {
        r.draw(q);
        const none = c.toDataURL();
        r.draw(q, { selected: k });
        return { selected: k, none, highlight: c.toDataURL() };
      });
      r.dispose();
      return rows;
    });
    versions[version] = frames;
    await page.close();
  }
  const page = await browser.newPage();
  const jpeg = await page.evaluate(
    async ({ old, current }) => {
      const c = document.createElement('canvas');
      c.width = 1800;
      c.height = 872;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#181818';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.font = '20px "Yu Gothic",sans-serif';
      ctx.textBaseline = 'middle';
      for (let row = 0; row < 2; row++)
        for (let col = 0; col < 3; col++) {
          const image = new Image();
          image.src =
            col === 0 ? old[row].none : col === 1 ? old[row].highlight : current[row].highlight;
          await image.decode();
          const x = col * 600,
            y = row * 436;
          ctx.fillStyle = '#ececec';
          ctx.fillText(
            `${['選択なし', '旧（線形の光 × 0.35）', '新（L × 0.6・C × 0.25）'][col]}・${row === 0 ? '空' : '灯り'}`,
            x + 12,
            y + 18,
          );
          ctx.drawImage(image, x, y + 36);
        }
      return c.toDataURL('image/jpeg', 0.94);
    },
    { old: versions.old, current: versions.current },
  );
  await writeFile(
    path.join(root, 'reports/highlight-compare.jpg'),
    Buffer.from(jpeg.split(',')[1], 'base64'),
  );
  console.log(
    'reports/highlight-compare.jpg',
    versions.current.map((f) => f.selected),
  );
} finally {
  await browser?.close();
  await server?.close();
}
