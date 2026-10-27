import { gamutMap, labToLinear } from '../src/color';
import { exportPng } from '../src/export/video';
import {
  adaptForeground,
  FOREGROUND_DEFAULTS,
  foregroundBounds,
  foregroundLight,
  loadForeground,
  prepareForeground,
} from '../src/foreground';
import { decodeImage } from '../src/image';
import { preprocessInWorker } from '../src/palette/client';
import { curate, materializeIslands } from '../src/palette/islands';
import { Renderer } from '../src/render';
import { PRESETS, rolePaletteAt } from '../src/script';
import backgroundShader from './fixtures/v02-background.glsl?raw';

let scene;
const encode = (c) =>
  Math.round(
    Math.max(
      0,
      Math.min(1, c <= 0.0031308 ? 12.92 * c : 1.055 * Math.max(0, c) ** (1 / 2.4) - 0.055),
    ) * 255,
  );
async function load(source, fgSource, x = 0.68) {
  const base = await preprocessInWorker(await decodeImage(source));
  const islands = curate('', base.metadata),
    data = materializeIslands(base, islands);
  let fgData;
  if (fgSource) fgData = await loadForeground(fgSource);
  else {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 192;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#efd3b4';
    ctx.beginPath();
    ctx.arc(64, 45, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#668fb9';
    ctx.fillRect(36, 75, 56, 100);
    fgData = prepareForeground(ctx.getImageData(0, 0, c.width, c.height));
  }
  scene = {
    data,
    roles: islands.map((i) => i.role),
    foreground: { ...FOREGROUND_DEFAULTS, x, data: fgData, name: '人物', thumbnail: '' },
  };
  return {
    width: data.metadata.width,
    height: data.metadata.height,
    roles: scene.roles,
    foregroundSize: [fgData.width, fgData.height],
  };
}
function renderer(reference = false) {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: true,
  });
  const original = gl.shaderSource.bind(gl);
  if (reference)
    gl.shaderSource = (shader, source) =>
      original(shader, source.includes('uniform sampler2D uLab;') ? backgroundShader : source);
  const r = new Renderer(canvas);
  gl.shaderSource = original;
  r.upload(scene.data);
  r.uploadForeground(scene.foreground.data);
  r.size(scene.data.metadata.width, scene.data.metadata.height);
  return r;
}
function pixels(r, preset, seconds, fg = true, options = {}) {
  const palette = rolePaletteAt(scene.data.metadata.palette, scene.roles, seconds, preset);
  r.draw(palette, {
    ...options,
    foreground: fg
      ? { ...scene.foreground, light: foregroundLight(scene.data.metadata, scene.roles, palette) }
      : undefined,
  });
  return r.read();
}
const difference = (a, b) => {
  let max = 0,
    changed = 0;
  for (let i = 0; i < a.length; i++) {
    max = Math.max(max, Math.abs(a[i] - b[i]));
    if (a[i] !== b[i]) changed++;
  }
  return { max, changed };
};
function verify() {
  const r = renderer(),
    ref = renderer(true),
    { data, foreground: fg } = scene;
  const bounds = foregroundBounds(fg.data, data.metadata.width / data.metadata.height, fg);
  const expected = new Uint8Array(data.metadata.width * data.metadata.height * 4);
  for (let y = 0; y < data.metadata.height; y++)
    for (let x = 0; x < data.metadata.width; x++) {
      const offset = (y * data.metadata.width + x) * 4;
      const fx = ((x + 0.5) / data.metadata.width - bounds.x) / bounds.width,
        fy = ((y + 0.5) / data.metadata.height - bounds.y) / bounds.height;
      const bg = labToLinear(gamutMap(Array.from(data.lab.subarray(offset, offset + 3))));
      let linear = bg,
        alpha = data.alpha[offset / 4] / 255;
      if (fx >= 0 && fx < 1 && fy >= 0 && fy < 1) {
        const j =
          (Math.floor(fy * fg.data.height) * fg.data.width + Math.floor(fx * fg.data.width)) * 4;
        const a = fg.data.lab[j + 3],
          fgLinear = labToLinear(gamutMap(Array.from(fg.data.lab.subarray(j, j + 3))));
        linear = bg.map((v, k) => v * (1 - a) + fgLinear[k] * a);
        alpha = a + alpha * (1 - a);
      }
      expected.set([...linear.map(encode), Math.round(alpha * 255)], offset);
    }
  const endpoints = [],
    noForeground = [],
    adaptation = [];
  let sampleX, sampleY, sampleLab, sampleAlpha;
  for (let y = 0; y < data.metadata.height && sampleY === undefined; y++) {
    const fy = ((y + 0.5) / data.metadata.height - bounds.y) / bounds.height;
    if (fy < 0 || fy >= 1) continue;
    for (
      let x = Math.max(0, Math.ceil(bounds.x * data.metadata.width));
      x < Math.min(data.metadata.width, (bounds.x + bounds.width) * data.metadata.width);
      x++
    ) {
      const fx = ((x + 0.5) / data.metadata.width - bounds.x) / bounds.width;
      if (fx < 0 || fx >= 1) continue;
      const j =
        (Math.floor(fy * fg.data.height) * fg.data.width + Math.floor(fx * fg.data.width)) * 4;
      if (fg.data.lab[j + 3] < 0.9) continue;
      sampleX = x;
      sampleY = y;
      sampleLab = Array.from(fg.data.lab.subarray(j, j + 3));
      sampleAlpha = fg.data.lab[j + 3];
      break;
    }
  }
  try {
    for (const preset of Object.values(PRESETS)) {
      if (sampleY === undefined)
        throw new Error('No foreground sample above alpha 0.9 for shader adaptation check');
      for (const fraction of [0.2, 0.5, 0.8])
        for (const blend of [0, 0.8, 1]) {
          const palette = rolePaletteAt(
            data.metadata.palette,
            scene.roles,
            preset.durationSec * fraction,
            preset,
          );
          const light = foregroundLight(data.metadata, scene.roles, palette);
          r.draw(palette, { foreground: { ...fg, blend, light } });
          const actual = new Uint8Array(4);
          r.gl.readPixels(
            sampleX,
            data.metadata.height - 1 - sampleY,
            1,
            1,
            r.gl.RGBA,
            r.gl.UNSIGNED_BYTE,
            actual,
          );
          const bgOffset = (sampleY * data.metadata.width + sampleX) * 4;
          const bgLab = Array.from(data.lab.subarray(bgOffset, bgOffset + 3));
          for (let k = 0; k < palette.length; k++) {
            const weight = data.weights[Math.floor(k / 4)][bgOffset + (k % 4)];
            for (let channel = 0; channel < 3; channel++)
              bgLab[channel] += weight * (palette[k][channel] - data.metadata.palette[k][channel]);
          }
          bgLab[0] = Math.max(0, Math.min(1, bgLab[0]));
          const bgLinear = labToLinear(gamutMap(bgLab));
          const fgLinear = labToLinear(gamutMap(adaptForeground(sampleLab, light, blend)));
          const alpha = sampleAlpha + (data.alpha[bgOffset / 4] / 255) * (1 - sampleAlpha);
          const expectedPixel = [
            ...bgLinear.map((v, k) => encode(v * (1 - sampleAlpha) + fgLinear[k] * sampleAlpha)),
            Math.round(alpha * 255),
          ];
          adaptation.push({
            preset: preset.id,
            fraction,
            blend,
            ...difference(actual, expectedPixel),
          });
        }
      for (const seconds of [0, preset.durationSec])
        endpoints.push({
          preset: preset.id,
          seconds,
          ...difference(pixels(r, preset, seconds), expected),
        });
      for (const fraction of [0, 0.1, 0.25, 0.5, 0.75, 1])
        noForeground.push({
          preset: preset.id,
          fraction,
          ...difference(
            pixels(r, preset, preset.durationSec * fraction, false),
            pixels(ref, preset, preset.durationSec * fraction, false),
          ),
        });
    }
    const regular = pixels(r, PRESETS.day, 0);
    const selected = pixels(r, PRESETS.day, 0, true, { selected: 0 });
    const split = pixels(r, PRESETS.day, 0, true, { splitAt: 0.5 });
    const sample = (at) => {
      const x = Math.round(data.metadata.width * fg.x),
        y = Math.round(data.metadata.height * at),
        i = (y * data.metadata.width + x) * 4;
      return {
        original: Array.from(regular.subarray(i, i + 4)),
        selected: Array.from(selected.subarray(i, i + 4)),
        split: Array.from(split.subarray(i, i + 4)),
      };
    };
    return {
      endpoints,
      adaptation,
      noForeground,
      preview: [sample(0.4), sample(0.8)],
      expectedComposite: expected.length,
    };
  } finally {
    r.dispose();
    ref.dispose();
  }
}
async function performanceTest() {
  const r = renderer();
  r.size(1920, 1080);
  const gl = r.gl,
    ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'),
    queries = [],
    wall = [],
    pixel = new Uint8Array(4);
  const draw = (t) => {
    const palette = rolePaletteAt(scene.data.metadata.palette, scene.roles, t, PRESETS.day);
    r.draw(palette, {
      foreground: {
        ...scene.foreground,
        light: foregroundLight(scene.data.metadata, scene.roles, palette),
      },
    });
  };
  for (let i = 0; i < 12; i++) draw(i);
  gl.finish();
  for (let i = 0; i < 31; i++) {
    const q = ext ? gl.createQuery() : null,
      now = performance.now();
    if (q) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    draw(i % 24);
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
      draw((now / 1000) % 24);
      if (gaps.length < 120) requestAnimationFrame(frame);
      else resolve();
    }
    requestAnimationFrame(frame);
  });
  const sorted = (a) => [...a].sort((a, b) => a - b),
    info = r.info;
  r.dispose();
  return {
    info,
    size: [1920, 1080],
    gpuMedianMs: gpu.length ? sorted(gpu)[15] : null,
    wallMedianMs: sorted(wall)[15],
    rafMedianMs: sorted(gaps)[60],
    rafP95Ms: sorted(gaps)[114],
    rafMaxMs: Math.max(...gaps),
  };
}
async function png(presetId, seconds) {
  const blob = await exportPng(
    scene.data,
    scene.roles,
    PRESETS[presetId],
    seconds,
    scene.foreground,
  );
  const bitmap = await createImageBitmap(blob),
    canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const r = renderer();
  const comparison = difference(
    ctx.getImageData(0, 0, canvas.width, canvas.height).data,
    pixels(r, PRESETS[presetId], seconds),
  );
  r.dispose();
  return { bytes: Array.from(new Uint8Array(await blob.arrayBuffer())), comparison };
}
async function resizeTest() {
  const canvas = document.createElement('canvas');
  canvas.width = 4096;
  canvas.height = 2;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#b0c4de';
  ctx.fillRect(0, 0, 2048, 2);
  const data = await loadForeground(canvas.toDataURL());
  return { width: data.width, height: data.height };
}
window.foregroundTest = {
  load,
  verify,
  performanceTest,
  png,
  getScene: () => scene,
  adaptForeground,
  resizeTest,
};
