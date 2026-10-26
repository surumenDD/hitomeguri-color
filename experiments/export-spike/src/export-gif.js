// GIF export: fixed 20 fps, quantised palettes. Two palette strategies are supported
// so the report can compare them:
//   'per-frame' — one 256-colour palette per frame (local colour tables, best fidelity)
//   'global'    — one palette sampled across the whole loop (one table, smaller file)
import { GIFEncoder, quantize, applyPalette } from '../node_modules/gifenc/dist/gifenc.esm.js';

const round = (n) => Math.round(n * 10) / 10;

export async function exportGif(scene, canvas, {
  width,
  height,
  fps = 20,
  seconds = 8,
  maxColors = 256,
  paletteMode = 'per-frame',
  sampleFrames = 24,
  log = () => {},
}) {
  const frames = Math.round(fps * seconds);
  scene.setSize(width, height);

  // GIF pixels come back through a 2D canvas: it flips the WebGL buffer for us.
  const scratch = document.createElement('canvas');
  scratch.width = width;
  scratch.height = height;
  const ctx = scratch.getContext('2d', { willReadFrequently: true, alpha: false });

  let renderMs = 0;
  let captureMs = 0;
  let paletteMs = 0;
  let mapMs = 0;
  let writeMs = 0;

  function grab(t) {
    const r0 = performance.now();
    scene.renderAt(t);
    const r1 = performance.now();
    ctx.drawImage(canvas, 0, 0);
    const px = ctx.getImageData(0, 0, width, height).data;
    const r2 = performance.now();
    renderMs += r1 - r0;
    captureMs += r2 - r1;
    return px;
  }

  const gif = GIFEncoder();
  const tStart = performance.now();
  let globalPalette = null;
  let firstPaletteSize = 0;

  if (paletteMode === 'global') {
    const step = Math.max(1, Math.round(frames / sampleFrames));
    // Take every 8th pixel of each sampled frame so the palette sees the whole loop
    // without quantising a million-pixel buffer per frame.
    const stride = 8;
    const per = Math.floor((width * height) / stride);
    const collected = new Uint8Array(per * 4 * Math.ceil(frames / step));
    let w = 0;
    for (let i = 0; i < frames; i += step) {
      const px = grab(i / fps);
      for (let p = 0; p < per * stride; p += stride) {
        collected[w++] = px[p * 4];
        collected[w++] = px[p * 4 + 1];
        collected[w++] = px[p * 4 + 2];
        collected[w++] = 255;
      }
      log(`  gif palette sample ${i}/${frames}`);
    }
    const q0 = performance.now();
    globalPalette = quantize(collected.subarray(0, w), maxColors, { format: 'rgb565' });
    paletteMs += performance.now() - q0;
  }

  for (let i = 0; i < frames; i++) {
    const px = grab(i / fps);
    let palette = globalPalette;
    if (!palette) {
      const q0 = performance.now();
      palette = quantize(px, maxColors, { format: 'rgb565' });
      paletteMs += performance.now() - q0;
    }
    const mapMsStart = performance.now();
    const index = applyPalette(px, palette, 'rgb565');
    mapMs += performance.now() - mapMsStart;
    if (!firstPaletteSize) firstPaletteSize = palette.length;
    const w0 = performance.now();
    gif.writeFrame(index, width, height, {
      palette,
      delay: 1000 / fps,
      repeat: 0, // loop forever; gifenc only writes this on the first frame
    });
    writeMs += performance.now() - w0;
    if (i % 40 === 0) log(`  gif frame ${i}/${frames}`);
  }
  gif.finish();
  const tEnd = performance.now();

  const bytes = gif.bytes();
  const totalMs = tEnd - tStart;
  return {
    blob: new Blob([bytes], { type: 'image/gif' }),
    stats: {
      format: 'gif',
      width,
      height,
      fps,
      seconds,
      frames,
      delayMs: 1000 / fps,
      maxColors,
      paletteMode,
      paletteEntries: globalPalette ? globalPalette.length : firstPaletteSize,
      paletteSampledFrames: paletteMode === 'global' ? Math.ceil(frames / Math.max(1, Math.round(frames / sampleFrames))) : null,
      paletteMs: round(paletteMs),
      renderMs: round(renderMs),
      captureMs: round(captureMs),
      mapMs: round(mapMs),
      writeMs: round(writeMs),
      totalMs: round(totalMs),
      msPerFrame: round(totalMs / frames),
      encodeFps: round((frames * 1000) / totalMs),
      bytes: bytes.length,
    },
  };
}
