import { labToRgb } from '../color';
import type { Decomposition } from '../palette/types';
import { type Preset, type Role, rolePaletteAt, scriptLightnessBounds } from '../script';
import { analyzeFrames, type FlashReport } from './flash';

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
export function estimateSetting(data: Decomposition, roles: Role[], preset: Preset): Estimate {
  if (
    !Number.isFinite(preset.durationSec) ||
    preset.durationSec < 12 ||
    preset.durationSec > 48 ||
    !Number.isFinite(preset.nightDepth) ||
    !Number.isFinite(preset.glow) ||
    preset.nightDepth < 0 ||
    preset.glow < 0 ||
    preset.nightDepth > 2 ||
    preset.glow > 1.5
  )
    return {
      pass: false,
      reason: '長さは12〜48秒、夜の深さは0〜2、灯りの強さは0〜1.5の範囲で選んでください。',
      lightnessPotentialPixels: 0,
      movementLimit: 0,
      minL: 0,
      maxL: 1,
    };
  const palette = data.metadata.palette;
  const bounds = palette.map((p, k) =>
    scriptLightnessBounds(p, roles[k], preset).map((v) => v - p[0]),
  );
  let count = 0,
    minL = Infinity,
    maxL = -Infinity,
    limit = 1;
  const candidates: number[] = [];
  for (let i = 0; i < data.lab.length; i += 4) {
    let lo = data.lab[i],
      hi = lo;
    for (let k = 0; k < palette.length; k++) {
      const w = data.weights[Math.floor(k / 4)][i + (k % 4)];
      lo += w * bounds[k][0];
      hi += w * bounds[k][1];
    }
    minL = Math.min(minL, lo);
    maxL = Math.max(maxL, hi);
    if (lo < -1e-7 || hi > 1 + 1e-7) {
      count++;
      candidates.push(i);
      const L = data.lab[i];
      if (lo < 0) limit = Math.min(limit, L / (L - lo));
      if (hi > 1) limit = Math.min(limit, (1 - L) / (hi - L));
    }
  }
  const frames: Uint8Array[] = [];
  const actual = new Set<number>();
  let actualMin = Infinity,
    actualMax = -Infinity,
    maxClampedPixels = 0;
  for (let frame = 0; frame < Math.ceil(preset.durationSec * 60); frame++) {
    const q = rolePaletteAt(palette, roles, frame / 60, preset);
    frames.push(
      Uint8Array.from(q.flatMap((p) => labToRgb([Math.max(0, Math.min(1, p[0])), p[1], p[2]]))),
    );
    let frameOut = 0;
    for (const i of candidates) {
      let L = data.lab[i];
      for (let k = 0; k < q.length; k++)
        L += data.weights[Math.floor(k / 4)][i + (k % 4)] * (q[k][0] - palette[k][0]);
      actualMin = Math.min(actualMin, L);
      actualMax = Math.max(actualMax, L);
      if (L < -1e-7 || L > 1 + 1e-7) {
        actual.add(i / 4);
        frameOut++;
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
    sampledOutPixels: actual.size,
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
