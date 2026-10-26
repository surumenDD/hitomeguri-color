import { describe, expect, it } from 'vitest';
import { PRESETS } from '../script';
import {
  durationPosition,
  glowLabel,
  glowPosition,
  nightLabel,
  nightPosition,
  positionDuration,
  positionGlow,
  positionNight,
} from './scales';

describe('v4.2 slider scales', () => {
  it('keeps the duration logarithmic around 24 seconds', () => {
    for (const x of [0, 1, 25, 50, 75, 99, 100]) {
      const seconds = 12 * 4 ** (x / 100);
      expect(durationPosition(seconds, 24)).toBeCloseTo(x, 12);
      expect(positionDuration(x, 24)).toBe(Math.round(seconds * 10) / 10);
    }
  });
  for (const preset of Object.values(PRESETS))
    it(`${preset.id} centres each coefficient on its own default`, () => {
      const normal = preset.durationSec;
      expect([12, normal, 48].map((x) => durationPosition(x, normal))).toEqual([0, 50, 100]);
      expect([0, 50, 100].map((x) => positionDuration(x, normal))).toEqual([12, normal, 48]);
      expect(durationPosition(Math.sqrt(12 * normal), normal)).toBeCloseTo(25, 12);
      expect(durationPosition(Math.sqrt(normal * 48), normal)).toBeCloseTo(75, 12);
      expect(positionDuration(25, normal)).toBe(Math.round(Math.sqrt(12 * normal) * 10) / 10);
      expect(positionDuration(75, normal)).toBe(Math.round(Math.sqrt(normal * 48) * 10) / 10);
      for (const seconds of [12, 16, 20, 24, 32, 40, 48])
        expect(positionDuration(durationPosition(seconds, normal), normal)).toBe(seconds);
      expect([0.2, preset.nightDepth, 4].map((x) => nightPosition(x, preset.nightDepth))).toEqual([
        0, 50, 100,
      ]);
      expect([0, preset.glow, 2].map((x) => glowPosition(x, preset.glow))).toEqual([0, 50, 100]);
      expect([0, 50, 100].map((x) => positionNight(x, preset.nightDepth))).toEqual([
        0.2,
        preset.nightDepth,
        4,
      ]);
      expect([0, 50, 100].map((x) => positionGlow(x, preset.glow))).toEqual([0, preset.glow, 2]);
      for (const x of [12, 25, 75, 92]) {
        expect(nightPosition(positionNight(x, preset.nightDepth), preset.nightDepth)).toBeCloseTo(
          x,
          12,
        );
        expect(glowPosition(positionGlow(x, preset.glow), preset.glow)).toBeCloseTo(x, 12);
      }
      expect(nightLabel(preset.nightDepth * 0.6 - 0.001, preset.nightDepth)).toBe('浅い');
      expect(nightLabel(preset.nightDepth * 0.6, preset.nightDepth)).toBe('ふつう');
      expect(nightLabel(preset.nightDepth * 1.4, preset.nightDepth)).toBe('ふつう');
      expect(nightLabel(preset.nightDepth * 1.4 + 0.001, preset.nightDepth)).toBe('深い');
      expect(glowLabel(0.299, preset.glow)).toBe('なし');
      expect(glowLabel(0.3, preset.glow)).toBe('ふつう');
      expect(glowLabel(preset.glow * 1.25, preset.glow)).toBe('ふつう');
      expect(glowLabel(preset.glow * 1.25 + 0.001, preset.glow)).toBe('強い');
    });
});
