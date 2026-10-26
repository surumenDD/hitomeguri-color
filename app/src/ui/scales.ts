export const durationPosition = (seconds: number) => (Math.log(seconds / 12) / Math.log(4)) * 100;
export const positionDuration = (position: number) =>
  Math.round(12 * 4 ** (position / 100) * 10) / 10;
const position = (value: number, normal: number, min: number, max: number) =>
  value <= normal
    ? ((value - min) / (normal - min)) * 50
    : 50 + ((value - normal) / (max - normal)) * 50;
const value = (position: number, normal: number, min: number, max: number) =>
  position <= 50
    ? min + ((normal - min) * position) / 50
    : normal + ((max - normal) * (position - 50)) / 50;
export const nightPosition = (depth: number, normal: number) => position(depth, normal, 0.2, 4);
export const positionNight = (at: number, normal: number) => value(at, normal, 0.2, 4);
export const glowPosition = (glow: number, normal: number) => position(glow, normal, 0, 2);
export const positionGlow = (at: number, normal: number) => value(at, normal, 0, 2);
export const nightLabel = (depth: number, normal: number) =>
  depth < normal * 0.6 ? '浅い' : depth > normal * 1.4 ? '深い' : 'ふつう';
export const glowLabel = (glow: number, normal: number) =>
  glow < 0.3 ? 'なし' : glow > normal * 1.25 ? '強い' : 'ふつう';
