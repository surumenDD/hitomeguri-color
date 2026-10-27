import { labToRgb } from '../color';
import type { Decomposition } from '../palette/types';
import { type Preset, type Role, rolePaletteAt, scriptLightnessBounds } from '../script';
import { analyzeFrames, type FlashReport } from './flash';
import { groupLightness, type LightnessGroups } from './groups';

// Near white, 0.003 OKLab L is about one 8-bit sRGB step, below a visible clamp.
export const LIGHTNESS_CLAMP_TOLERANCE = 0.003;

export interface Estimate {
  pass: boolean;
  reason?: string;
  lightnessPotentialPixels: number;
  sampledOutPixels?: number;
  maxClampedPixels?: number;
  maxExcursion?: number;
  sampledMinL?: number;
  sampledMaxL?: number;
  movementLimit: number;
  minL: number;
  maxL: number;
  paletteFlash?: FlashReport;
}
/** No image is rendered: fixed nonnegative weights bound every source pixel algebraically. */
export function estimateSetting(
  source: Decomposition | LightnessGroups,
  roles: Role[],
  preset: Preset,
): Estimate {
  if (
    !Number.isFinite(preset.durationSec) ||
    preset.durationSec < 12 ||
    preset.durationSec > 48 ||
    !Number.isFinite(preset.nightDepth) ||
    !Number.isFinite(preset.glow) ||
    preset.nightDepth < 0.2 ||
    preset.glow < 0 ||
    preset.nightDepth > 4 ||
    preset.glow > 2
  )
    return {
      pass: false,
      reason: '長さは12〜48秒、夜の深さは0.2〜4、灯りの強さは0〜2の範囲で選んでください。',
      lightnessPotentialPixels: 0,
      movementLimit: 0,
      minL: 0,
      maxL: 1,
    };
  const data = 'values' in source ? source : groupLightness(source);
  const palette = data.metadata.palette,
    stride = palette.length + 1;
  const bounds = palette.map((p, k) =>
    scriptLightnessBounds(p, roles[k], preset).map((v) => v - p[0]),
  );
  let count = 0,
    minL = Infinity,
    maxL = -Infinity,
    limit = 1;
  const candidates: number[] = [];
  for (let g = 0; g < data.counts.length; g++) {
    const i = g * stride;
    let lo = data.values[i],
      hi = lo;
    for (let k = 0; k < palette.length; k++) {
      const w = data.values[i + 1 + k];
      lo += w * bounds[k][0];
      hi += w * bounds[k][1];
    }
    minL = Math.min(minL, lo);
    maxL = Math.max(maxL, hi);
    if (lo < -LIGHTNESS_CLAMP_TOLERANCE || hi > 1 + LIGHTNESS_CLAMP_TOLERANCE) {
      count += data.counts[g];
      candidates.push(g);
      const L = data.values[i];
      if (lo < 0) limit = Math.min(limit, L / (L - lo));
      if (hi > 1) limit = Math.min(limit, (1 - L) / (hi - L));
    }
  }
  const frames: Uint8Array[] = [];
  const actual = new Set<number>();
  let sampledOutPixels = 0;
  let actualMin = Infinity,
    actualMax = -Infinity,
    maxClampedPixels = 0;
  for (let frame = 0; frame < Math.ceil(preset.durationSec * 60); frame++) {
    const q = rolePaletteAt(palette, roles, frame / 60, preset);
    frames.push(
      Uint8Array.from(q.flatMap((p) => labToRgb([Math.max(0, Math.min(1, p[0])), p[1], p[2]]))),
    );
    let frameOut = 0;
    for (const g of candidates) {
      const i = g * stride;
      let L = data.values[i];
      for (let k = 0; k < q.length; k++) L += data.values[i + 1 + k] * (q[k][0] - palette[k][0]);
      actualMin = Math.min(actualMin, L);
      actualMax = Math.max(actualMax, L);
      if (L < -LIGHTNESS_CLAMP_TOLERANCE || L > 1 + LIGHTNESS_CLAMP_TOLERANCE) {
        if (!actual.has(g)) {
          actual.add(g);
          sampledOutPixels += data.counts[g];
        }
        frameOut += data.counts[g];
      }
    }
    maxClampedPixels = Math.max(maxClampedPixels, frameOut);
  }
  // Every palette colour occupies a whole WCAG field; no favourable area dilution is assumed.
  const paletteFlash = analyzeFrames(frames, palette.length, 1, 60, {
    blockSize: 1,
    cssPxPerPx: 341,
  });
  const maxExcursion = Math.max(0, -actualMin, actualMax - 1);
  const lightnessPass =
    maxClampedPixels / (data.metadata.width * data.metadata.height) <= 0.005 &&
    maxExcursion <= 0.08;
  const flashPass = paletteFlash.wcag.pass && paletteFlash.itu.pass;
  return {
    pass: lightnessPass && flashPass,
    reason: !lightnessPass
      ? 'この設定では、一部の色が明るさの範囲を超えます。夜の深さを浅くするか、島の役割を変えてください。'
      : flashPass
        ? undefined
        : 'これより短くすると、点滅の基準を超えます。',
    lightnessPotentialPixels: count,
    sampledOutPixels,
    maxClampedPixels,
    maxExcursion,
    sampledMinL: actualMin,
    sampledMaxL: actualMax,
    movementLimit: Math.max(0, Math.min(1, limit)),
    minL,
    maxL,
    paletteFlash,
  };
}
