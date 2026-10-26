// Reports what this machine's Chrome (or Edge) can actually do with WebCodecs.
// Usage: node probe-webcodecs.mjs [chrome|msedge]
// Prints the GPU renderer and the result of `VideoEncoder.isConfigSupported`
// plus a 10-frame real encode for each candidate codec string.
// WebCodecs is [SecureContext]-gated: VideoEncoder is undefined on about:blank,
// so the probe serves a blank page from 127.0.0.1 (loopback counts as secure).
import { chromium } from '../../tools/visual-qa/node_modules/playwright-core/index.mjs';
import http from 'node:http';

const CODECS = [
  ['H.264 High 5.1', 'avc1.640033'],
  ['H.264 High 4.0', 'avc1.640028'],
  ['H.264 Main 4.0', 'avc1.4d0028'],
  ['H.264 Baseline 3.1', 'avc1.42001f'],
  ['H.264 Baseline 4.0', 'avc1.420028'],
  ['VP9 profile 0', 'vp09.00.10.08'],
  ['VP9 profile 0 level 4.0', 'vp09.00.40.08'],
  ['VP8', 'vp8'],
  ['HEVC main', 'hev1.1.6.L93.B0'],
  ['AV1', 'av01.0.04M.08'],
];

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><meta charset="utf-8"><title>probe</title>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ channel: process.argv[2] ?? 'chrome' });
const page = await browser.newPage();
await page.goto(origin);

const report = await page.evaluate(async (codecs) => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
  const out = {
    ua: navigator.userAgent,
    glRenderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
    hasVideoEncoder: typeof VideoEncoder !== 'undefined',
    hasVideoFrame: typeof VideoFrame !== 'undefined',
    hasOffscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    codecs: [],
  };
  if (!out.hasVideoEncoder) return out;

  const canvas = new OffscreenCanvas(160, 90);
  const ctx = canvas.getContext('2d');
  for (const [label, codec] of codecs) {
    const base = { codec, width: 160, height: 90, bitrate: 400_000, framerate: 30 };
    const row = { label, codec, supported: null, error: null, encoded: 0, bytes: 0, keyframes: 0 };
    try {
      const cfg = { ...base };
      if (codec.startsWith('avc1')) cfg.avc = { format: 'avc' };
      if (codec.startsWith('hev1')) cfg.hevc = { format: 'hevc' };
      const s = await VideoEncoder.isConfigSupported(cfg);
      row.supported = !!s.supported;
      if (!s.supported) {
        s.config?.codec && (row.note = s.config.codec);
        out.codecs.push(row);
        continue;
      }
      await new Promise((resolve, reject) => {
        const enc = new VideoEncoder({
          output: (chunk) => {
            row.encoded++;
            row.bytes += chunk.byteLength;
            if (chunk.type === 'key') row.keyframes++;
          },
          error: (e) => reject(e),
        });
        enc.configure(cfg);
        for (let i = 0; i < 10; i++) {
          ctx.fillStyle = `hsl(${i * 36} 80% 50%)`;
          ctx.fillRect(0, 0, 160, 90);
          const f = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / 30), duration: 33333 });
          enc.encode(f, { keyFrame: i === 0 });
          f.close();
        }
        enc.flush().then(() => { enc.close(); resolve(); }, reject);
      });
    } catch (e) {
      row.error = String(e?.message ?? e);
    }
    out.codecs.push(row);
  }
  return out;
}, CODECS);

console.log(JSON.stringify(report, null, 2));
await browser.close();
server.close();
