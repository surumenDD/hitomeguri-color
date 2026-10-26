// Port fidelity tests for src/safety/flash.ts. Synthetic RGB24 frames go straight into
// both the ported analyzeFrames and the frozen Node implementation
// (tools/visual-qa/flash-check.mjs, copied unchanged to test/fixtures/flash/reference.mjs),
// and every field of the two reports must match deeply.
import { describe, expect, it } from 'vitest';
// @ts-expect-error The frozen reference is plain JavaScript copied verbatim from tools/visual-qa.
import { analyzeFrames as analyzeReference } from '../../test/fixtures/flash/reference.mjs';
import { analyzeFrames, type FlashOptions, type FlashReport } from './flash';

type Rgb = readonly [number, number, number];

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

// `count` frames of width w / height h where colorAt(i) gives [r, g, b].
// Identical colors share one buffer, so building long clips stays cheap.
function solidFrames(
  w: number,
  h: number,
  count: number,
  colorAt: (i: number) => Rgb,
): Uint8Array[] {
  const cache = new Map<string, Uint8Array>();
  const frames: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const color = colorAt(i);
    const key = color.join(',');
    let frame = cache.get(key);
    if (!frame) {
      frame = new Uint8Array(w * h * 3);
      for (let p = 0; p < w * h; p++) {
        frame[p * 3] = color[0];
        frame[p * 3 + 1] = color[1];
        frame[p * 3 + 2] = color[2];
      }
      cache.set(key, frame);
    }
    frames.push(frame);
  }
  return frames;
}

// Square wave: `on` color for `halfPeriod` frames, then `off`, and so on.
function blinkFrames(
  w: number,
  h: number,
  count: number,
  halfPeriod: number,
  on: Rgb,
  off: Rgb = BLACK,
): Uint8Array[] {
  return solidFrames(w, h, count, (i) => (Math.floor(i / halfPeriod) % 2 ? on : off));
}

// Black frame with a size x size square at the top-left corner that blinks white.
function squareBlinkFrames(
  w: number,
  h: number,
  count: number,
  size: number,
  halfPeriod: number,
): Uint8Array[] {
  const off = new Uint8Array(w * h * 3);
  const on = new Uint8Array(w * h * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = (y * w + x) * 3;
      on[p] = on[p + 1] = on[p + 2] = 255;
    }
  }
  return Array.from({ length: count }, (_, i) => (Math.floor(i / halfPeriod) % 2 ? on : off));
}

// A bright band sweeping left to right at `speed` px/s for `seconds`.
function movingBandFrames(
  w: number,
  h: number,
  fps: number,
  seconds: number,
  band: number,
  speed: number,
): Uint8Array[] {
  const frames: Uint8Array[] = [];
  for (let i = 0; i < fps * seconds; i++) {
    const frame = new Uint8Array(w * h * 3);
    const x0 = Math.max(0, Math.floor((i / fps) * speed));
    const x1 = Math.min(w, Math.ceil((i / fps) * speed + band));
    for (let y = 0; y < h; y++) {
      for (let x = x0; x < x1; x++) {
        const p = (y * w + x) * 3;
        frame[p] = frame[p + 1] = frame[p + 2] = 255;
      }
    }
    frames.push(frame);
  }
  return frames;
}

/** Runs both implementations and returns the ported report once every field matches. */
function analyzeBoth(
  frames: Uint8Array | readonly Uint8Array[],
  width: number,
  height: number,
  fps: number,
  options?: FlashOptions,
): FlashReport {
  const actual = analyzeFrames(frames, width, height, fps, options);
  const expected = analyzeReference(frames, width, height, fps, options) as FlashReport;
  expect(actual).toEqual(expected);
  return actual;
}

describe('analyzeFrames port', () => {
  it('keeps the report shape of the node implementation', () => {
    const frames = blinkFrames(320, 240, 30, 3, WHITE);
    const r = analyzeBoth(frames, 320, 240, 30);

    expect(Object.keys(r).sort()).toEqual([
      'analysis',
      'durationSec',
      'fps',
      'frameCount',
      'height',
      'itu',
      'wcag',
      'width',
    ]);
    expect(Object.keys(r.analysis).sort()).toEqual([
      'blockSize',
      'cssPxPerPx',
      'minSwing',
      'visualFieldBlocks',
      'visualFieldCssPx',
      'whiteLuminanceCdM2',
    ]);
    expect(Object.keys(r.wcag).sort()).toEqual([
      'areaExceeded',
      'maxConcurrentFlashAreaRatio',
      'maxFlashesPerSecond',
      'maxGeneralFlashesPerSecond',
      'maxRedFlashesPerSecond',
      'minLeadingEdgeGapMs',
      'pass',
      'rateExceeded',
      'totalFlashes',
      'worstWindow',
    ]);
    expect(Object.keys(r.itu).sort()).toEqual(Object.keys(r.wcag).sort());
    expect(Object.keys(r.wcag.worstWindow).sort()).toEqual([
      'endSec',
      'flashCount',
      'generalFlashes',
      'redFlashes',
      'startSec',
    ]);
    expect(r.analysis).toEqual({
      blockSize: 8,
      cssPxPerPx: 1,
      whiteLuminanceCdM2: 200,
      minSwing: 0.01,
      visualFieldCssPx: [341, 256],
      visualFieldBlocks: [40, 30], // 320x240 clips are smaller than the 43x32 visual field
    });
  });

  it('passes static frames with nothing to count', () => {
    const frames = solidFrames(64, 64, 30, () => [80, 120, 200]);
    const r = analyzeBoth(frames, 64, 64, 30);
    expect(r.wcag.pass).toBe(true);
    expect(r.itu.pass).toBe(true);
    expect(r.wcag.totalFlashes).toBe(0);
    expect(r.wcag.worstWindow.flashCount).toBe(0);
    expect(r.wcag.worstWindow.startSec).toBeNull();
    expect(r.wcag.minLeadingEdgeGapMs).toBeNull();
  });

  it('passes a 2Hz full-screen black/white blink', () => {
    const fps = 30;
    const frames = blinkFrames(320, 240, fps * 3, fps / 2 / 2, WHITE);
    const r = analyzeBoth(frames, 320, 240, fps);
    expect(r.wcag.pass).toBe(true);
    expect(r.itu.pass).toBe(true);
    expect(r.wcag.maxFlashesPerSecond).toBeLessThanOrEqual(3);
    expect(r.itu.maxFlashesPerSecond).toBeLessThanOrEqual(3);
    expect(r.wcag.worstWindow.redFlashes).toBe(0);
  });

  it('fails a 5Hz full-screen black/white blink on both criteria', () => {
    const fps = 30;
    const frames = blinkFrames(320, 240, fps * 3, 3, WHITE);
    const r = analyzeBoth(frames, 320, 240, fps);
    expect(r.wcag.pass).toBe(false);
    expect(r.itu.pass).toBe(false);
    expect(r.wcag.rateExceeded).toBe(true);
    expect(r.itu.rateExceeded).toBe(true);
    expect(r.wcag.worstWindow.flashCount).toBeGreaterThan(3);
  });

  it('passes on area when only a 100x100 square inside 1024x768 blinks', () => {
    const fps = 30;
    const frames = squareBlinkFrames(1024, 768, fps * 3, 100, 3);
    const r = analyzeBoth(frames, 1024, 768, fps);
    expect(r.wcag.pass).toBe(true);
    expect(r.itu.pass).toBe(true);
    expect(r.wcag.rateExceeded).toBe(true);
    expect(r.itu.rateExceeded).toBe(true);
    expect(r.wcag.areaExceeded).toBe(false);
    expect(r.itu.areaExceeded).toBe(false);
    expect(r.wcag.maxConcurrentFlashAreaRatio).toBeLessThan(0.25);
    expect(r.itu.maxConcurrentFlashAreaRatio).toBeLessThan(0.25);
    expect(r.analysis.visualFieldBlocks).toEqual([43, 32]);
  });

  it('fails a 5Hz full-screen saturated red/black blink', () => {
    const fps = 30;
    const frames = blinkFrames(320, 240, fps * 3, 3, [255, 0, 0]);
    const r = analyzeBoth(frames, 320, 240, fps);
    expect(r.wcag.pass).toBe(false);
    expect(r.itu.pass).toBe(false);
    expect(r.wcag.worstWindow.redFlashes).toBeGreaterThan(0);
    expect(r.itu.worstWindow.redFlashes).toBeGreaterThan(0);
    expect(r.wcag.areaExceeded).toBe(true);
    expect(r.itu.areaExceeded).toBe(true);
  });

  it('passes a 0.2Hz slow luminance change', () => {
    const fps = 30;
    const period = fps / 0.2; // one full cycle every 5 s
    const frames = solidFrames(160, 120, fps * 6, (i) => {
      const p = (i % period) / (period / 2); // 0..2 triangle
      const v = Math.round(255 * (p < 1 ? p : 2 - p));
      return [v, v, v];
    });
    const r = analyzeBoth(frames, 160, 120, fps);
    expect(r.wcag.pass).toBe(true);
    expect(r.itu.pass).toBe(true);
    expect(r.wcag.maxFlashesPerSecond).toBeLessThanOrEqual(3);
  });

  it('passes a 5Hz blink whose luminance difference is only 0.05', () => {
    const fps = 30;
    const frames = blinkFrames(320, 240, fps * 3, 3, [63, 63, 63]);
    const r = analyzeBoth(frames, 320, 240, fps);
    expect(r.wcag.pass).toBe(true);
    expect(r.wcag.worstWindow.flashCount).toBe(0);
    expect(r.itu.pass).toBe(true); // 0.05 x 200 cd/m2 = 10 cd/m2 is under the ITU 20 cd/m2 step
  });

  it('falls ITU at white 500 cd/m2 for the same 0.05 blink', () => {
    const fps = 30;
    const frames = blinkFrames(320, 240, fps * 3, 3, [63, 63, 63]);
    const r = analyzeBoth(frames, 320, 240, fps, { whiteLuminanceCdM2: 500 });
    expect(r.wcag.pass).toBe(true);
    expect(r.itu.pass).toBe(false);
    expect(r.itu.rateExceeded).toBe(true);
  });

  it('counts red flashes without general flashes for a saturated red/gray blink', () => {
    const fps = 30;
    const frames = blinkFrames(320, 240, fps * 3, 3, [255, 0, 0], [140, 140, 140]);
    const r = analyzeBoth(frames, 320, 240, fps);
    expect(r.wcag.worstWindow.redFlashes).toBeGreaterThan(0);
    expect(r.wcag.worstWindow.generalFlashes).toBe(0);
    expect(r.wcag.pass).toBe(false);
  });

  it('passes when a bright band crosses the screen over 8s', () => {
    const w = 160,
      h = 120,
      fps = 30,
      band = 40;
    const speed = (w + band) / 8; // px per second, crossing the screen in 8 s
    const frames = movingBandFrames(w, h, fps, 10, band, speed);
    const r = analyzeBoth(frames, w, h, fps);
    expect(r.wcag.pass).toBe(true);
    expect(r.itu.pass).toBe(true);
    expect(r.wcag.rateExceeded).toBe(false);
    expect(r.itu.rateExceeded).toBe(false);
    expect(r.wcag.maxFlashesPerSecond).toBeLessThanOrEqual(3);
    expect(r.itu.maxFlashesPerSecond).toBeLessThanOrEqual(3);
  });

  it('matches for block, css scale and swing options on non-divisible sizes', () => {
    const fps = 30;
    const frames = blinkFrames(323, 241, fps * 2, 3, WHITE);
    const r = analyzeBoth(frames, 323, 241, fps, {
      blockSize: 16,
      cssPxPerPx: 2,
      minSwing: 0.2,
    });
    expect(r.analysis.blockSize).toBe(16);
    expect(r.analysis.cssPxPerPx).toBe(2);
    expect(r.analysis.minSwing).toBe(0.2);
    expect(r.analysis.visualFieldBlocks).toEqual([11, 8]);
    expect(r.wcag.rateExceeded).toBe(true);
  });

  it('accepts one flat RGB24 buffer and reads it like per-frame buffers', () => {
    const fps = 30;
    const w = 96,
      h = 64;
    const frames = blinkFrames(w, h, fps, 3, WHITE);
    const flat = new Uint8Array(frames.length * w * h * 3);
    frames.forEach((frame, i) => {
      flat.set(frame, i * w * h * 3);
    });

    const fromFrames = analyzeBoth(frames, w, h, fps);
    const fromFlat = analyzeBoth(flat, w, h, fps);
    expect(fromFlat).toEqual(fromFrames);
    expect(fromFlat.frameCount).toBe(frames.length);
  });

  it('matches for two blinking squares blink out of phase', () => {
    const w = 320,
      h = 240,
      fps = 30,
      size = 60;
    const paint = (frame: Uint8Array, x0: number, y0: number): void => {
      for (let y = y0; y < y0 + size; y++) {
        for (let x = x0; x < x0 + size; x++) {
          const p = (y * w + x) * 3;
          frame[p] = frame[p + 1] = frame[p + 2] = 255;
        }
      }
    };
    const frames = Array.from({ length: fps * 3 }, (_, i) => {
      const frame = new Uint8Array(w * h * 3);
      if (Math.floor(i / 3) % 2 === 1) paint(frame, 0, 0);
      else paint(frame, w - size, h - size);
      return frame;
    });
    const r = analyzeBoth(frames, w, h, fps);
    expect(r.wcag.rateExceeded).toBe(true);
    expect(r.itu.rateExceeded).toBe(true);
    expect(r.wcag.maxFlashesPerSecond).toBeGreaterThan(3);
  });

  it('rejects malformed frame buffers with the original messages', () => {
    expect(() => analyzeFrames(new Uint8Array(10), 64, 64, 30)).toThrow(
      'frame buffer is not a multiple of 12288 bytes',
    );
    expect(() => analyzeFrames([new Uint8Array(5)], 64, 64, 30)).toThrow(
      'frame is 5 bytes, expected 12288',
    );
  });
});
