// Tests for flash-check.mjs. Synthetic frames go straight into analyzeFrames(),
// so no ffmpeg or file is involved in any of these cases.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { analyzeFrames } from '../flash-check.mjs';

const BLACK = [0, 0, 0];
const WHITE = [255, 255, 255];

// `count` frames of width w / height h where colorAt(i) gives [r, g, b].
// Identical colors share one buffer, so building long clips stays cheap.
function solidFrames(w, h, count, colorAt) {
  const cache = new Map();
  const frames = [];
  for (let i = 0; i < count; i++) {
    const color = colorAt(i);
    const key = color.join(',');
    let frame = cache.get(key);
    if (!frame) {
      frame = new Uint8Array(w * h * 3);
      for (let p = 0; p < w * h; p++) { frame[p * 3] = color[0]; frame[p * 3 + 1] = color[1]; frame[p * 3 + 2] = color[2]; }
      cache.set(key, frame);
    }
    frames.push(frame);
  }
  return frames;
}

// Square wave: `on` color for `halfPeriod` frames, then `off`, and so on.
function blinkFrames(w, h, count, halfPeriod, on, off = BLACK) {
  return solidFrames(w, h, count, (i) => (Math.floor(i / halfPeriod) % 2 ? on : off));
}

// Black frame with a size x size square at the top-left corner that blinks white.
function squareBlinkFrames(w, h, count, size, halfPeriod) {
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

// (1) Full-screen black/white blink at 2 Hz for 3 s: two flashes per second, both pass.
test('2Hz full-screen black/white blink passes both criteria', () => {
  const fps = 30;
  const frames = blinkFrames(320, 240, fps * 3, fps / 2 / 2, WHITE);
  const r = analyzeFrames(frames, 320, 240, fps);
  assert.equal(r.wcag.pass, true);
  assert.equal(r.itu.pass, true);
  assert.ok(r.wcag.maxFlashesPerSecond <= 3, `flashes/s = ${r.wcag.maxFlashesPerSecond}`);
  assert.ok(r.itu.maxFlashesPerSecond <= 3);
  assert.equal(r.wcag.worstWindow.redFlashes, 0);
});

// (2) Full-screen black/white blink at 5 Hz for 3 s: five flashes per second, both fail.
test('5Hz full-screen black/white blink fails both criteria', () => {
  const fps = 30;
  const frames = blinkFrames(320, 240, fps * 3, 3, WHITE);
  const r = analyzeFrames(frames, 320, 240, fps);
  assert.equal(r.wcag.pass, false);
  assert.equal(r.itu.pass, false);
  assert.equal(r.wcag.rateExceeded, true);
  assert.equal(r.itu.rateExceeded, true);
  assert.ok(r.wcag.worstWindow.flashCount > 3, `flashCount = ${r.wcag.worstWindow.flashCount}`);
});

// (3) Only a 100x100 corner of 1024x768 blinks at 5 Hz: the rate is exceeded but the
// flashing area stays under 25%, so both criteria pass on area.
test('100x100 blinking square inside 1024x768 passes on area', () => {
  const fps = 30;
  const frames = squareBlinkFrames(1024, 768, fps * 3, 100, 3);
  const r = analyzeFrames(frames, 1024, 768, fps);
  assert.equal(r.wcag.pass, true);
  assert.equal(r.itu.pass, true);
  assert.equal(r.wcag.rateExceeded, true);
  assert.equal(r.itu.rateExceeded, true);
  assert.equal(r.wcag.areaExceeded, false);
  assert.equal(r.itu.areaExceeded, false);
  assert.ok(r.wcag.maxConcurrentFlashAreaRatio < 0.25, `field ratio = ${r.wcag.maxConcurrentFlashAreaRatio}`);
  assert.ok(r.itu.maxConcurrentFlashAreaRatio < 0.25, `screen ratio = ${r.itu.maxConcurrentFlashAreaRatio}`);
});

// (4) Full-screen saturated red / black blink at 5 Hz: red flash on the WCAG side and a
// saturated-red transition on the ITU side, both fail.
test('5Hz full-screen saturated red/black blink fails both criteria', () => {
  const fps = 30;
  const frames = blinkFrames(320, 240, fps * 3, 3, [255, 0, 0]);
  const r = analyzeFrames(frames, 320, 240, fps);
  assert.equal(r.wcag.pass, false);
  assert.equal(r.itu.pass, false);
  assert.ok(r.wcag.worstWindow.redFlashes > 0, 'red flashes should be counted');
  assert.ok(r.itu.worstWindow.redFlashes > 0);
  assert.equal(r.wcag.areaExceeded, true);
  assert.equal(r.itu.areaExceeded, true);
});

// (5) A 0.2 Hz light/dark triangle wave: slow enough that no window holds more than
// three flashes, both pass.
test('0.2Hz slow luminance change passes both criteria', () => {
  const fps = 30;
  const period = fps / 0.2; // one full cycle every 5 s
  const frames = solidFrames(160, 120, fps * 6, (i) => {
    const p = (i % period) / (period / 2); // 0..2 triangle
    const v = Math.round(255 * (p < 1 ? p : 2 - p));
    return [v, v, v];
  });
  const r = analyzeFrames(frames, 160, 120, fps);
  assert.equal(r.wcag.pass, true);
  assert.equal(r.itu.pass, true);
  assert.ok(r.wcag.maxFlashesPerSecond <= 3, `flashes/s = ${r.wcag.maxFlashesPerSecond}`);
});

// (6) 5 Hz blink with a relative-luminance difference of 0.05 (black vs gray 63):
// below the 0.1 general flash threshold, so WCAG passes.
test('5Hz blink with 0.05 luminance difference passes WCAG', () => {
  const fps = 30;
  const frames = blinkFrames(320, 240, fps * 3, 3, [63, 63, 63]);
  const r = analyzeFrames(frames, 320, 240, fps);
  assert.equal(r.wcag.pass, true);
  assert.equal(r.wcag.worstWindow.flashCount, 0);
  assert.equal(r.itu.pass, true, '0.05 x 200 cd/m2 = 10 cd/m2 is under the ITU 20 cd/m2 step');
});

// The same 0.05 blink is a fail on the ITU side once peak white is bright enough
// (0.05 x 500 = 25 cd/m2 >= 20 cd/m2), so the --white argument matters.
test('0.05 luminance blink fails ITU at white 500 cd/m2', () => {
  const fps = 30;
  const frames = blinkFrames(320, 240, fps * 3, 3, [63, 63, 63]);
  const r = analyzeFrames(frames, 320, 240, fps, { whiteLuminanceCdM2: 500 });
  assert.equal(r.wcag.pass, true);
  assert.equal(r.itu.pass, false);
  assert.equal(r.itu.rateExceeded, true);
});

// Red vs a neutral gray of similar luminance: no general flash (0.05 step) but the
// red flash threshold sees a saturated red with a large chromaticity difference.
test('5Hz saturated red/gray blink counts red flashes without general flashes', () => {
  const fps = 30;
  const frames = blinkFrames(320, 240, fps * 3, 3, [255, 0, 0], [140, 140, 140]);
  const r = analyzeFrames(frames, 320, 240, fps);
  assert.ok(r.wcag.worstWindow.redFlashes > 0, 'red flashes should be counted');
  assert.equal(r.wcag.worstWindow.generalFlashes, 0);
  assert.equal(r.wcag.pass, false);
});

// No change at all: nothing to count, both pass.
test('static frames pass both criteria', () => {
  const frames = solidFrames(64, 64, 30, () => [80, 120, 200]);
  const r = analyzeFrames(frames, 64, 64, 30);
  assert.equal(r.wcag.pass, true);
  assert.equal(r.itu.pass, true);
  assert.equal(r.wcag.totalFlashes, 0);
  assert.equal(r.wcag.worstWindow.flashCount, 0);
  assert.equal(r.wcag.worstWindow.startSec, null);
});

// A bright band crosses the screen over 8 s: every location brightens and darkens
// just once, so flashes at different places must not add up to a high flash rate.
test('bright band crossing the screen over 8s passes both criteria', () => {
  const w = 160, h = 120, fps = 30, band = 40;
  const speed = (w + band) / 8; // px per second, crossing the screen in 8 s
  const frames = [];
  for (let i = 0; i < fps * 10; i++) {
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
  const r = analyzeFrames(frames, w, h, fps);
  assert.equal(r.wcag.pass, true);
  assert.equal(r.itu.pass, true);
  assert.equal(r.wcag.rateExceeded, false);
  assert.equal(r.itu.rateExceeded, false);
  assert.ok(r.wcag.maxFlashesPerSecond <= 3, `flashes/s = ${r.wcag.maxFlashesPerSecond}`);
  assert.ok(r.itu.maxFlashesPerSecond <= 3);
});

// The repro clips: slowly changing full-screen content must not be counted as a fast
// blink rate. Needs ffmpeg and the clips, so skip when they are not around.
test('slow repro videos pass both criteria', (t) => {
  const dir = path.resolve(import.meta.dirname, '../../../experiments/role-script-spike/out');
  const tool = path.resolve(import.meta.dirname, '../flash-check.mjs');
  const names = ['flat-24s.mp4', 'painterly-24s.mp4'];
  const files = names.map((n) => path.join(dir, n)).filter((p) => fs.existsSync(p));
  const hasFfmpeg = !spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).error;
  if (!files.length || !hasFfmpeg) {
    t.skip('repro videos or ffmpeg not available');
    return;
  }
  for (const file of files) {
    const res = spawnSync(process.execPath, [tool, file], { encoding: 'utf8', maxBuffer: 1 << 24 });
    assert.equal(res.status, 0, `${path.basename(file)}: ${res.stderr}`);
    const r = JSON.parse(res.stdout);
    assert.equal(r.wcag.pass, true, `${path.basename(file)} wcag: ${JSON.stringify(r.wcag)}`);
    assert.equal(r.itu.pass, true, `${path.basename(file)} itu: ${JSON.stringify(r.itu)}`);
    assert.ok(r.wcag.maxFlashesPerSecond <= 3, `${path.basename(file)} flashes/s = ${r.wcag.maxFlashesPerSecond}`);
  }
});
