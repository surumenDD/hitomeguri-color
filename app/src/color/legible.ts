import { type Lab, labHex, rgbToLab } from './index';

const channels = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
const luminance = (hex: string) =>
  channels(hex).reduce((sum, byte, i) => {
    const c = byte / 255;
    return (
      sum + (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i]
    );
  }, 0);

/** Lift only OKLab L in 0.005 steps; judge the final sRGB bytes against the room. */
export function legibleOn(hex: string, background = '#181818', ratio = 4.5): string {
  const bg = luminance(background);
  const passes = (candidate: string) => {
    const y = luminance(candidate);
    return (Math.max(y, bg) + 0.05) / (Math.min(y, bg) + 0.05) >= ratio;
  };
  if (passes(hex)) return hex;
  const [r, g, b] = channels(hex);
  const p = rgbToLab(r, g, b);
  for (let step = 1; step <= 200; step++) {
    const q: Lab = [Math.min(1, p[0] + step * 0.005), p[1], p[2]];
    const candidate = labHex(q);
    if (passes(candidate) || q[0] === 1) return candidate;
  }
  return hex;
}
