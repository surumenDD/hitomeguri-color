import { describe, expect, it } from 'vitest';
import { exportSize } from './video';

describe('deterministic export size', () => {
  it('keeps both axes even, fits the long edge and preserves aspect within quantization', () => {
    for (const [w, h] of [
      [1536, 1024],
      [1921, 1081],
      [1000, 3001],
      [1, 1],
    ]) {
      const [x, y] = exportSize(w, h);
      expect(x % 2).toBe(0);
      expect(y % 2).toBe(0);
      expect(Math.max(x, y)).toBeLessThanOrEqual(1920);
      expect(Math.abs(x / y - w / h)).toBeLessThan(0.01);
    }
  });
});
