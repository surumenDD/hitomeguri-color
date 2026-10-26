/** OKLab / linear sRGB / OKLCH tuples. sRGB byte APIs explicitly use 0..255. */
export type Lab = [number, number, number];
export const K = 16;
const decode = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const encode = (c: number) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * Math.max(0, c) ** (1 / 2.4) - 0.055;
const LUT = Float64Array.from({ length: 256 }, (_, i) => decode(i / 255));

export function linearToLab([r, g, b]: Lab): Lab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function rgbToLab(r: number, g: number, b: number): Lab {
  return linearToLab([LUT[r], LUT[g], LUT[b]]);
}

export function labToLinear([L, a, b]: Lab): Lab {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function labToLch([L, a, b]: Lab): Lab {
  return [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360];
}
export function lchToLab([L, C, h]: Lab): Lab {
  return [L, C * Math.cos((h * Math.PI) / 180), C * Math.sin((h * Math.PI) / 180)];
}
export const inGamut = (rgb: Lab): boolean => rgb.every((x) => x >= -1e-7 && x <= 1 + 1e-7);

/** Preserves L and hue; L outside [0,1] cannot be repaired with chroma alone. */
export function gamutMap(lab: Lab): Lab {
  if (inGamut(labToLinear(lab))) return [...lab];
  let low = 0;
  let high = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (low + high) / 2;
    if (inGamut(labToLinear([lab[0], lab[1] * mid, lab[2] * mid]))) low = mid;
    else high = mid;
  }
  return [lab[0], lab[1] * low, lab[2] * low];
}
export function labToRgb(lab: Lab): Lab {
  // Only the final byte quantization saturates floating-point tolerance at the boundary.
  return labToLinear(gamutMap(lab)).map((v) =>
    Math.round(Math.min(1, Math.max(0, encode(v))) * 255),
  ) as Lab;
}
export function labHex(lab: Lab): string {
  return `#${labToRgb(lab)
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
}
export const distance2 = (a: Lab, b: Lab): number =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
