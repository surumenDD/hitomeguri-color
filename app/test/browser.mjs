import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { createServer } from 'vite';
import {
  chromium,
  firefox,
  webkit,
} from '../../tools/visual-qa/node_modules/playwright-core/index.mjs';

const root = fileURLToPath(new URL('..', import.meta.url)),
  out = path.join(root, 'test/results');
await mkdir(out, { recursive: true });
const report = { when: new Date().toISOString(), samples: [], errors: [], externalRequests: [] };
let server, browser;

// Read PNG scanlines directly; a canvas round-trip would conceal translucent RGB changes.
function pngPixels(base64) {
  const png = Buffer.from(base64, 'base64');
  const chunks = [];
  let width, height, channels;
  for (let at = 8; at < png.length; ) {
    const size = png.readUInt32BE(at);
    const type = png.toString('ascii', at + 4, at + 8);
    const data = png.subarray(at + 8, at + 8 + size);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, '8-bit PNG');
      assert.ok([2, 6].includes(data[9]), 'RGB/RGBA PNG');
      assert.equal(data[12], 0, 'non-interlaced PNG');
      channels = data[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') chunks.push(data);
    at += size + 12;
  }
  const encoded = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = encoded[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x;
      const a = x >= channels ? raw[at - channels] : 0;
      const b = y ? raw[at - stride] : 0;
      const c = y && x >= channels ? raw[at - stride - channels] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a),
        pb = Math.abs(p - b),
        pc = Math.abs(p - c);
      const predictor = [
        0,
        a,
        b,
        Math.floor((a + b) / 2),
        pa <= pb && pa <= pc ? a : pb <= pc ? b : c,
      ][filter];
      assert.notEqual(predictor, undefined, 'PNG row filter');
      raw[at] = encoded[y * (stride + 1) + 1 + x] + predictor;
    }
  }
  const rgba = Buffer.alloc(width * height * 4, 255);
  for (let i = 0; i < width * height; i++) raw.copy(rgba, i * 4, i * channels, (i + 1) * channels);
  return rgba;
}

async function pngExportChecks(page, alphaOnly = false, webkitAlpha = false) {
  const workers = [];
  const observe = (worker) => workers.push(worker.url());
  page.on('worker', observe);
  const result = await page.evaluate(async (alphaOnly) => {
    const { exportPng } = await import('/src/export/video.ts');
    const { Renderer } = await import('/src/render/index.ts');
    const { decodeImage } = await import('/src/image.ts');
    const { preprocessInWorker } = await import('/src/palette/client.ts');
    const { DAYLIGHT, inferRoles, rolePaletteAt } = await import('/src/script/index.ts');
    const { foregroundLight, loadForeground } = await import('/src/foreground.ts');
    const { SAMPLES } = await import('/src/samples.ts');
    const base64 = async (blob) => {
      // Also exercise a real PNG decoder, including the new encoder's chunk checksums.
      const bitmap = await createImageBitmap(blob);
      bitmap.close();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    };
    const sample = SAMPLES.find((s) => s.id === 'seaside');
    const generated = (width, height, alpha) => {
      const rgba = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < rgba.length; i += 4) {
        rgba[i] = (i * 13 + 17) % 256;
        rgba[i + 1] = (Math.floor(i / (width * 4)) * 7 + 51) % 256;
        rgba[i + 2] = (i * 3 + 122) % 256;
        rgba[i + 3] = alpha ? (i / 4) % 256 : 255;
      }
      return new ImageData(rgba, width, height);
    };
    const cases = [
      ...(alphaOnly
        ? [{ name: 'opaque-64x48', pixels: generated(64, 48, false) }]
        : [
            {
              name: 'seaside-with-person',
              pixels: await decodeImage(sample.url),
              foreground: {
                ...sample.foreground,
                data: await loadForeground(sample.foreground.url),
              },
            },
            { name: 'generated-2048x1536', pixels: generated(2048, 1536, false) },
          ]),
      { name: 'translucent-64x48', pixels: generated(64, 48, true) },
    ];
    const rows = [];
    for (const { name, pixels, foreground } of cases) {
      const data = await preprocessInWorker(pixels);
      const roles = inferRoles(data.metadata).map((i) => i.role);
      const seconds = 13.25;
      // Frozen pre-worker exportPng: a fresh Renderer followed by HTMLCanvasElement.toBlob.
      const canvas = document.createElement('canvas');
      const renderer = new Renderer(canvas);
      try {
        renderer.upload(data);
        renderer.uploadForeground(foreground?.data);
        renderer.size(data.metadata.width, data.metadata.height);
        const palette = rolePaletteAt(data.metadata.palette, roles, seconds, DAYLIGHT);
        renderer.draw(palette, {
          foreground: foreground && {
            ...foreground,
            light: foregroundLight(data.metadata, roles, palette),
          },
        });
        const before = await base64(
          await new Promise((resolve) => canvas.toBlob(resolve, 'image/png')),
        );
        const after = await base64(
          await exportPng(data, roles, DAYLIGHT, seconds, foreground, renderer),
        );
        rows.push({
          name,
          before,
          after,
          raw: name.startsWith('translucent') ? Array.from(renderer.read()) : undefined,
        });
        if (name.startsWith('translucent')) {
          const compression = window.CompressionStream;
          const Worker = window.Worker;
          try {
            window.CompressionStream = undefined;
            rows.push({
              name: 'no-CompressionStream',
              before,
              after: await base64(
                await exportPng(data, roles, DAYLIGHT, seconds, foreground, renderer),
              ),
            });
            window.CompressionStream = compression;
            window.Worker = class {
              postMessage() {
                setTimeout(() => this.onmessage({ data: {} }), 0);
              }
              terminate() {}
            };
            rows.push({
              name: 'worker-failure',
              before,
              after: await base64(
                await exportPng(data, roles, DAYLIGHT, seconds, foreground, renderer),
              ),
            });
          } finally {
            window.CompressionStream = compression;
            window.Worker = Worker;
          }
        }
      } finally {
        renderer.dispose();
      }
    }
    return rows;
  }, alphaOnly);
  page.off('worker', observe);
  assert.ok(
    workers.some((url) => url.includes('png.worker')),
    'PNG worker was not started',
  );
  for (const row of result) {
    const before = pngPixels(row.before),
      after = pngPixels(row.after);
    row.before = createHash('sha256').update(before).digest('hex');
    row.after = createHash('sha256').update(after).digest('hex');
    if (webkitAlpha && row.raw) {
      const raw = Buffer.from(row.raw);
      row.renderer = createHash('sha256').update(raw).digest('hex');
      row.opaquePixelsChecked = 0;
      row.beforeError = row.afterError = 0;
      for (let i = 0; i < raw.length; i++) {
        row.beforeError += Math.abs(before[i] - raw[i]);
        row.afterError += Math.abs(after[i] - raw[i]);
        if (raw[i - (i % 4) + 3] === 255) {
          assert.equal(after[i], before[i], `WebKit opaque byte ${i}`);
          if (i % 4 === 3) row.opaquePixelsChecked++;
        }
      }
      assert.ok(row.opaquePixelsChecked > 0);
      assert.ok(
        row.afterError <= row.beforeError,
        'WebKit PNG must be at least as close to readPixels',
      );
      assert.equal(row.after, row.renderer, 'WebKit PNG must preserve exact readPixels bytes');
    } else assert.equal(row.after, row.before, `${row.name}: PNG pixel hash`);
    delete row.raw;
  }
  console.log(
    `PNG export: ${result.length} pixel checks passed (native equality, fallback,${webkitAlpha ? ' WebKit readPixels equality,' : ''} translucent pixels).`,
  );
  return result;
}

async function imageDecodingChecks(page) {
  const samples = (await readdir(path.join(root, 'src/assets/samples')))
    .filter((name) => name.endsWith('.webp'))
    .sort();
  const result = await page.evaluate(async (samples) => {
    const { decodeImage } = await import('/src/image.ts');
    // Frozen canvas path from before asynchronous resizing: compare real browser pixels.
    const reference = async (source) => {
      const image = new Image();
      image.src = source;
      await image.decode();
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const ctx = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      return ctx.getImageData(0, 0, canvas.width, canvas.height);
    };
    const hash = async (pixels) =>
      Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', pixels.data)))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
    const fixture = (width, height, alpha = false) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      const gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, '#5195bb');
      gradient.addColorStop(0.48, '#e3ac78');
      gradient.addColorStop(0.5, '#346779');
      gradient.addColorStop(1, '#213b61');
      ctx.globalAlpha = alpha ? 0.45 : 1;
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#bf5d50';
      ctx.fillRect(width * 0.34, height * 0.25, width * 0.15, height * 0.45);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      for (let x = 19; x < width; x += 37) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + 30, height);
        ctx.stroke();
      }
      if (alpha) ctx.clearRect(0, 0, width * 0.2, height);
      return canvas;
    };
    const unchanged = [];
    const sources = samples.map((name) => [name, `/src/assets/samples/${name}`]);
    const opaque = fixture(2048, 1536);
    sources.push(['edge-2048.png', opaque.toDataURL('image/png')]);
    sources.push(['edge-2048.jpg', opaque.toDataURL('image/jpeg', 0.94)]);
    sources.push(['alpha-1024.png', fixture(1024, 768, true).toDataURL('image/png')]);
    for (const [name, source] of sources) {
      const before = await reference(source);
      const after = await decodeImage(source, { maxEdge: 2048, resize: true });
      unchanged.push({
        name,
        width: after.width,
        height: after.height,
        before: await hash(before),
        after: await hash(after),
        originalSize: after.originalSize,
      });
    }
    const source = fixture(8000, 6000).toDataURL('image/png');
    const before = await reference(source);
    const after = await decodeImage(source, { maxEdge: 2048, resize: true });
    let difference = 0;
    for (let i = 0; i < before.data.length; i += 4)
      for (let c = 0; c < 3; c++) difference += Math.abs(before.data[i + c] - after.data[i + c]);
    return {
      unchanged,
      resized: {
        width: after.width,
        height: after.height,
        originalSize: after.originalSize,
        meanAbsoluteRgbDifference: difference / (before.width * before.height * 3),
      },
    };
  }, samples);
  for (const row of result.unchanged) {
    assert.equal(row.after, row.before, `${row.name}: unchanged decode pixels`);
    assert.equal(row.originalSize, undefined, row.name);
  }
  assert.deepEqual([result.resized.width, result.resized.height], [2048, 1536]);
  assert.deepEqual(result.resized.originalSize, { width: 8000, height: 6000 });
  assert.ok(
    result.resized.meanAbsoluteRgbDifference <= 2,
    'high-quality resize RGB difference > 2',
  );
  console.log(
    `Image decoding: ${result.unchanged.length} exact SHA-256 matches, resize mean RGB difference ${result.resized.meanAbsoluteRgbDifference.toFixed(6)}.`,
  );
  return result;
}

async function tinyVideoExportChecks(page) {
  const rows = [];
  for (const edge of [1, 2, 16]) {
    const result = await page.evaluate(async (edge) => {
      const { exportVideo, videoExportSupport } = await import('/src/export/video.ts');
      const { preprocessInWorker } = await import('/src/palette/client.ts');
      const { Renderer } = await import('/src/render/index.ts');
      const { DAYLIGHT, inferRoles, rolePaletteAt } = await import('/src/script/index.ts');
      const pixels = new Uint8ClampedArray(edge * edge * 4);
      for (let y = 0; y < edge; y++)
        for (let x = 0; x < edge; x++) {
          const gray = (x + y) % 2 ? 160 : 64;
          pixels.set(
            edge === 1 ? [81, 149, 187, 255] : [gray, gray, gray, 255],
            (y * edge + x) * 4,
          );
        }
      const data = await preprocessInWorker(new ImageData(pixels, edge, edge));
      const roles = inferRoles(data.metadata).map((i) => i.role);
      const renderer = new Renderer(document.createElement('canvas'));
      let reference,
        nearestMaxError = 0;
      try {
        renderer.upload(data);
        const palette = rolePaletteAt(data.metadata.palette, roles, 0, DAYLIGHT);
        renderer.size(edge, edge);
        renderer.draw(palette);
        reference = renderer.read();
        renderer.size(512, 512);
        renderer.draw(palette, { contain: true });
        const enlarged = renderer.read();
        for (let y = 0; y < 512; y++)
          for (let x = 0; x < 512; x++)
            for (let c = 0; c < 4; c++)
              nearestMaxError = Math.max(
                nearestMaxError,
                Math.abs(
                  enlarged[(y * 512 + x) * 4 + c] -
                    reference[
                      (Math.floor((y * edge) / 512) * edge + Math.floor((x * edge) / 512)) * 4 + c
                    ],
                ),
              );
      } finally {
        renderer.dispose();
      }
      const start = performance.now();
      const output = await exportVideo(data, roles, DAYLIGHT);
      const elapsedMs = Math.round(performance.now() - start);
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(output.blob);
      });
      return {
        edge,
        support: await videoExportSupport(edge, edge),
        width: output.width,
        height: output.height,
        frames: output.frames,
        bytes: output.blob.size,
        elapsedMs,
        nearestMaxError,
        wcag: output.report.wcag.pass,
        itu: output.report.itu.pass,
        base64,
      };
    }, edge);
    const { base64, ...row } = result;
    await writeFile(path.join(out, `tiny-${edge}x${edge}.mp4`), Buffer.from(base64, 'base64'));
    assert.equal(row.support, 'supported');
    assert.deepEqual([row.width, row.height, row.frames], [512, 512, 720]);
    assert.equal(row.nearestMaxError, 0, 'exact nearest-neighbor grid before encoding');
    assert.ok(row.bytes > 0 && row.wcag && row.itu);
    rows.push(row);
    console.log(`Tiny video: ${JSON.stringify(row)}`);
  }
  return rows;
}

async function videoNoticeChecks(context, origin) {
  const rows = [];
  for (const missingApi of [false, true]) {
    const page = await context.newPage();
    try {
      await page.addInitScript((missing) => {
        if (missing) window.VideoEncoder = undefined;
        // Only this picture's size is refused; an ordinary 1280×720 still encodes.
        else
          VideoEncoder.isConfigSupported = async ({ width, height }) => ({
            supported: width === 1280 && height === 720,
          });
      }, missingApi);
      await page.goto(origin);
      await page.waitForFunction(() =>
        document.querySelector('.sr-only[role="status"]')?.textContent.includes('準備できました'),
      );
      const expected = missingApi
        ? 'このブラウザでは動画を書き出せません。Chrome・Edge・Firefox（デスクトップ）・Safari 16.4 以降で開いてください。静止画の保存はこのまま使えます。'
        : 'この絵の大きさでは動画を書き出せません。静止画の保存はこのまま使えます。';
      assert.equal(await page.locator('.actions [role="alert"]').textContent(), expected);
      assert.equal(
        await page.getByRole('button', { name: '動画を書き出す', exact: true }).isEnabled(),
        false,
      );
      assert.equal(
        await page.getByRole('button', { name: 'この瞬間を画像で保存', exact: true }).isEnabled(),
        true,
      );
      rows.push({ missingApi, guidance: expected, videoEnabled: false, pngEnabled: true });
    } finally {
      await page.close();
    }
  }
  console.log('Video notices: missing API and unsupported configuration use distinct guidance.');
  return rows;
}

try {
  server = await createServer({
    root,
    base: '/',
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    logLevel: 'error',
  });
  await server.listen();
  const origin = server.resolvedUrls.local[0].replace(/\/$/, '');
  browser = await chromium.launch({ channel: 'chrome' });
  report.browser = browser.version();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
    serviceWorkers: 'block',
    acceptDownloads: true,
  });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
    report.externalRequests.push(url.href);
    return route.abort();
  });
  context.on('page', (page) => page.on('pageerror', (e) => report.errors.push(e.message)));
  const harness = await context.newPage();
  await harness.goto(`${origin}/test/harness.html`);
  await harness.waitForFunction(() => window.harness);
  report.imageDecoding = await imageDecodingChecks(harness);
  report.pngExport = await pngExportChecks(harness);
  report.tinyVideoExport = await tinyVideoExportChecks(harness);
  report.videoNotices = await videoNoticeChecks(context, origin);
  report.pngExportCrossBrowser = {};
  for (const [name, launcher] of Object.entries({ firefox, webkit })) {
    const engine = await launcher.launch();
    try {
      const page = await engine.newPage();
      await page.goto(`${origin}/test/harness.html`);
      report.pngExportCrossBrowser[name] = await pngExportChecks(page, true, name === 'webkit');
    } finally {
      await engine.close();
    }
  }
  report.gpu = await harness.evaluate(() => window.harness.gpu);
  for (const id of [
    'canal',
    'snow',
    'lighthouse',
    'oasis',
    'flat',
    'painterly',
    'pixel',
    'photo',
  ]) {
    const result = await harness.evaluate((id) => window.harness.sampleTest(id), id);
    report.samples.push(result);
    assert.equal(result.identity.psnrDb, 'Infinity', id);
    if (result.lossless) assert.equal(result.lossless.psnrDb, 'Infinity', `${id}/lossless WebP`);
    for (const end of result.endpoints)
      assert.equal(end.psnrDb, 'Infinity', `${id}/${end.preset}/${end.seconds}`);
    console.log(`${id}: shader identity + 3 preset endpoints PSNR Infinity`);
  }
  report.alpha = await harness.evaluate(() => window.harness.alphaTest());
  report.lightnessFallback = await harness.evaluate(() => window.harness.fallbackTest());
  assert.equal(report.alpha.rgb.psnrDb, 'Infinity');
  assert.ok(report.alpha.alphaExact);
  assert.deepEqual(report.lightnessFallback, [
    { diagnostic: 255, rgba: [0, 0, 0, 255] },
    { diagnostic: 255, rgba: [255, 255, 255, 255] },
  ]);
  await harness.close();
  const ui = await context.newPage();
  await ui.goto(origin);
  const ready = () =>
    ui.waitForFunction(
      () => {
        const text = document.querySelector('.sr-only[role="status"]')?.textContent;
        return (
          text?.includes('準備できました') &&
          !text.includes('確かめ') &&
          !document.querySelector('.picture-skeleton')
        );
      },
      null,
      { timeout: 120000 },
    );
  const clock = ui.locator('.when span'),
    timeline = ui.getByRole('slider', { name: '1周の中の時刻', exact: true }),
    canvasData = () => ui.locator('canvas').evaluate((c) => c.toDataURL());
  await ready();
  assert.equal(await ui.title(), 'ひとめぐり');
  assert.equal(await ui.locator('.thumb').count(), 7);
  const first = await canvasData();
  await ui.waitForTimeout(300);
  assert.equal(await clock.textContent(), '0.0 / 24 秒');
  assert.equal(await canvasData(), first);
  report.noAutoplay = true;
  await ui.getByRole('button', { name: '再生', exact: true }).click();
  await ui.waitForFunction(
    () => parseFloat(document.querySelector('.when span').textContent) > 0.15,
  );
  await ui.getByRole('button', { name: '一時停止', exact: true }).click();
  const stopped = await clock.textContent();
  await ui.waitForTimeout(250);
  assert.equal(await clock.textContent(), stopped);
  report.playPause = true;
  await timeline.press('Home');
  await timeline.press('Shift+ArrowRight');
  assert.ok((await clock.textContent()).startsWith('1.0'));
  assert.ok(await timeline.getAttribute('aria-valuetext'));
  await timeline.press('End');
  assert.ok((await clock.textContent()).startsWith('24.0'));
  await timeline.press('Home');
  const box = await timeline.boundingBox();
  await ui.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  assert.ok(Math.abs(parseFloat(await clock.textContent()) - 12) < 0.2);
  report.timelineKeyboardPointer = true;
  await ui.getByRole('button', { name: '長い夕暮れ', exact: true }).click();
  await ready();
  assert.equal(
    await ui.getByRole('button', { name: '長い夕暮れ', exact: true }).getAttribute('aria-pressed'),
    'true',
  );
  await ui.getByRole('button', { name: '1日の光', exact: true }).click();
  await ready();
  for (const label of ['長さ', '夜の深さ', '灯りの強さ']) {
    const control = ui.getByRole('slider', { name: label, exact: true });
    assert.equal(Number(await control.inputValue()), 50);
    await control.fill('0');
    await control.dispatchEvent('change');
    await ready();
    await control.fill('50');
    await control.dispatchEvent('change');
    await ready();
    assert.ok(await control.getAttribute('aria-valuetext'));
  }
  report.presetSliderPositions = [];
  for (const [name, seconds] of [
    ['長い夕暮れ', 20],
    ['夜の灯り', 32],
    ['1日の光', 24],
  ]) {
    await ui.getByRole('button', { name, exact: true }).click();
    await ready();
    const positions = [];
    for (const label of ['長さ', '夜の深さ', '灯りの強さ']) {
      const control = ui.getByRole('slider', { name: label, exact: true });
      positions.push(Number(await control.inputValue()));
      assert.equal(
        Number(await control.inputValue()),
        50,
        `${name}/${label} must reset to its preset default`,
      );
      assert.equal(
        await control.getAttribute('aria-valuetext'),
        label === '長さ' ? `${seconds} 秒` : 'ふつう',
      );
      await control.fill('75');
      await control.dispatchEvent('change');
      await ready();
    }
    report.presetSliderPositions.push({ name, positions });
  }
  // Re-select the same preset too: edited coefficients must return to their defaults.
  await ui.getByRole('button', { name: '1日の光', exact: true }).click();
  await ready();
  for (const label of ['長さ', '夜の深さ', '灯りの強さ'])
    assert.equal(
      Number(await ui.getByRole('slider', { name: label, exact: true }).inputValue()),
      50,
    );
  report.presetsAndScales = true;
  console.log('Presets: day/longDusk/nightLights reset all three sliders to [50, 50, 50].');
  await ui.getByRole('button', { name: '港町', exact: true }).click();
  await ready();
  const originalCount = await ui.locator('.swatch').count();
  await ui.locator('.swatch').first().click();
  assert.equal(await ui.locator('.swatch').first().getAttribute('aria-pressed'), 'true');
  const role = ui.getByRole('combobox', { name: '役割', exact: true }),
    initial = await role.inputValue();
  await role.selectOption(initial === 'sky' ? 'water' : 'sky');
  await ready();
  assert.notEqual(await role.inputValue(), initial);
  await ui.getByRole('button', { name: '自動に戻す', exact: true }).click();
  await ready();
  assert.equal(await role.inputValue(), initial);
  report.roleEditReset = true;
  await ui.getByRole('button', { name: '上下の線で分ける', exact: true }).click();
  const line = ui.getByRole('slider', { name: '島を分ける線' });
  const at = Number(await line.getAttribute('aria-valuenow'));
  await line.press('ArrowDown');
  assert.equal(Number(await line.getAttribute('aria-valuenow')), at + 1);
  await line.press('Shift+ArrowUp');
  assert.equal(Number(await line.getAttribute('aria-valuenow')), at - 9);
  await ui.getByRole('combobox', { name: '下の役割' }).selectOption('water');
  await ui.getByRole('button', { name: '分ける', exact: true }).click();
  await ready();
  assert.equal(await ui.locator('.swatch').count(), originalCount + 1);
  await ui
    .getByRole('button', { name: /（上）、面積/ })
    .first()
    .click();
  await ui.getByRole('button', { name: '分割を戻す' }).click();
  await ready();
  assert.equal(await ui.locator('.swatch').count(), originalCount);
  report.splitUndo = true;
  const previewBeforeSave = await canvasData();
  const pngWait = ui.waitForEvent('download');
  await ui.getByRole('button', { name: 'この瞬間を画像で保存' }).click();
  const png = await pngWait;
  assert.ok(png.suggestedFilename().startsWith('ひとめぐり'));
  await png.saveAs(path.join(out, 'saved.png'));
  assert.equal((await readFile(path.join(out, 'saved.png'))).subarray(1, 4).toString(), 'PNG');
  assert.equal(await canvasData(), previewBeforeSave, 'PNG saving must restore preview overlays');
  report.pngDownload = true;
  await ui.getByRole('button', { name: '動画を書き出す', exact: true }).click();
  await ui.getByRole('button', { name: '中止', exact: true }).waitFor();
  assert.equal(await ui.locator(':focus').textContent(), '中止');
  assert.ok(await ui.getByRole('progressbar').count());
  assert.ok(await ui.getByRole('button', { name: '自分の絵を開く' }).isDisabled());
  await ui.getByRole('button', { name: '中止', exact: true }).click();
  await ui.getByRole('button', { name: '動画を書き出す', exact: true }).waitFor();
  report.exportProgressCancellation = true;
  const file = path.join(root, '../assets/samples/raw/flat-dusk-harbor.png');
  await ui.getByLabel('画像ファイル', { exact: true }).setInputFiles(file);
  await ready();
  assert.equal(
    await ui.locator('canvas').getAttribute('aria-label'),
    `${path.basename(file, path.extname(file))}の色の台本`,
  );
  const bytes = (await readFile(file)).toString('base64');
  await ui.evaluate((bytes) => {
    const data = Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0)),
      transfer = new DataTransfer();
    transfer.items.add(new File([data], 'drop.png', { type: 'image/png' }));
    window.dispatchEvent(
      new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }),
    );
  }, bytes);
  await ready();
  assert.equal(await ui.locator('canvas').getAttribute('aria-label'), 'dropの色の台本');
  report.sampleFileDrop = true;
  // Observe the real store and Worker client without adding a test API to the product.
  await ui.evaluate(async () => {
    const { AppStore } = await import('/src/state.ts');
    const load = AppStore.prototype.load;
    AppStore.prototype.load = function (...args) {
      window.largeImageStore = this;
      return load.apply(this, args);
    };
    const { SafetyClient } = await import('/src/safety/client.ts');
    const evaluate = SafetyClient.prototype.evaluate;
    window.largeImageChecks = [];
    SafetyClient.prototype.evaluate = function (roles, preset) {
      const job = { preset: { ...preset }, started: performance.now() };
      window.largeImageChecks.push(job);
      const gate = window.largeImageGate;
      return evaluate.call(this, roles, preset).then(async (result) => {
        Object.assign(job, { finished: performance.now(), result });
        await gate;
        return result;
      });
    };
  });
  const generatedJpeg = await ui.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 3000;
    const ctx = canvas.getContext('2d');
    const sky = ctx.createLinearGradient(0, 0, 0, 3000);
    sky.addColorStop(0, '#538fac');
    sky.addColorStop(0.5, '#c7976d');
    sky.addColorStop(0.51, '#34556c');
    sky.addColorStop(1, '#1d344c');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 3000, 3000);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    for (let y = 40; y < 2960; y += 50) {
      ctx.beginPath();
      ctx.moveTo(60, y);
      ctx.lineTo(2940, y + 30);
      ctx.stroke();
    }
    return canvas.toDataURL('image/jpeg', 0.94).split(',')[1];
  });
  const loadStarted = performance.now();
  await ui.getByLabel('画像ファイル', { exact: true }).setInputFiles({
    name: 'generated-white-lines-3000.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from(generatedJpeg, 'base64'),
  });
  await ready();
  const openMs = performance.now() - loadStarted;
  const large = await ui.evaluate(() => {
    const state = window.largeImageStore.getState();
    return {
      width: state.image.data.metadata.width,
      height: state.image.data.metadata.height,
      originalSize: state.image.originalSize,
      error: state.error,
      estimate: state.estimate,
    };
  });
  assert.deepEqual([large.width, large.height], [2048, 2048]);
  assert.deepEqual(large.originalSize, { width: 3000, height: 3000 });
  assert.equal(large.error, undefined);
  assert.equal(
    await ui
      .getByText('長辺 2048 px に縮めて開きました（元の大きさは 3000×3000）。', { exact: true })
      .count(),
    1,
  );
  await ui.evaluate(() => {
    window.largeImageChecks = [];
    // Keep the queue test deterministic even when the first Worker reply is very fast.
    window.largeImageGate = new Promise((resolve) => {
      window.releaseLargeImageGate = resolve;
    });
  });
  const night = ui.getByRole('slider', { name: '夜の深さ', exact: true });
  const inputs = [];
  let lastInputAt;
  for (const position of [51, 52, 53, 54, 55, 56]) {
    await night.fill(String(position));
    lastInputAt = performance.now();
    const immediate = await night.evaluate((control) => {
      const state = window.largeImageStore.getState();
      return {
        position: Number(control.value),
        disabled: control.disabled,
        checking: state.checking,
        draft: state.drafts.nightDepth,
        accepted: state.preset.nightDepth,
        output: control.closest('label').querySelector('output').textContent,
        valueText: control.getAttribute('aria-valuetext'),
      };
    });
    assert.equal(immediate.disabled, false);
    assert.equal(immediate.position, position);
    assert.equal(immediate.checking, true);
    assert.ok(Number.isFinite(immediate.draft));
    assert.equal(immediate.output, immediate.valueText);
    inputs.push(immediate);
  }
  await ui.evaluate(() => {
    window.largeImageGate = undefined;
    window.releaseLargeImageGate();
  });
  await ready();
  const settleMs = performance.now() - lastInputAt;
  const settled = await ui.evaluate(async () => {
    const { nightPosition } = await import('/src/ui/scales.ts');
    const { PRESETS } = await import('/src/script/index.ts');
    const state = window.largeImageStore.getState();
    return {
      drafts: state.drafts,
      checking: state.checking,
      accepted: state.preset.nightDepth,
      position: nightPosition(state.preset.nightDepth, PRESETS[state.preset.id].nightDepth),
      limit: state.limits.nightDepth,
      error: state.editError,
      pass: state.estimate.pass,
      checks: window.largeImageChecks,
    };
  });
  assert.deepEqual(settled.drafts, {});
  assert.equal(settled.checking, false);
  assert.equal(settled.pass, true);
  assert.ok(Math.abs(Number(await night.inputValue()) - settled.position) <= 1);
  if (settled.error) assert.equal(settled.accepted, settled.limit[1]);
  else assert.equal(Number(await night.inputValue()), 56);
  // All six inputs landed before the first result: only the first and last were checked.
  assert.equal(settled.checks.length, settled.error ? 9 : 2);
  report.largeImage = { openMs, settleMs, ...large, inputs, settled };
  console.log(
    `Large image: 3000×3000 → 2048×2048, open ${openMs.toFixed(0)}ms, final input → accepted ${settleMs.toFixed(0)}ms.`,
  );
  // The performance fixture is generated here; no private artwork is checked into the repo.
  const generatedPng = await ui.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 2048;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 2048, 2048);
    const colors = ['#538fac', '#447e9a', '#34556c', '#1d344c'];
    for (let band = 0; band < 4; band++) {
      ctx.fillStyle = colors[band];
      ctx.fillRect(82, 82 + band * 471, 1884, 471);
    }
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    for (let x = 100; x < 1940; x += 19) {
      ctx.beginPath();
      ctx.moveTo(x, 96);
      ctx.lineTo(x + 15, 1948);
      ctx.stroke();
    }
    window.safetyLongTasks = [];
    window.safetyObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        window.safetyLongTasks.push({ start: entry.startTime, duration: entry.duration });
    });
    window.safetyObserver.observe({ type: 'longtask' });
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const beginTiming = () =>
    ui.evaluate(() => {
      window.safetyLongTasks = [];
      window.safetyStart = performance.now();
    });
  const endTiming = async () => {
    const elapsed = await ui.evaluate(() => performance.now() - window.safetyStart);
    await ui.waitForTimeout(100);
    return ui.evaluate(
      (ms) => ({
        ms,
        longTasks: window.safetyLongTasks,
        maxLongTask: Math.max(0, ...window.safetyLongTasks.map((t) => t.duration)),
      }),
      elapsed,
    );
  };
  await beginTiming();
  await ui.getByLabel('画像ファイル', { exact: true }).setInputFiles({
    name: 'generated-white-border-rain-2048.png',
    mimeType: 'image/png',
    buffer: Buffer.from(generatedPng, 'base64'),
  });
  await ready();
  const performanceOpen = await endTiming();
  const estimateMs = await ui.evaluate(async () => {
    const store = window.largeImageStore,
      state = store.getState(),
      start = performance.now();
    const result = await store.safety.evaluate(state.image.roles, state.preset);
    if (!result.pass) throw new Error(result.reason);
    return performance.now() - start;
  });
  await beginTiming();
  await night.fill('51');
  await ready();
  const performanceInput = await endTiming();
  const editedIndex = await ui.evaluate(() =>
    window.largeImageStore.getState().image.roles.findIndex((r) => r !== 'middle'),
  );
  assert.ok(editedIndex >= 0);
  await ui.locator('.swatch').nth(editedIndex).click();
  await beginTiming();
  await role.selectOption('middle');
  await ready();
  const performanceRole = await endTiming();
  assert.equal(await role.inputValue(), 'middle');
  await ui.getByRole('button', { name: '上下の線で分ける', exact: true }).click();
  await ui.getByRole('combobox', { name: '上の役割' }).selectOption('middle');
  await ui.getByRole('combobox', { name: '下の役割' }).selectOption('middle');
  const beforeSplit = await ui.locator('.swatch').count();
  await beginTiming();
  await ui.getByRole('button', { name: '分ける', exact: true }).click();
  await ready();
  const performanceSplit = await endTiming();
  assert.equal(await ui.locator('.swatch').count(), beforeSplit + 1);
  await ui.evaluate(() => window.safetyObserver.disconnect());
  report.safetyPerformance = {
    fixture: '2048×2048, white border >15%, antialiased white rain lines, four blue bands',
    estimateMs,
    open: performanceOpen,
    input: performanceInput,
    role: performanceRole,
    split: performanceSplit,
  };
  console.log(`Safety performance: ${JSON.stringify(report.safetyPerformance)}`);
  assert.ok(estimateMs <= 300, `estimate ${estimateMs}ms > 300ms`);
  assert.ok(performanceOpen.ms <= 3000, `open ${performanceOpen.ms}ms > 3000ms`);
  assert.ok(performanceInput.ms <= 1000, `input ${performanceInput.ms}ms > 1000ms`);
  assert.ok(performanceRole.ms <= 2000, `role ${performanceRole.ms}ms > 2000ms`);
  assert.ok(performanceSplit.ms <= 2000, `split ${performanceSplit.ms}ms > 2000ms`);
  assert.ok(performanceOpen.maxLongTask <= 200, 'open blocked the UI for more than 200ms');
  assert.ok(performanceSplit.maxLongTask <= 200, 'split blocked the UI for more than 200ms');
  await ui.getByRole('button', { name: '港町', exact: true }).click();
  await ready();
  assert.equal(await ui.getByText(/長辺 2048 px に縮めて開きました/).count(), 0);
  const beforeBad = await canvasData();
  await ui
    .getByLabel('画像ファイル', { exact: true })
    .setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('invalid') });
  await ui.getByRole('alert').first().waitFor();
  assert.equal(await canvasData(), beforeBad);
  report.loadErrorPreservesImage = true;
  await ui.setViewportSize({ width: 390, height: 844 });
  assert.equal(await ui.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  report.mobileNoOverflow = true;
  await ui.emulateMedia({ reducedMotion: 'reduce' });
  await ui.waitForFunction(() => document.querySelector('.play')?.disabled);
  await timeline.press('Home');
  await timeline.press('Shift+ArrowRight');
  const still = await canvasData(),
    time = await clock.textContent();
  await ui.waitForTimeout(5000);
  assert.equal(await canvasData(), still);
  assert.equal(await clock.textContent(), time);
  assert.ok(time.startsWith('1.0'));
  report.reducedMotionManualOnly = true;
  await ui.emulateMedia({ reducedMotion: 'no-preference' });
  await ui.getByRole('button', { name: '再生', exact: true }).click();
  await ui.waitForTimeout(200);
  await ui.emulateMedia({ reducedMotion: 'reduce' });
  await ui.waitForFunction(() => document.querySelector('.play')?.disabled);
  const interrupted = await clock.textContent();
  await ui.waitForTimeout(200);
  assert.equal(await clock.textContent(), interrupted);
  report.reducedMotionStopsPlayback = true;
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.externalRequests, []);
  report.passed = true;
  console.log(
    'Chrome: reconstruction, playback, strip, presets, scales, islands, split/undo, local loading, PNG, export cancellation, reduced motion passed.',
  );
} finally {
  await browser?.close();
  await server?.close();
  await writeFile(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
}
