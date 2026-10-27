import { type Lab, labHex } from '../color';
import type { Metadata } from '../palette/types';
import { type Preset, type Role, rolePaletteAt } from './index';

// Warmth exactly as the spike prototype (experiments/ui-mock/strip.mjs): no clamping is added.
const warm = (p: Lab): number => {
  const C = Math.hypot(p[1], p[2]);
  const H = (Math.atan2(p[2], p[1]) * 180) / Math.PI;
  return Math.max(0, (C - 0.02) / 0.08) * Math.max(0, Math.cos(((H - 40) * Math.PI) / 180));
};

// The overhead band follows the most widespread sky colour; without a sky it falls back to index 0.
export function pickOverhead(roles: Role[], counts: number[]): number {
  let best = 0;
  let bestCount = 0;
  let found = false;
  for (let k = 0; k < roles.length; k++) {
    if (roles[k] !== 'sky') continue;
    if (!found || counts[k] > bestCount) {
      best = k;
      bestCount = counts[k];
      found = true;
    }
  }
  return found ? best : 0;
}

// The horizon band follows the warmest sky or water colour weighted by the square root of its
// area; without a candidate it falls back to index 0.
export function pickHorizon(palette: Lab[], roles: Role[], counts: number[]): number {
  let best = 0;
  let bestScore = 0;
  let found = false;
  for (let k = 0; k < roles.length; k++) {
    if (roles[k] !== 'sky' && roles[k] !== 'water') continue;
    const score = warm(palette[k]) * Math.sqrt(counts[k]);
    if (!found || score > bestScore) {
      best = k;
      bestScore = score;
      found = true;
    }
  }
  return found ? best : 0;
}

/**
 * Builds the two-band colour strip: the upper band follows the largest sky colour, the lower band
 * the warmest sky or water colour weighted by the square root of its area. Each band is a CSS
 * gradient of `n` samples taken from `rolePaletteAt` at `t = i / n * durationSec`, with stop
 * percentages `i / (n - 1) * 100` rounded to two decimals.
 */
export function buildStrip(
  metadata: Pick<Metadata, 'palette' | 'counts'>,
  roles: Role[],
  preset: Preset,
  n = 64,
): { upper: string; lower: string; overhead: number; horizon: number } {
  const { palette, counts } = metadata;
  const overhead = pickOverhead(roles, counts);
  const horizon = pickHorizon(palette, roles, counts);
  const upperStops: string[] = [];
  const lowerStops: string[] = [];
  for (let i = 0; i < n; i++) {
    const q = rolePaletteAt(palette, roles, (i / n) * preset.durationSec, preset);
    const at = `${((i / (n - 1)) * 100).toFixed(2)}%`;
    upperStops.push(`${labHex(q[overhead])} ${at}`);
    lowerStops.push(`${labHex(q[horizon])} ${at}`);
  }
  return {
    upper: `linear-gradient(90deg, ${upperStops.join(', ')})`,
    lower: `linear-gradient(90deg, ${lowerStops.join(', ')})`,
    overhead,
    horizon,
  };
}

/** The lower-band colour at an arbitrary second, i.e. the horizon index at that time. */
export function horizonAt(
  metadata: Pick<Metadata, 'palette' | 'counts'>,
  roles: Role[],
  preset: Preset,
  seconds: number,
): string {
  const horizon = pickHorizon(metadata.palette, roles, metadata.counts);
  return labHex(rolePaletteAt(metadata.palette, roles, seconds, preset)[horizon]);
}
