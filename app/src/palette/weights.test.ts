import { describe, expect, it } from 'vitest';
import type { Lab } from '../color';
import { shepardWeights } from './weights';

/** Sixteen distinct OKLab points; a unique L keeps every point distinct. */
const PALETTE: Lab[] = Array.from({ length: 16 }, (_, i) => [
  0.2 + 0.04 * i,
  0.08 * ((i % 5) - 2),
  0.06 * ((i % 7) - 3),
]);

/** Deterministic pixels, none of them on a palette point. */
const PIXELS: Lab[] = [
  [0.5, 0, 0],
  [0.42, 0.03, -0.04],
  [0.74, -0.06, 0.05],
  [0.28, 0.07, 0.02],
  [0.9, 0.01, -0.01],
];

describe('shepardWeights', () => {
  it('is exercised with a 16-point palette of distinct points', () => {
    expect(PALETTE).toHaveLength(16);
    expect(new Set(PALETTE.map((p) => p.join(','))).size).toBe(16);
  });

  it('returns finite, non-negative weights that sum to one', () => {
    for (const p of PIXELS) {
      const weights = shepardWeights(p, PALETTE);
      expect(weights).toHaveLength(16);

      let sum = 0;
      for (const w of weights) {
        expect(Number.isFinite(w)).toBe(true);
        expect(w).toBeGreaterThanOrEqual(0);
        sum += w;
      }
      expect(Math.abs(sum - 1)).toBeLessThanOrEqual(1e-12);
    }
  });

  it('assigns a one-hot weight to the matching palette point', () => {
    PALETTE.forEach((p, index) => {
      const weights = shepardWeights(p, PALETTE);
      weights.forEach((w, k) => {
        expect(w).toBe(k === index ? 1 : 0);
      });
    });
  });

  it('splits 16:1 for two points at a 1:2 distance ratio (exponent -4)', () => {
    const p: Lab = [0.5, 0, 0];
    const near: Lab = [0.5, 0.1, 0];
    const far: Lab = [0.5, 0, 0.2];
    const weights = shepardWeights(p, [near, far]);

    expect(weights).toHaveLength(2);
    expect(Math.abs(weights[0] - 16 / 17)).toBeLessThanOrEqual(1e-12);
    expect(Math.abs(weights[1] - 1 / 17)).toBeLessThanOrEqual(1e-12);
    expect(weights[0] / weights[1]).toBeCloseTo(16, 10);
  });
});
