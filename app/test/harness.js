// Frozen, test-only v2 references; the product never imports these or experiments/.

import { decodeImage } from '../src/image';
import { preprocessInWorker } from '../src/palette/client';
import { Renderer } from '../src/render';
import { SAMPLES } from '../src/samples';
import { DAYLIGHT, inferRoles, MOMENTS, ROLES, rolePaletteAt } from '../src/script';
import { Renderer as SpikeRenderer } from './fixtures/v2/renderer.js';
import { inferRoles as spikeInfer, rolePaletteAt as spikePalette } from './fixtures/v2/script.js';

const canvas = document.querySelector('#result');
const renderer = new Renderer(canvas);
const spikeCanvas = document.createElement('canvas');
const spikeRenderer = new SpikeRenderer(spikeCanvas);
function psnr(a, b) {
  let squared = 0,
    max = 0,
    changed = 0;
  for (let i = 0; i < a.length; i += 4) {
    let any = false;
    for (let j = 0; j < 3; j++) {
      const difference = a[i + j] - b[i + j];
      squared += difference ** 2;
      max = Math.max(max, Math.abs(difference));
      any ||= difference !== 0;
    }
    if (any) changed++;
  }
  const mse = squared / ((a.length / 4) * 3);
  return {
    psnrDb: mse ? 10 * Math.log10(255 ** 2 / mse) : 'Infinity',
    mse,
    maxByteError: max,
    changedPixels: changed,
  };
}
const unflip = (raw, width, height) => {
  const out = new Uint8Array(raw.length);
  for (let y = 0; y < height; y++)
    out.set(raw.subarray(y * width * 4, (y + 1) * width * 4), (height - 1 - y) * width * 4);
  return out;
};
function referencePreprocess(image) {
  const worker = new Worker(new URL('./fixtures/v2/preprocess.js', import.meta.url), {
    type: 'module',
  });
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      worker.terminate();
      data.error ? reject(new Error(data.error)) : resolve(data);
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message));
    };
    worker.postMessage({ rgba: image.data, width: image.width, height: image.height });
  });
}
async function sampleTest(id, compare = true) {
  const sample = SAMPLES.find((sample) => sample.id === id);
  const image = await decodeImage(sample.url);
  const source = image.data.slice();
  const reference = compare ? await referencePreprocess(image) : undefined;
  const wallStart = performance.now();
  const data = await preprocessInWorker(image);
  const workerWallMs = performance.now() - wallStart;
  const { width, height, palette } = data.metadata;
  renderer.upload(data);
  renderer.size(width, height);
  renderer.draw(palette);
  const identity = psnr(source, renderer.read());
  const roles = inferRoles(data.metadata).map((i) => i.role);
  renderer.draw(rolePaletteAt(palette, roles, 0));
  const start = psnr(source, renderer.read());
  renderer.draw(rolePaletteAt(palette, roles, 24));
  const end = psnr(source, renderer.read());
  const result = {
    id,
    width,
    height,
    identity,
    start,
    end,
    timing: data.metadata.timing,
    workerWallMs,
    bytes: data.metadata.bytes,
    roles,
    moments: [],
  };
  if (compare) {
    result.paletteMaxError = Math.max(
      ...palette.flatMap((p, k) => p.map((v, j) => Math.abs(v - reference.metadata.palette[k][j]))),
    );
    result.rolesMatch =
      JSON.stringify(roles) === JSON.stringify(spikeInfer(reference.metadata).map((i) => i.role));
    const roleNames = Object.keys(ROLES);
    result.scriptMaxError = 0;
    // Test every role on every palette point, not just the roles inferred for these images.
    for (const role of roleNames) {
      const all = palette.map(() => role);
      for (let frame = 0; frame <= 720; frame++) {
        const q = rolePaletteAt(palette, all, frame / 30, DAYLIGHT);
        const old = spikePalette(palette, all, frame / 30);
        q.forEach((p, k) => {
          p.forEach((v, j) => {
            result.scriptMaxError = Math.max(result.scriptMaxError, Math.abs(v - old[k][j]));
          });
        });
      }
    }
    reference.alpha = data.alpha;
    renderer.size(960, Math.round((960 * height) / width));
    spikeRenderer.upload(reference);
    spikeRenderer.size(canvas.width, canvas.height);
    for (const [seconds, label] of MOMENTS) {
      const q = rolePaletteAt(palette, roles, seconds);
      const old = spikePalette(reference.metadata.palette, roles, seconds);
      spikeRenderer.draw(2, old);
      const referencePixels = unflip(spikeRenderer.read(), canvas.width, canvas.height);
      renderer.upload(reference);
      renderer.draw(q);
      const sameWeights = psnr(referencePixels, renderer.read());
      renderer.upload(data);
      renderer.draw(q);
      const shepardVsSpike = psnr(referencePixels, renderer.read());
      const png = canvas.toDataURL('image/png');
      renderer.size(width, height);
      renderer.draw(q, { diagnostic: true });
      const diagnostic = renderer.read();
      let lightnessOut = 0;
      const lightnessExamples = [];
      for (let i = 0; i < diagnostic.length; i += 4)
        if (diagnostic[i]) {
          lightnessOut++;
          if (lightnessExamples.length < 3) {
            let L = data.lab[i];
            for (let k = 0; k < 16; k++)
              L += data.weights[Math.floor(k / 4)][i + (k % 4)] * (q[k][0] - palette[k][0]);
            lightnessExamples.push({
              x: (i / 4) % width,
              y: Math.floor(i / 4 / width),
              sourceL: data.lab[i],
              L,
            });
          }
        }
      renderer.size(960, Math.round((960 * height) / width));
      result.moments.push({
        seconds,
        label,
        sameWeights,
        shepardVsSpike,
        lightnessOut,
        lightnessExamples,
        png,
      });
    }
  }
  return result;
}
async function benchmark() {
  const source = await decodeImage(SAMPLES[0].url);
  const resize = new OffscreenCanvas(1732, 1155); // 2,000,460 pixels, original 3:2 aspect.
  const ctx = resize.getContext('2d', { willReadFrequently: true });
  const tmp = new OffscreenCanvas(source.width, source.height);
  tmp.getContext('2d').putImageData(source, 0, 0);
  ctx.drawImage(tmp, 0, 0, resize.width, resize.height);
  const times = [];
  for (let run = 0; run < 3; run++) {
    const start = performance.now();
    const data = await preprocessInWorker(ctx.getImageData(0, 0, resize.width, resize.height));
    times.push({
      ...data.metadata.timing,
      workerWallMs: performance.now() - start,
      bytes: data.metadata.bytes,
    });
  }
  return { width: resize.width, height: resize.height, runs: times };
}
async function renderBenchmark() {
  const data = await preprocessInWorker(await decodeImage(SAMPLES[0].url));
  renderer.upload(data);
  renderer.size(1920, 1080);
  const roles = inferRoles(data.metadata).map((i) => i.role);
  const palettes = MOMENTS.map(([t]) => rolePaletteAt(data.metadata.palette, roles, t));
  const gl = renderer.gl,
    ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const wall = [],
    queries = [];
  const pixel = new Uint8Array(4);
  for (let i = 0; i < 12; i++) renderer.draw(palettes[i % palettes.length]);
  gl.finish();
  for (let i = 0; i < 31; i++) {
    const query = ext ? gl.createQuery() : null;
    const start = performance.now();
    if (query) gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    renderer.draw(palettes[i % palettes.length]);
    if (query) {
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      queries.push(query);
    }
    gl.finish();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    wall.push(performance.now() - start);
    if (i % 5 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  let gpu = [];
  if (ext) {
    const deadline = performance.now() + 5000;
    while (
      queries.some((q) => !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) &&
      performance.now() < deadline
    )
      await new Promise((resolve) => setTimeout(resolve, 10));
    if (
      !gl.getParameter(ext.GPU_DISJOINT_EXT) &&
      queries.every((q) => gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE))
    )
      gpu = queries.map((q) => gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
    queries.forEach((q) => {
      gl.deleteQuery(q);
    });
  }
  const median = (a) => [...a].sort((a, b) => a - b)[Math.floor(a.length / 2)];
  return {
    width: 1920,
    height: 1080,
    warmup: 12,
    samples: 31,
    wallMedianMs: median(wall),
    wallMaxMs: Math.max(...wall),
    gpuMedianMs: gpu.length ? median(gpu) : null,
  };
}
async function contactSheet(id, moments) {
  const sheet = document.createElement('canvas');
  sheet.width = 1600;
  sheet.height = 700;
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  ctx.fillStyle = '#000';
  ctx.font = '20px sans-serif';
  ctx.fillText(`${id} / Shepard / 1日の光（v2）`, 12, 28);
  for (const [i, moment] of moments.entries()) {
    const image = new Image();
    image.src = moment.png;
    await image.decode();
    const x = (i % 4) * 400,
      y = 40 + Math.floor(i / 4) * 330;
    ctx.fillStyle = '#000';
    ctx.fillText(`${moment.seconds.toFixed(1)}秒 / ${moment.label}`, x + 8, y + 25);
    ctx.drawImage(image, x, y + 40, 400, (400 * image.height) / image.width);
  }
  return sheet.toDataURL('image/jpeg', 0.88);
}
async function alphaTest() {
  const rgba = new Uint8ClampedArray([20, 40, 60, 255, 80, 100, 120, 128, 0, 0, 0, 0]);
  const expected = rgba.slice();
  const data = await preprocessInWorker(new ImageData(rgba, 3, 1));
  renderer.upload(data);
  renderer.size(3, 1);
  renderer.draw(data.metadata.palette);
  const actual = renderer.read();
  return {
    rgb: psnr(expected, actual),
    alphaExact: expected.every((v, i) => i % 4 !== 3 || actual[i] === v),
  };
}
async function fallbackTest() {
  const data = await preprocessInWorker(
    new ImageData(new Uint8ClampedArray([20, 40, 60, 255]), 1, 1),
  );
  renderer.upload(data);
  renderer.size(1, 1);
  return [-2, 2].map((delta) => {
    const palette = data.metadata.palette.map((p) => [p[0] + delta, p[1], p[2]]);
    renderer.draw(palette, { diagnostic: true });
    const diagnostic = renderer.read()[0];
    renderer.draw(palette);
    return { diagnostic, rgba: [...renderer.read()] };
  });
}
window.harness = {
  sampleTest,
  benchmark,
  renderBenchmark,
  contactSheet,
  alphaTest,
  fallbackTest,
  gpu: renderer.info,
};
