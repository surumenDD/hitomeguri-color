import { describe, expect, it } from 'vitest';
import { preprocess } from '../palette/preprocess';
import { PRESETS, type Role } from '../script';
import { estimateSetting } from './estimate';

describe('edit estimate before painting', () => {
  it('accepts a static neutral image without requiring a canvas', () => {
    const data = preprocess(new Uint8ClampedArray([128, 128, 128, 255]), 1, 1);
    const result = estimateSetting(
      data,
      data.metadata.palette.map(() => 'middle'),
      PRESETS.day,
    );
    expect(result.pass).toBe(true);
    expect(result.maxClampedPixels).toBe(0);
  });
  it('rejects an excessive residual lightness excursion and area', () => {
    const data = preprocess(new Uint8ClampedArray([200, 200, 200, 255]), 1, 1);
    data.lab[0] = 0.01;
    const roles: Role[] = data.metadata.palette.map(() => 'sky');
    const result = estimateSetting(data, roles, PRESETS.day);
    expect(result.pass).toBe(false);
    expect(result.maxClampedPixels).toBe(1);
    expect(result.maxExcursion).toBeGreaterThan(0.08);
  });
  it('rejects nonfinite and faster-than-supported settings', () => {
    const data = preprocess(new Uint8ClampedArray([128, 128, 128, 255]), 1, 1),
      roles: Role[] = data.metadata.palette.map(() => 'middle');
    expect(estimateSetting(data, roles, { ...PRESETS.day, durationSec: 0.2 }).pass).toBe(false);
    expect(estimateSetting(data, roles, { ...PRESETS.day, glow: NaN }).pass).toBe(false);
    expect(estimateSetting(data, roles, { ...PRESETS.day, nightDepth: 0.199 }).pass).toBe(false);
    expect(estimateSetting(data, roles, { ...PRESETS.day, nightDepth: 4.001 }).pass).toBe(false);
    expect(estimateSetting(data, roles, { ...PRESETS.day, glow: 2.001 }).pass).toBe(false);
  });
});
