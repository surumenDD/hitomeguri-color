import { describe, expect, it } from 'vitest';
import type { Lab } from '../color';
import { preprocess } from './preprocess';
import { shepardWeights } from './weights';

describe('worker decomposition', () => {
  it('packs the same Shepard weights into GPU planes, with spatial counts and alpha', () => {
    const rgba = Uint8ClampedArray.from({ length: 20 * 12 * 4 }, (_, i) =>
      i % 4 === 3 ? (i % 3 ? 255 : 128) : (i * 37) % 256,
    );
    const result = preprocess(rgba, 20, 12);
    expect(result.metadata.palette).toHaveLength(16);
    expect(result.metadata.counts.reduce((a, b) => a + b, 0)).toBe(240);
    for (let i = 0; i < 240; i++) {
      const p = i * 4;
      const color: Lab = [result.lab[p], result.lab[p + 1], result.lab[p + 2]];
      const expected = shepardWeights(color, result.metadata.palette);
      let sum = 0;
      for (let k = 0; k < 16; k++) {
        const weight = result.weights[Math.floor(k / 4)][p + (k % 4)];
        expect(Math.abs(weight - expected[k])).toBeLessThan(1e-7);
        sum += weight;
      }
      expect(sum).toBeCloseTo(1, 6);
      expect(result.alpha[i]).toBe(rgba[p + 3]);
    }
  });
  it('handles a single color and duplicate centers without NaN', () => {
    const result = preprocess(new Uint8ClampedArray([20, 40, 60, 128]), 1, 1);
    expect(result.metadata.counts[0]).toBe(1);
    expect(result.weights[0][0]).toBe(1);
    expect(result.weights.every((plane) => plane.every(Number.isFinite))).toBe(true);
    expect(result.metadata.spatial.every((s) => Object.values(s).every(Number.isFinite))).toBe(
      true,
    );
  });
  it('rejects malformed dimensions before allocating', () => {
    expect(() => preprocess(new Uint8ClampedArray(0), 0, 0)).toThrow();
    expect(() => preprocess(new Uint8ClampedArray(4), 2, 1)).toThrow();
  });
});
