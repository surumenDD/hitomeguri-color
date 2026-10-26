import { createServer } from 'vite';
import { chromium } from '../../tools/visual-qa/node_modules/playwright-core/index.mjs';

const server = await createServer({
  root: new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'),
  server: { host: '127.0.0.1', port: 0 },
  logLevel: 'error',
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log(e.message));
  await page.goto(`${server.resolvedUrls.local[0]}test/engine.html`);
  await page.waitForFunction(() => window.engine);
  for (const id of ['canal', 'snow', 'lighthouse', 'oasis', 'flat']) {
    console.log('LOAD', id, await page.evaluate((id) => window.engine.load(id), id));
    console.log('PARITY', await page.evaluate(() => window.engine.parity()));
    console.log('ESTIMATES', JSON.stringify(await page.evaluate(() => window.engine.estimates())));
  }
} finally {
  await browser?.close();
  await server.close();
}
