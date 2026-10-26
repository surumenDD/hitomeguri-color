import { describe, expect, it } from 'vitest';
import {
  durationPosition,
  glowLabel,
  glowPosition,
  nightLabel,
  positionDuration,
  positionGlow,
} from './scales';

describe('main-designed slider scales', () => {
  it('places 12/24/48 seconds at 0/50/100 and uses equal distances for doubling', () => {
    expect([12, 24, 48].map(durationPosition)).toEqual([0, 50, 100]);
    expect([0, 50, 100].map(positionDuration)).toEqual([12, 24, 48]);
  });
  it('places no/normal/strong light at 0/50/100', () => {
    expect([0, 1, 1.5].map(glowPosition)).toEqual([0, 50, 100]);
    expect([0, 50, 100].map(positionGlow)).toEqual([0, 1, 1.5]);
  });
  it('reads the nearest named tick', () => {
    expect([0, 1, 2].map(nightLabel)).toEqual(['浅い', 'ふつう', '深い']);
    expect([0, 1, 1.5].map(glowLabel)).toEqual(['なし', 'ふつう', '強い']);
    expect(nightLabel(0.8)).toBe('ふつう');
    expect(glowLabel(1.2)).toBe('ふつう');
  });
});
