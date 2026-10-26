// Page entry point. The node runner drives everything through `window.spike`:
// it opens this page over http://127.0.0.1 (WebCodecs needs a secure context),
// asks for reference frames, then asks for one export per format/size.
import { createScene, LOOP_SECONDS } from './loop-scene.js';
import { exportVideo } from './export-video.js';
import { exportGif } from './export-gif.js';

const canvas = document.getElementById('stage');
const status = document.getElementById('status');
const scene = createScene(canvas);

const params = new URLSearchParams(location.search);
if (params.has('w') && params.has('h')) {
  scene.setSize(Number(params.get('w')), Number(params.get('h')));
}

let rafId = 0;
const previewWanted = params.get('preview') !== '0';

function startPreview() {
  if (!previewWanted || rafId) return;
  const tick = (now) => {
    scene.renderAt((now / 1000) % LOOP_SECONDS);
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}

function stopPreview() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
}

// Files land on disk through the runner's tiny HTTP server: the page POSTs a Blob,
// node writes it under experiments/export-spike/out/.
async function upload(name, blob) {
  const res = await fetch(`/upload/${name}`, { method: 'POST', body: blob });
  if (!res.ok) throw new Error(`upload ${name} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

function gpuInfo() {
  const gl = scene.gl;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : null,
    renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
  };
}

async function smokeTest() {
  // Proves the encoder really emits chunks, not just that the config is accepted.
  const out = [];
  for (const [label, codec, extra] of [
    ['H.264 High 5.1', 'avc1.640033', { avc: { format: 'avc' } }],
    ['VP9 level 4.0', 'vp09.00.40.08', {}],
  ]) {
    const config = { codec, width: 320, height: 180, bitrate: 600_000, framerate: 30, ...extra };
    const row = { label, codec, supported: false, chunks: 0, bytes: 0, keyframes: 0, hasDescription: false, error: null };
    try {
      const s = await VideoEncoder.isConfigSupported(config);
      row.supported = !!s.supported;
      if (!row.supported) { out.push(row); continue; }
      scene.setSize(320, 180);
      await new Promise((resolve, reject) => {
        const enc = new VideoEncoder({
          output: (chunk, meta) => {
            row.chunks++;
            row.bytes += chunk.byteLength;
            if (chunk.type === 'key') row.keyframes++;
            if (meta?.decoderConfig?.description) row.hasDescription = true;
          },
          error: reject,
        });
        enc.configure(config);
        for (let i = 0; i < 12; i++) {
          scene.renderAt(i / 30);
          const f = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / 30), duration: 33333 });
          enc.encode(f, { keyFrame: i === 0 });
          f.close();
        }
        enc.flush().then(() => { enc.close(); resolve(); }, reject);
      });
    } catch (e) {
      row.error = String(e?.message ?? e);
    }
    out.push(row);
  }
  scene.setSize(1280, 720);
  return out;
}

async function capabilityMatrix() {
  const cases = [
    { label: 'H.264 High 5.1 @1080p', config: { codec: 'avc1.640033', width: 1920, height: 1080, bitrate: 8_000_000, framerate: 30, avc: { format: 'avc' } } },
    { label: 'H.264 High 4.0 @720p', config: { codec: 'avc1.640028', width: 1280, height: 720, bitrate: 4_000_000, framerate: 30 } },
    { label: 'VP9 level 4.0 @1080p', config: { codec: 'vp09.00.40.08', width: 1920, height: 1080, bitrate: 8_000_000, framerate: 30 } },
    { label: 'VP9 level 3.1 @720p', config: { codec: 'vp09.00.31.08', width: 1280, height: 720, bitrate: 4_000_000, framerate: 30 } },
  ];
  const out = [];
  for (const c of cases) {
    try {
      const s = await VideoEncoder.isConfigSupported(c.config);
      out.push({ label: c.label, codec: c.config.codec, supported: !!s.supported });
    } catch (e) {
      out.push({ label: c.label, codec: c.config.codec, supported: false, error: String(e?.message ?? e) });
    }
  }
  return out;
}

window.spike = {
  loopSeconds: LOOP_SECONDS,
  gpu: gpuInfo(),

  setSize(width, height) {
    stopPreview();
    scene.setSize(width, height);
    scene.renderAt(0);
    return { width, height };
  },

  renderAt(t) {
    scene.renderAt(t);
  },

  hashFrames({ width, height, times }) {
    stopPreview();
    // Pin the size first: the hash covers the whole backbuffer, so a different
    // canvas size would look like drift even when the drawing is identical.
    scene.setSize(width, height);
    return times.map((t) => ({ t, hash: (scene.renderAt(t), scene.hashFrame()) }));
  },

  // Reference frames for PSNR/SSIM: lossless PNGs of exactly what the encoder sees.
  async captureReferenceFrames({ fps, seconds, prefix }) {
    stopPreview();
    const frames = Math.round(fps * seconds);
    const t0 = performance.now();
    let uploadMs = 0;
    for (let i = 0; i < frames; i++) {
      scene.renderAt(i / fps);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      const u0 = performance.now();
      await upload(`${prefix}/f${String(i).padStart(4, '0')}.png`, blob);
      uploadMs += performance.now() - u0;
      if (i % 40 === 0) console.log(`reference ${prefix}: ${i}/${frames}`);
    }
    return { frames, ms: Math.round(performance.now() - t0), uploadMs: Math.round(uploadMs) };
  },

  // Single lossless frame, used to compare t=0 against t=8 (should be identical:
  // the loop is a pure function of t modulo 8 s).
  async captureStill({ t, name }) {
    stopPreview();
    const loopedT = scene.renderAt(t);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    await upload(name, blob);
    return { name, bytes: blob.size, t, loopedT };
  },

  async exportVideo(options) {
    stopPreview();
    const { blob, stats } = await exportVideo(scene, canvas, {
      ...options,
      log: (m) => console.log(m.trim()),
    });
    await upload(options.name, blob);
    return stats;
  },

  async exportGif(options) {
    stopPreview();
    const { blob, stats } = await exportGif(scene, canvas, {
      ...options,
      log: (m) => console.log(m.trim()),
    });
    await upload(options.name, blob);
    return stats;
  },

  capabilityMatrix,
  smokeTest,
};

if (status) {
  status.textContent = `WebGL2 / ${gpuInfo().renderer ?? 'unknown renderer'} / loop ${LOOP_SECONDS}s`;
}
startPreview();
window.__spikeReady = true;
