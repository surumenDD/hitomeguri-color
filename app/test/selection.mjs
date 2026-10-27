import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { rgbToLab } from './fixtures/v4/color.js';

const POINTS = [0.125, 0.375, 0.625, 0.875].flatMap((x) => [
  [x, 0.25],
  [x, 0.75],
]);
async function decodePoints(page, base64, box) {
  return page.evaluate(
    async ({ box, base64, points }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const c = document.createElement('canvas');
      c.width = image.width;
      c.height = image.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(image, 0, 0);
      const rect = box ?? { x: 0, y: 0, width: c.width, height: c.height };
      return points.map(([x, y]) => [
        ...ctx.getImageData(
          Math.floor(rect.x + x * rect.width),
          Math.floor(rect.y + y * rect.height),
          1,
          1,
        ).data,
      ]);
    },
    { box, base64, points: POINTS },
  );
}
// Measure the composited screen, so a stale displayed canvas cannot pass via readPixels alone.
export async function selectionPixels(page) {
  const box = await page.locator('.picture canvas').boundingBox();
  return decodePoints(page, (await page.screenshot()).toString('base64'), box);
}
export const luminance = (rgb) =>
  rgb.slice(0, 3).reduce((sum, byte, i) => {
    const c = byte / 255,
      linear = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    return sum + linear * [0.2126, 0.7152, 0.0722][i];
  }, 0);
export const ratios = (before, after) =>
  after.map((rgb, k) => {
    const p = rgbToLab(...before[k]),
      q = rgbToLab(...rgb);
    return { L: q[0] / p[0], C: Math.hypot(q[1], q[2]) / Math.hypot(p[1], p[2]) };
  });
export function assertRatios(before, after, selected) {
  const measured = ratios(before, after),
    expected = { L: 0.6, C: 0.25 };
  measured.forEach((ratio, k) => {
    if (selected.includes(k))
      assert.deepEqual(after[k], before[k], `Selected cell ${k} must keep its colour exactly`);
    else {
      // 8-bit RGB quantization: absolute ratio tolerances, chosen for these midtone chromatic cells.
      assert.ok(
        Math.abs(ratio.L - expected.L) <= 0.012,
        `Cell ${k}: OKLab L ratio ${ratio.L}, expected ${expected.L} ± 0.012`,
      );
      assert.ok(
        Math.abs(ratio.C - expected.C) <= 0.04,
        `Cell ${k}: OKLab C ratio ${ratio.C}, expected ${expected.C} ± 0.04`,
      );
    }
  });
  return measured;
}
export async function selectionFixture(page) {
  const base64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const ctx = c.getContext('2d');
    ['#6090c0', '#80c080', '#c08060', '#8060a0'].forEach((hex, k) => {
      ctx.fillStyle = hex;
      ctx.fillRect(k * 64, 0, 64, 128);
    });
    return c.toDataURL().split(',')[1];
  });
  await page.getByLabel('画像ファイル', { exact: true }).setInputFiles({
    name: 'island-regression.png',
    mimeType: 'image/png',
    buffer: Buffer.from(base64, 'base64'),
  });
  await page.waitForFunction(
    () =>
      document.querySelector('.picture canvas')?.getAttribute('aria-label') ===
        'island-regressionの色の台本' && !document.querySelector('.play')?.disabled,
    null,
    { timeout: 30000 },
  );
  await page.getByRole('slider', { name: '1周の中の時刻', exact: true }).press('Home');
}
export async function measureSelection(page, playing = false) {
  const initial = await selectionPixels(page),
    swatch = page.getByRole('button', { name: /^空、/ }).first();
  const color = await swatch.evaluate((node) =>
    getComputedStyle(node).backgroundColor.match(/\d+/g).slice(0, 3).map(Number),
  );
  const selected = initial.flatMap((rgb, k) =>
    rgb.slice(0, 3).every((v, i) => Math.abs(v - color[i]) <= 1) ? [k] : [],
  );
  assert.equal(
    selected.length,
    2,
    'The selected colour must occur on both sides of the split line',
  );
  if (playing) {
    await page.getByRole('button', { name: '再生', exact: true }).click();
    await page.waitForFunction(
      () => parseFloat(document.querySelector('.when span').textContent) > 0.1,
    );
  }
  await swatch.click();
  const after = await selectionPixels(page),
    stopped = await page.locator('.when span').textContent();
  assert.equal(
    await page.getByRole('button', { name: '再生', exact: true }).count(),
    1,
    'Selection pauses playback',
  );
  await swatch.click();
  const restored = await selectionPixels(page),
    before = playing ? restored : initial;
  assert.equal(
    await page.locator('.when span').textContent(),
    stopped,
    'Selection must keep the same paused time',
  );
  return { before, after, selected, ratios: ratios(before, after), restored };
}
export function assertSelection(result) {
  assertRatios(result.before, result.after, result.selected);
  assert.deepEqual(
    result.restored,
    result.before,
    'Deselecting must restore the exact original pixels',
  );
}
export async function splitPreview(page) {
  const before = await selectionPixels(page),
    swatch = page.getByRole('button', { name: /^空、/ }).first();
  await swatch.click();
  const selectedImage = await selectionPixels(page);
  const selected = before.flatMap((rgb, k) =>
    rgb.every((v, i) => v === selectedImage[k][i]) ? [k] : [],
  );
  await page.getByRole('button', { name: '上下の線で分ける', exact: true }).click();
  const upper = await selectionPixels(page);
  const upperRatios = assertRatios(
    before,
    upper,
    selected.filter((k) => k % 2 === 0),
  );
  await page.getByRole('combobox', { name: '下の役割' }).focus();
  const lower = await selectionPixels(page);
  const lowerRatios = assertRatios(
    before,
    lower,
    selected.filter((k) => k % 2 === 1),
  );
  await page.getByRole('button', { name: 'やめる', exact: true }).click();
  assert.deepEqual(await selectionPixels(page), selectedImage);
  await swatch.click();
  return { upper: upperRatios, lower: lowerRatios };
}
export async function exportedColours(page, out) {
  const length = page.getByRole('slider', { name: '長さ', exact: true });
  await length.fill('0');
  await page.waitForFunction(() => !document.querySelector('.play')?.disabled);
  await page.getByRole('slider', { name: '1周の中の時刻', exact: true }).press('Home');
  const before = await selectionPixels(page);
  const swatch = page.getByRole('button', { name: /^空、/ }).first();
  await swatch.click();
  const pngWait = page.waitForEvent('download');
  await page.getByRole('button', { name: 'この瞬間を画像で保存' }).click();
  const png = await pngWait,
    pngFile = path.join(out, 'selected-export.png');
  await png.saveAs(pngFile);
  const pngPixels = await decodePoints(page, (await readFile(pngFile)).toString('base64'));
  assert.deepEqual(pngPixels, before, 'PNG must omit selection emphasis');
  const videoWait = page.waitForEvent('download', { timeout: 60000 });
  await page.getByRole('button', { name: '動画を書き出す', exact: true }).click();
  const video = await videoWait,
    videoFile = path.join(out, 'selected-export.mp4');
  assert.equal(video.suggestedFilename(), 'ひとめぐり-island-regression-12秒.mp4');
  await video.saveAs(videoFile);
  await page.waitForFunction(() => !document.querySelector('[role="progressbar"]'), null, {
    timeout: 30000,
  });
  // The 256×128 fixture is enlarged to the video's minimum long edge of 512.
  const width = 512,
    height = 256;
  const { stdout } = await promisify(execFile)(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      videoFile,
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      'pipe:1',
    ],
    { encoding: 'buffer', windowsHide: true, maxBuffer: width * height * 3 + 4096 },
  );
  assert.equal(stdout.length, width * height * 3);
  const videoPixels = POINTS.map(([x, y]) => {
    const i = (Math.floor(y * height) * width + Math.floor(x * width)) * 3;
    return [...stdout.subarray(i, i + 3), 255];
  });
  const measured = ratios(before, videoPixels);
  measured.forEach((r, k) => {
    assert.ok(Math.abs(r.L - 1) < 0.025, `MP4 cell ${k} L ratio ${r.L}`);
    assert.ok(Math.abs(r.C - 1) < 0.06, `MP4 cell ${k} C ratio ${r.C}`);
  });
  await swatch.click();
  return { pngExact: true, mp4FirstFrame: measured };
}
