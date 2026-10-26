export const durationPosition = (seconds: number) => (Math.log(seconds / 12) / Math.log(4)) * 100;
export const positionDuration = (position: number) =>
  Math.round(12 * 4 ** (position / 100) * 10) / 10;
export const glowPosition = (glow: number) => (glow <= 1 ? glow * 50 : 50 + (glow - 1) * 100);
export const positionGlow = (position: number) =>
  position <= 50 ? position / 50 : 1 + (position - 50) / 100;
export const nightLabel = (value: number) =>
  value < 0.5 ? '浅い' : value <= 1.5 ? 'ふつう' : '深い';
export const glowLabel = (value: number) =>
  value < 0.5 ? 'なし' : value <= 1.25 ? 'ふつう' : '強い';
