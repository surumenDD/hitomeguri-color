import { describe, expect, it } from 'vitest';
import { gamutMap, type Lab, labHex, labToLch, labToLinear, lchToLab, rgbToLab } from './index';

/** Reference OKLab values from tools/visual-qa/probe-eval.mjs (REF_OKLAB). */
const REF_OKLAB: { hex: string; rgb: [number, number, number]; lab: Lab }[] = [
  { hex: '#ff0000', rgb: [255, 0, 0], lab: [0.628, 0.2249, 0.1258] },
  { hex: '#00ff00', rgb: [0, 255, 0], lab: [0.8664, -0.2339, 0.1795] },
  { hex: '#0000ff', rgb: [0, 0, 255], lab: [0.452, -0.0325, -0.3115] },
  { hex: '#ffffff', rgb: [255, 255, 255], lab: [1, 0, 0] },
  { hex: '#808080', rgb: [128, 128, 128], lab: [0.5999, 0, 0] },
];

describe('rgbToLab', () => {
  it.each(REF_OKLAB)('matches the reference OKLab for $hex', ({ rgb, lab }) => {
    const got = rgbToLab(rgb[0], rgb[1], rgb[2]);
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(got[i] - lab[i])).toBeLessThanOrEqual(0.001);
    }
  });
});

/** OKLCH targets from tools/visual-qa/probe-eval.mjs (MAPPED_TARGETS). */
const MAPPED_TARGETS: Lab[] = [
  [0.7, 0.4, 150],
  [0.5, 0.05, 30],
];

const hueDistance = (a: number, b: number): number => Math.abs(((a - b + 540) % 360) - 180);

describe('gamutMap', () => {
  it('keeps L and hue, does not raise C, and yields linear sRGB in 0..1', () => {
    for (const target of MAPPED_TARGETS) {
      const [l, c, h] = target;
      const mapped = gamutMap(lchToLab(target));
      const [mappedL, mappedC, mappedH] = labToLch(mapped);

      expect(Math.abs(mappedL - l)).toBeLessThanOrEqual(1e-12);
      expect(mappedC).toBeLessThanOrEqual(c + 1e-12);
      expect(hueDistance(mappedH, h)).toBeLessThanOrEqual(1e-6);

      for (const channel of labToLinear(mapped)) {
        expect(channel).toBeGreaterThanOrEqual(-1e-7);
        expect(channel).toBeLessThanOrEqual(1 + 1e-7);
      }
    }
  });

  it('leaves already in-gamut colors unchanged', () => {
    const inGamut: Lab[] = [
      [0.5, 0.05, 30],
      [0.5, 0.02, 0],
      [0.5, 0, 0],
      [0.7, 0, 0],
    ];

    for (const target of inGamut) {
      const lab = lchToLab(target);
      const mapped = gamutMap(lab);
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(mapped[i] - lab[i])).toBeLessThanOrEqual(1e-12);
      }
    }
  });
});

/** Representative 8-bit sRGB colors, including primaries, gray, and arbitrary samples. */
const RGB_SAMPLES: { hex: string; rgb: [number, number, number] }[] = [
  { hex: '#ff0000', rgb: [255, 0, 0] },
  { hex: '#00ff00', rgb: [0, 255, 0] },
  { hex: '#0000ff', rgb: [0, 0, 255] },
  { hex: '#ffffff', rgb: [255, 255, 255] },
  { hex: '#000000', rgb: [0, 0, 0] },
  { hex: '#808080', rgb: [128, 128, 128] },
  { hex: '#123456', rgb: [18, 52, 86] },
  { hex: '#abcdef', rgb: [171, 205, 239] },
  { hex: '#ff8800', rgb: [255, 136, 0] },
  { hex: '#0f766e', rgb: [15, 118, 110] },
];

describe('labHex', () => {
  it('round-trips representative 8-bit sRGB colors', () => {
    for (const { hex, rgb } of RGB_SAMPLES) {
      const out = labHex(rgbToLab(rgb[0], rgb[1], rgb[2]));
      expect(out).toMatch(/^#[0-9a-f]{6}$/);
      expect(out).toBe(hex);
    }
  });
});
