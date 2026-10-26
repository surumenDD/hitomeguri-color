// Renders the share images and the icon PNGs from share.html and icon.html.
// Usage: node experiments/brand/shot.mjs
import {chromium} from '../../tools/visual-qa/node_modules/playwright-core/index.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from '../role-script-spike/server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const server = createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/experiments/brand/`;
const browser = await chromium.launch({channel: 'chrome'});
try {
  // 1280x640 PNG is the GitHub social preview (under 1 MB); 1200x630 JPEG is the page's og:image.
  for (const [width, height, type] of [[1280, 640, 'png'], [1200, 630, 'jpeg']]) {
    const page = await browser.newPage({viewport: {width, height}});
    await page.goto(base + 'share.html');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    const file = `share-${width}x${height}.${type === 'png' ? 'png' : 'jpg'}`;
    await page.screenshot({path: path.join(here, file), type, ...(type === 'jpeg' ? {quality: 88} : {})});
    await page.close();
  }
  for (const size of [32, 180, 512]) {
    const page = await browser.newPage({viewport: {width: size, height: size}});
    await page.goto(base + 'icon.html');
    await page.screenshot({path: path.join(here, `favicon-${size}.png`), omitBackground: true});
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log('rendered share images and favicons');
