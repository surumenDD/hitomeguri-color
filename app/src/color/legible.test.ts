import { describe, expect, it } from 'vitest';
import { legibleOn } from './legible';

const luminance = (hex: string) =>
  [1, 3, 5].reduce((sum, offset, k) => {
    const c = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return (
      sum + (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][k]
    );
  }, 0);

describe('main-designed clock contrast', () => {
  for (const hex of ['#1f2b44', '#6b486f', '#7e3636'])
    it(`${hex} raises the displayed bytes just enough`, () => {
      const result = legibleOn(hex);
      const ratio = (luminance(result) + 0.05) / (luminance('#181818') + 0.05);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(ratio).toBeLessThan(4.7);
    });
  it('keeps the bright evening horizon unchanged', () => {
    expect(legibleOn('#f27a2f')).toBe('#f27a2f');
  });
});
