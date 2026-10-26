import { describe, expect, it } from 'vitest';
import { type Lab, labHex } from '../color';
import type { Metadata } from '../palette/types';
import { DAYLIGHT, type Role, rolePaletteAt } from './index';
import { buildStrip, horizonAt } from './strip';

type Input = Pick<Metadata, 'palette' | 'counts'>;

// Stops of a `linear-gradient(90deg, ...)` band as colour / percentage pairs.
function stopsOf(gradient: string): { color: string; at: string }[] {
  expect(gradient.startsWith('linear-gradient(90deg, ')).toBe(true);
  expect(gradient.endsWith(')')).toBe(true);
  return gradient
    .slice('linear-gradient(90deg, '.length, -1)
    .split(', ')
    .map((stop) => {
      const [color, at] = stop.split(' ');
      return { color, at };
    });
}

// A small fixed picture: a dull middle colour, a cool sky, a warm sky, warm water and a lamp.
const palette: Lab[] = [
  [0.55, 0.02, 0.02],
  [0.62, -0.05, -0.08],
  [0.5, 0.1, 0.02],
  [0.45, 0.09, -0.02],
  [0.7, 0.11, 0.06],
];
const counts = [10, 300, 200, 50, 5];
const roles: Role[] = ['middle', 'sky', 'sky', 'water', 'light'];
const metadata: Input = { palette, counts };

describe('buildStrip', () => {
  it('follows the largest sky overhead and the warmest sky-or-water colour at the horizon', () => {
    const strip = buildStrip(metadata, roles, DAYLIGHT);
    // The cool sky (index 1) is the most widespread sky; the warm sky (index 2) is the warmest.
    expect(strip.overhead).toBe(1);
    expect(strip.horizon).toBe(2);
    expect(strip.upper).not.toBe(strip.lower);
  });

  it('weights warmth by the square root of the area, not by counts or warmth alone', () => {
    // Counts alone would keep the cool sky (index 1) at the horizon instead of the warm sky.
    expect(buildStrip(metadata, roles, DAYLIGHT).horizon).toBe(2);
    // Warmth alone would keep the first sky although the second has the larger weighted score.
    const tiny: Input = {
      palette: [
        [0.5, 0.1, 0.02],
        [0.5, 0.06, 0.05],
      ],
      counts: [4, 100],
    };
    expect(buildStrip(tiny, ['sky', 'sky'], DAYLIGHT).horizon).toBe(1);
  });

  it('lets a water colour carry the horizon band when it is the warmest', () => {
    const waterFirst: Input = {
      palette: [
        [0.62, -0.05, -0.08],
        [0.5, 0.1, 0.02],
      ],
      counts: [500, 8],
    };
    const strip = buildStrip(waterFirst, ['sky', 'water'], DAYLIGHT);
    expect(strip.overhead).toBe(0);
    expect(strip.horizon).toBe(1);
  });

  it('falls back to the first palette index when a band has no candidate', () => {
    const strip = buildStrip(
      metadata,
      ['middle', 'light', 'shadow', 'celestial', 'middle'],
      DAYLIGHT,
    );
    expect(strip.overhead).toBe(0);
    expect(strip.horizon).toBe(0);
    // Without any sky the overhead band falls back to index 0 even when it holds water.
    const waterOnly = buildStrip(
      metadata,
      ['middle', 'water', 'middle', 'middle', 'middle'],
      DAYLIGHT,
    );
    expect(waterOnly.overhead).toBe(0);
    expect(waterOnly.horizon).toBe(1);
  });

  it('breaks selection ties in favour of the earlier palette index like the prototype', () => {
    const tie: Input = {
      palette: [
        [0.5, 0.1, 0.02],
        [0.5, 0.1, 0.02],
      ],
      counts: [30, 30],
    };
    const strip = buildStrip(tie, ['sky', 'sky'], DAYLIGHT);
    expect(strip.overhead).toBe(0);
    expect(strip.horizon).toBe(0);
  });

  it('samples 64 points and ends both bands at 100.00%', () => {
    const strip = buildStrip(metadata, roles, DAYLIGHT);
    const upper = stopsOf(strip.upper);
    const lower = stopsOf(strip.lower);
    expect(upper).toHaveLength(64);
    expect(lower).toHaveLength(64);
    expect(upper[0].at).toBe('0.00%');
    expect(upper[63].at).toBe('100.00%');
    expect(lower[0].at).toBe('0.00%');
    expect(lower[63].at).toBe('100.00%');
    for (let i = 0; i < 64; i++) {
      const at = `${((i / 63) * 100).toFixed(2)}%`;
      expect(upper[i].at).toBe(at);
      expect(lower[i].at).toBe(at);
    }
  });

  it('keeps the sample count and the percentages of an explicit n', () => {
    const strip = buildStrip(metadata, roles, DAYLIGHT, 5);
    expect(stopsOf(strip.upper).map((s) => s.at)).toEqual([
      '0.00%',
      '25.00%',
      '50.00%',
      '75.00%',
      '100.00%',
    ]);
    expect(stopsOf(strip.upper)).toHaveLength(5);
    expect(stopsOf(strip.lower)).toHaveLength(5);
  });

  it('takes every stop colour from rolePaletteAt at the chosen index', () => {
    const strip = buildStrip(metadata, roles, DAYLIGHT);
    const upper = stopsOf(strip.upper);
    const lower = stopsOf(strip.lower);
    for (let i = 0; i < 64; i++) {
      const q = rolePaletteAt(palette, roles, (i / 64) * DAYLIGHT.durationSec, DAYLIGHT);
      expect(upper[i].color).toBe(labHex(q[strip.overhead]));
      expect(lower[i].color).toBe(labHex(q[strip.horizon]));
    }
  });

  it('never averages the palette: the first stops are the raw chosen colours', () => {
    const strip = buildStrip(metadata, roles, DAYLIGHT);
    const q0 = rolePaletteAt(palette, roles, 0, DAYLIGHT);
    const upper = stopsOf(strip.upper);
    const lower = stopsOf(strip.lower);
    expect(upper[0].color).toBe(labHex(q0[strip.overhead]));
    expect(lower[0].color).toBe(labHex(q0[strip.horizon]));
    const mean = [0, 1, 2].map((j) => q0.reduce((s, p) => s + p[j], 0) / q0.length) as Lab;
    expect(upper[0].color).not.toBe(labHex(mean));
    expect(lower[0].color).not.toBe(labHex(mean));
  });
});

describe('horizonAt', () => {
  it('returns the horizon colour at the requested second', () => {
    const strip = buildStrip(metadata, roles, DAYLIGHT);
    for (const seconds of [0, 3.7, 11.4, 23.6]) {
      const q = rolePaletteAt(palette, roles, seconds, DAYLIGHT);
      expect(horizonAt(metadata, roles, DAYLIGHT, seconds)).toBe(labHex(q[strip.horizon]));
    }
  });

  it('agrees with the lower band at the sample times', () => {
    const strip = buildStrip(metadata, roles, DAYLIGHT);
    const lower = stopsOf(strip.lower);
    for (let i = 0; i < lower.length; i++) {
      expect(horizonAt(metadata, roles, DAYLIGHT, (i / 64) * DAYLIGHT.durationSec)).toBe(
        lower[i].color,
      );
    }
  });
});
