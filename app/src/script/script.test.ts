import { describe, expect, it } from 'vitest';
import type { Lab } from '../color';
import { DAYLIGHT, DURATION, inferRoles, MOMENTS, ROLES, rolePaletteAt } from './index';

describe('daylight script', () => {
  const roles = Object.keys(ROLES) as (keyof typeof ROLES)[];
  const palette: Lab[] = roles.map((_, i) => [0.3 + i * 0.08, 0.05, -0.03]);
  it('keeps the original palette at both loop endpoints for every role', () => {
    expect(rolePaletteAt(palette, roles, 0)).toEqual(palette);
    expect(rolePaletteAt(palette, roles, DURATION)).toEqual(palette);
    expect(DAYLIGHT.sequence.map((s) => s.at)).toEqual([
      0,
      2.8 / 24,
      5.2 / 24,
      8.2 / 24,
      13.6 / 24,
      15 / 24,
      17.2 / 24,
      20 / 24,
      1,
    ]);
  });
  it('is periodic and keeps all eight named moments finite for every role', () => {
    for (const [t] of MOMENTS) {
      const q = rolePaletteAt(palette, roles, t);
      expect(q.every((p) => p.every(Number.isFinite))).toBe(true);
      const next = rolePaletteAt(palette, roles, t + 24);
      q.forEach((p, k) => {
        p.forEach((v, j) => {
          expect(next[k][j]).toBeCloseTo(v, 12);
        });
      });
    }
  });
  it('is continuous across the seam even when duration changes', () => {
    const preset = { ...DAYLIGHT, durationSec: 36 };
    const a = rolePaletteAt(palette, roles, 1e-6, preset);
    const b = rolePaletteAt(palette, roles, 36 - 1e-6, preset);
    a.forEach((p, k) => {
      p.forEach((v, j) => {
        expect(b[k][j]).toBeCloseTo(v, 6);
      });
    });
  });
  it('recognizes the v2 celestial rule before the warm lamp rule', () => {
    const result = inferRoles({
      width: 1000,
      height: 1000,
      palette: [[0.87, 0.05, 0.05]],
      counts: [1000],
      spatial: [{ x: 0.7, y: 0.1, top: 0.95, bottom: 0.01 }],
    });
    expect(result[0].role).toBe('celestial');
  });
});
