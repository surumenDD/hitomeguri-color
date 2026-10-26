// Evaluates one model-probe submission (experiments/model-probe/SPEC.md).
// Usage: node probe-eval.mjs <dir containing index.html> [outDir]
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.argv[2]);
const out = path.resolve(process.argv[3] ?? path.join(import.meta.dirname, 'out', path.basename(dir)));
fs.mkdirSync(out, { recursive: true });
const url = pathToFileURL(path.join(dir, 'index.html')).href;
const W = 1920, H = 1080;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Reference OKLab values, computed independently from Ottosson's published matrices.
const REF_OKLAB = {
  '#ff0000': [0.6280, 0.2249, 0.1258],
  '#00ff00': [0.8664, -0.2339, 0.1795],
  '#0000ff': [0.4520, -0.0325, -0.3115],
  '#ffffff': [1.0, 0.0, 0.0],
  '#808080': [0.5999, 0.0, 0.0],
};
const MAPPED_TARGETS = [{ L: 0.7, C: 0.4, h: 150 }, { L: 0.5, C: 0.05, h: 30 }];

function hexToOklch(hex) {
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

// Pulls the three numbers for one input color out of whatever JSON shape the submission chose.
function findLab(node, key) {
  if (!node || typeof node !== 'object') return null;
  for (const [k, v] of Object.entries(node)) {
    const hit = k.toLowerCase() === key || (v && typeof v === 'object' && Object.values(v).some((x) => String(x).toLowerCase() === key));
    if (hit && v && typeof v === 'object') {
      const nums = Array.isArray(v) ? v : ['L', 'l', 'a', 'b'].map((n) => v[n]).filter((x) => typeof x === 'number');
      if (nums.length >= 3) return nums.slice(0, 3).map(Number);
      if (Array.isArray(v.lab ?? v.oklab)) return (v.lab ?? v.oklab).map(Number);
    }
    const deeper = findLab(v, key);
    if (deeper) return deeper;
  }
  return null;
}

function checkSelftest(json) {
  const result = { oklab: {}, mapped: [], pass: true };
  for (const [hex, ref] of Object.entries(REF_OKLAB)) {
    const got = findLab(json, hex);
    const ok = !!got && got.every((v, i) => Math.abs(v - ref[i]) <= 0.001);
    result.oklab[hex] = { got, ref, ok };
    result.pass &&= ok;
  }
  const mappedSection = JSON.stringify(json.oklchToSrgbMapped ?? json);
  const hexes = [...mappedSection.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase())
    .filter((h) => !(h in REF_OKLAB));
  MAPPED_TARGETS.forEach((t, i) => {
    const hex = hexes[i];
    if (!hex) { result.mapped.push({ target: t, ok: false, note: 'hex not found' }); result.pass = false; return; }
    const got = hexToOklch(hex);
    const dh = Math.abs(((got.h - t.h + 540) % 360) - 180);
    const ok = Math.abs(got.L - t.L) <= 0.01 && dh <= 3 && got.C <= t.C + 0.002;
    result.mapped.push({ target: t, hex, got, hueError: dh, ok });
    result.pass &&= ok;
  });
  return result;
}

// The installed Chrome renders headless on the real GPU; Playwright's bundled shell falls back to SwiftShader.
const browser = await chromium.launch({ channel: 'chrome' });
const report = { url, when: new Date().toISOString() };

async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, ...opts });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`.slice(0, 400)));
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`.slice(0, 400)));
  return { ctx, page, logs };
}

// 1. ?selftest
{
  const { ctx, page, logs } = await newPage();
  await page.goto(`${url}?selftest`);
  await sleep(1500);
  const text = await page.evaluate(() => document.querySelector('pre')?.textContent ?? null);
  let json = null;
  try { json = JSON.parse(text); } catch { /* reported below */ }
  report.selftest = json ? { raw: json, check: checkSelftest(json) } : { raw: text, check: { pass: false, note: 'no parsable JSON in <pre>' } };
  report.selftest.console = logs;
  await ctx.close();
}

// 2. Normal run: timed shots, frame timing, drag, flicker series
const shots = {};
{
  const { ctx, page, logs } = await newPage();
  await page.goto(url);
  report.gl = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  await sleep(1000);
  shots.t01 = await page.screenshot({ path: path.join(out, 't01s.png') });
  report.frames = await page.evaluate(() => new Promise((res) => {
    const d = []; let last = performance.now();
    const f = (now) => { d.push(now - last); last = now; if (d.length < 240) requestAnimationFrame(f); else res(d); };
    requestAnimationFrame(f);
  })).then((d) => {
    const s = [...d.slice(1)].sort((a, b) => a - b);
    const q = (p) => +s[Math.floor(p * (s.length - 1))].toFixed(2);
    return { median: q(0.5), p95: q(0.95), max: q(1) };
  });
  // Luminance series: one sample every ~100 ms for 3 s.
  const series = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 3000) {
    series.push({ t: Date.now() - t0, buf: await page.screenshot({ type: 'jpeg', quality: 60 }) });
    await sleep(60);
  }
  await sleep(Math.max(0, 12000 - (Date.now() - t0) - 4000));
  shots.t12 = await page.screenshot({ path: path.join(out, 't12s.png') });
  // Drag: an arc across the middle, two separate presses.
  for (const [x0, y0, x1, y1] of [[640, 420, 1180, 640], [1300, 300, 900, 800]]) {
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    for (let i = 1; i <= 40; i++) {
      const k = i / 40;
      await page.mouse.move(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k + Math.sin(k * Math.PI) * -120);
      await sleep(20);
    }
    await page.mouse.up();
  }
  await sleep(300);
  shots.drag03 = await page.screenshot({ path: path.join(out, 'drag+0.3s.png') });
  await sleep(4000);
  shots.drag43 = await page.screenshot({ path: path.join(out, 'drag+4.3s.png') });
  report.flickerSamples = series.map((s) => s.t);
  report._series = series;
  report.console = logs;
  await ctx.close();
}

// 3. Reduced motion: the field should not change on its own.
{
  const { ctx, page, logs } = await newPage({ reducedMotion: 'reduce' });
  await page.goto(url);
  await sleep(1500);
  shots.rmA = await page.screenshot({ path: path.join(out, 'reduced-a.png') });
  await sleep(5000);
  shots.rmB = await page.screenshot({ path: path.join(out, 'reduced-b.png') });
  report.reducedConsole = logs;
  await ctx.close();
}

// Image metrics run inside a blank page so no image library is needed.
{
  const { ctx, page } = await newPage();
  const b64 = (buf) => buf.toString('base64');
  const metrics = await page.evaluate(async ({ pairs, series }) => {
    const load = async (data, type) => {
      const bmp = await createImageBitmap(await (await fetch(`data:${type};base64,${data}`)).blob());
      const c = new OffscreenCanvas(320, 180);
      const g = c.getContext('2d');
      g.drawImage(bmp, 0, 0, 320, 180);
      return g.getImageData(0, 0, 320, 180).data;
    };
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const lum = (d) => { let s = 0; for (let i = 0; i < d.length; i += 4) s += 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]); return s / (d.length / 4); };
    const diff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); return s / (a.length / 4) / 3; };
    const out = {};
    for (const [name, a, b] of pairs) out[name] = +diff(await load(a, 'image/png'), await load(b, 'image/png')).toFixed(3);
    const lums = [];
    for (const s of series) lums.push({ t: s.t, lum: +lum(await load(s.data, 'image/jpeg')).toFixed(4) });
    out.luminance = lums;
    return out;
  }, {
    pairs: [
      ['reducedMotionDiff', b64(shots.rmA), b64(shots.rmB)],
      ['autonomousChange_1s_vs_12s', b64(shots.t01), b64(shots.t12)],
      ['dragChange_12s_vs_drag', b64(shots.t12), b64(shots.drag03)],
    ],
    series: report._series.map((s) => ({ t: s.t, data: b64(s.buf) })),
  });
  const l = metrics.luminance.map((x) => x.lum);
  const steps = l.slice(1).map((v, i) => Math.abs(v - l[i]));
  report.metrics = {
    ...metrics,
    luminance: undefined,
    luminanceRange: [Math.min(...l), Math.max(...l)].map((v) => +v.toFixed(4)),
    maxLuminanceStep: +Math.max(...steps).toFixed(4),
    bigSteps: steps.filter((s) => s >= 0.1).length,
  };
  await ctx.close();
}

delete report._series;
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify({
  out,
  gl: report.gl,
  selftestPass: report.selftest.check.pass,
  frames: report.frames,
  metrics: report.metrics,
  errors: [...report.selftest.console, ...report.console, ...report.reducedConsole].filter((s) => /error/i.test(s)),
}, null, 2));
