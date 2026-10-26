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
    expect([12, 24, 48].map(durationPosition)).toEqual([0, 50, 100]);
    expect([0, 50, 100].map(positionDuration)).toEqual([12, 24, 48]);
  });
  for (const preset of Object.values(PRESETS))
    it(`${preset.id} centres each coefficient on its own default`, () => {
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
