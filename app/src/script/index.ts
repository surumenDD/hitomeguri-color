import { gamutMap, type Lab } from '../color';
import type { Metadata, Spatial } from '../palette/types';

export const DURATION = 24;
export const ROLES = {
  sky: '空',
  light: '灯り',
  celestial: '天体',
  water: '水',
  shadow: '影',
  middle: '中間',
} as const;
export type Role = keyof typeof ROLES;
export const MOMENTS: [number, string][] = [
  [0, '夕方の始まり'],
  [4.2, '残照'],
  [7.2, '夜の入り'],
  [11.4, '深夜'],
  [14.6, '夜の終わり'],
  [17.2, '夜明け'],
  [20, '朝'],
  [23.6, '夕方へ戻る直前'],
];
export const lch = (L: number, C: number, H: number): Lab => [
  L,
  C * Math.cos((H * Math.PI) / 180),
  C * Math.sin((H * Math.PI) / 180),
];
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const mix = (a: Lab, b: Lab, u: number): Lab => a.map((v, i) => v + (b[i] - v) * u) as Lab;
const smooth = (u: number) => u * u * (3 - 2 * u);

export interface Inference extends Spatial {
  index: number;
  role: Role;
  reason: string;
  L: number;
  C: number;
  H: number;
  area: number;
}
export function inferRoles(
  metadata: Pick<Metadata, 'width' | 'height' | 'palette' | 'counts' | 'spatial'>,
): Inference[] {
  const total = metadata.width * metadata.height;
  return metadata.palette.map((p, k) => {
    const C = Math.hypot(p[1], p[2]),
      H = ((Math.atan2(p[2], p[1]) * 180) / Math.PI + 360) % 360;
    const area = metadata.counts[k] / total,
      s = metadata.spatial[k],
      warm = H >= 25 && H <= 105;
    let role: Role = 'middle',
      reason = 'ほかの条件に届かない中間色';
    if (p[0] < 0.3) {
      role = 'shadow';
      reason = 'L < 0.30 の暗い色';
    } else if (p[0] > 0.8 && area < 0.004 && s.top > 0.85) {
      role = 'celestial';
      reason = '上部に85%以上の、ごく小さく明るい色（月など）';
    } else if (p[0] > 0.73 && C > 0.065 && warm && area < 0.035 && (s.top < 0.6 || area < 0.008)) {
      role = 'light';
      reason = '明るい小面積の暖色、上部優勢の空色を除く';
    } else if (p[0] > 0.46 && C > 0.085 && warm && area < 0.006 && s.top < 0.4) {
      role = 'light';
      reason = '下部の希少な高彩度暖色（灯り・反射の候補）';
    } else if (s.top > 0.56 && p[0] > 0.39) {
      role = 'sky';
      reason = '上部に56%以上、L > 0.39';
    } else if (s.bottom > 0.52 && p[0] > 0.32) {
      role = 'water';
      reason = '下部に52%以上、L > 0.32';
    } else if (p[0] > 0.6 && s.y < 0.52 && C > 0.045) {
      role = 'sky';
      reason = '上寄りの明るい有彩色';
    }
    return { index: k, role, reason, L: p[0], C, H, area, ...s };
  });
}

interface LightState {
  skyCool: Lab;
  skyWarm: Lab;
  shadow: Lab;
  middle: Lab;
  night: number;
  glow: number;
  dawn: number;
}
// Art direction: main's v2. These are transcribed values, not new visual choices.
export const STATES = {
  original: null,
  afterglow: {
    skyCool: [0.86, 0.075, 282],
    skyWarm: [0.92, 0.15, 14],
    shadow: [0.88, 0.05, 276],
    middle: [0.9, 0.85, 0.1],
    night: 0.35,
    glow: 0.55,
    dawn: 0,
  },
  blueHour: {
    skyCool: [0.7, 0.06, 268],
    skyWarm: [0.72, 0.075, 322],
    shadow: [0.74, 0.044, 268],
    middle: [0.76, 0.6, 0.3],
    night: 0.75,
    glow: 0.85,
    dawn: 0,
  },
  midnight: {
    skyCool: [0.5, 0.032, 262],
    skyWarm: [0.5, 0.03, 268],
    shadow: [0.58, 0.03, 262],
    middle: [0.6, 0.36, 0.5],
    night: 1,
    glow: 1,
    dawn: 0,
  },
  lateNight: {
    skyCool: [0.52, 0.036, 252],
    skyWarm: [0.54, 0.034, 252],
    shadow: [0.58, 0.03, 258],
    middle: [0.61, 0.36, 0.5],
    night: 1,
    glow: 1,
    dawn: 0,
  },
  twilight: {
    skyCool: [0.64, 0.05, 256],
    skyWarm: [0.7, 0.1, 22],
    shadow: [0.64, 0.036, 266],
    middle: [0.69, 0.5, 0.35],
    night: 0.8,
    glow: 0.85,
    dawn: 0.25,
  },
  sunrise: {
    skyCool: [0.86, 0.058, 244],
    skyWarm: [0.95, 0.135, 58],
    shadow: [0.8, 0.042, 272],
    middle: [0.86, 0.75, 0.15],
    night: 0.35,
    glow: 0.45,
    dawn: 0.65,
  },
  morning: {
    skyCool: [1.18, 0.07, 236],
    skyWarm: [1.14, 0.055, 96],
    shadow: [0.98, 0.034, 246],
    middle: [1.02, 0.95, 0],
    night: 0,
    glow: 0,
    dawn: 1,
  },
} satisfies Record<string, LightState | null>;
export type StateKey = keyof typeof STATES;
export interface Preset {
  id: string;
  name: string;
  durationSec: number;
  sequence: { key: StateKey; at: number }[];
  nightDepth: number;
  glow: number;
}
export const DAYLIGHT: Preset = {
  id: 'daylight',
  name: '1日の光',
  durationSec: 24,
  nightDepth: 1,
  glow: 1,
  sequence: [
    { key: 'original', at: 0 },
    { key: 'afterglow', at: 2.8 / 24 },
    { key: 'blueHour', at: 5.2 / 24 },
    { key: 'midnight', at: 8.2 / 24 },
    { key: 'lateNight', at: 13.6 / 24 },
    { key: 'twilight', at: 15 / 24 },
    { key: 'sunrise', at: 17.2 / 24 },
    { key: 'morning', at: 20 / 24 },
    { key: 'original', at: 1 },
  ],
};
export const PRESETS = [DAYLIGHT];
const DELAYS: Record<Role, number> = {
  sky: 0,
  water: 0.65,
  shadow: 0.25,
  middle: 0.38,
  light: -0.45,
  celestial: -0.2,
};
function warmth(p: Lab) {
  const C = Math.hypot(p[1], p[2]),
    H = (Math.atan2(p[2], p[1]) * 180) / Math.PI;
  return clamp((C - 0.02) / 0.08, 0, 1) * clamp(Math.cos(((H - 40) * Math.PI) / 180) * 1.25, 0, 1);
}
const darken = (L: number, scale: number) =>
  scale <= 1 ? L * scale + (1 - scale) * 0.14 : L + (1 - L) * (scale - 1) * 2;

function target(p: Lab, role: Role, key: StateKey): Lab {
  const state = STATES[key];
  if (!state) return [...p];
  const L = p[0],
    C = Math.hypot(p[1], p[2]),
    H = ((Math.atan2(p[2], p[1]) * 180) / Math.PI + 360) % 360;
  if (role === 'sky' || role === 'water') {
    const w = warmth(p),
      [sc, cc, hc] = state.skyCool,
      [sw, cw, hw] = state.skyWarm;
    const q = mix(lch(darken(L, sc), cc, hc), lch(darken(L, sw), cw, hw), w);
    if (role === 'water') {
      q[0] -= 0.02 + 0.02 * state.night;
      q[1] *= 0.85;
      q[2] *= 0.85;
    }
    return q;
  }
  if (role === 'light') {
    const glow = state.glow;
    const lit = lch(Math.max(L, 0.74 + 0.08 * glow), 0.1 + 0.05 * glow, 70 - 6 * glow);
    const off = lch(darken(L, 0.78), C * 0.3, H);
    return mix(off, lit, glow);
  }
  if (role === 'celestial') {
    const pale = lch(Math.min(0.93, L + 0.03 * state.night), 0.045, 96);
    return mix(pale, lch(0.8, 0.035, 232), state.dawn);
  }
  if (role === 'shadow') {
    const [s, c, h] = state.shadow;
    return lch(darken(L, s), Math.min(c, C + 0.02), h);
  }
  const [s, cf, blue] = state.middle;
  const kept = lch(darken(L, s), C * cf, H);
  return mix(kept, lch(darken(L, s), C * cf * 0.6, 258), blue);
}

export function rolePaletteAt(
  palette: Lab[],
  roles: Role[],
  seconds: number,
  preset: Preset = DAYLIGHT,
): Lab[] {
  // Non-unit coefficient formulas belong to the main's M2/M3 design.
  if (preset.nightDepth !== 1 || preset.glow !== 1)
    throw new Error('台本の係数の調整は未実装です。');
  const duration = preset.durationSec;
  const sequence = preset.sequence;
  if (
    !Number.isFinite(seconds) ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    roles.length !== palette.length ||
    sequence.length < 2 ||
    sequence[0].key !== 'original' ||
    sequence[0].at !== 0 ||
    sequence[sequence.length - 1].key !== 'original' ||
    sequence[sequence.length - 1].at !== 1 ||
    sequence.some((s, i) => !Number.isFinite(s.at) || (i > 0 && s.at <= sequence[i - 1].at))
  ) {
    throw new Error('台本の時刻と役割を確認してください。');
  }
  return palette.map((p, k) => {
    const role = roles[k];
    const global = ((seconds % duration) + duration) % duration;
    const envelope = Math.sin((Math.PI * global) / duration) ** 2;
    const t = (global - DELAYS[role] * envelope + duration) % duration;
    let segment = 0;
    while (segment < sequence.length - 2 && t >= sequence[segment + 1].at * duration) segment++;
    const start = sequence[segment].at * duration;
    const end = sequence[segment + 1].at * duration;
    const u = smooth((t - start) / (end - start));
    const q = mix(
      target(p, role, sequence[segment].key),
      target(p, role, sequence[segment + 1].key),
      u,
    );
    if (role === 'light') {
      q[0] +=
        0.0012 *
        envelope *
        (Math.sin((2 * Math.PI * global) / (duration / 8)) +
          0.5 * Math.sin((2 * Math.PI * global) / (duration / 5)));
    }
    return gamutMap(q);
  });
}
