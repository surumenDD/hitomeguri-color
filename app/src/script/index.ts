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

export const STATES = [
  'original',
  'afterglow',
  'blueHour',
  'midnight',
  'lateNight',
  'twilight',
  'sunrise',
  'morning',
] as const;
export type StateKey = (typeof STATES)[number];
export interface Preset {
  id: string;
  name: string;
  durationSec: number;
  sequence: { key: StateKey; at: number }[];
  nightDepth: number;
  glow: number;
}
const DELAYS: Record<Role, number> = {
  sky: 0,
  water: 0.65,
  shadow: 0.25,
  middle: 0.38,
  light: -0.45,
  celestial: -0.2,
};
const night = [0, 0.35, 0.75, 1, 1, 0.8, 0.35, 0];
const GLOW = [0, 0.55, 0.85, 1, 1, 0.85, 0.45, 0];
const DAWN = [0, 0, 0, 0, 0, 0.25, 0.65, 1];

// nightDepth and glow are 1 for the tuned look; the day preset at 1 reproduces v2 exactly.
export const PRESETS: Record<string, Preset> = {
  day: {
    id: 'day',
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
  },
  // The magic hour breathes: the sky sinks into the blue hour and rises back into the afterglow.
  longDusk: {
    id: 'longDusk',
    name: '長い夕暮れ',
    durationSec: 20,
    nightDepth: 0.85,
    glow: 1,
    sequence: [
      { key: 'original', at: 0 },
      { key: 'afterglow', at: 0.3 },
      { key: 'blueHour', at: 0.55 },
      { key: 'afterglow', at: 0.8 },
      { key: 'original', at: 1 },
    ],
  },
  // Most of the loop is night, so the lamps carry the picture.
  nightLights: {
    id: 'nightLights',
    name: '夜の灯り',
    durationSec: 32,
    nightDepth: 1.1,
    glow: 1.25,
    sequence: [
      { key: 'original', at: 0 },
      { key: 'afterglow', at: 0.09 },
      { key: 'blueHour', at: 0.2 },
      { key: 'midnight', at: 0.38 },
      { key: 'lateNight', at: 0.6 },
      { key: 'midnight', at: 0.76 },
      { key: 'blueHour', at: 0.9 },
      { key: 'original', at: 1 },
    ],
  },
};

// How much of a colour belongs to the warm side of the scene (horizon, glow, reflections).
function warmth(p: Lab) {
  const C = Math.hypot(p[1], p[2]),
    H = (Math.atan2(p[2], p[1]) * 180) / Math.PI;
  return clamp((C - 0.02) / 0.08, 0, 1) * clamp(Math.cos(((H - 40) * Math.PI) / 180) * 1.25, 0, 1);
}
// Below 1 the scale darkens and lifts the floor so the deepest residuals stay above zero.
// Above 1 it moves the colour toward white, which keeps the original order of values.
const darken = (L: number, scale: number) =>
  scale <= 1 ? L * scale + (1 - scale) * 0.14 : L + (1 - L) * (scale - 1) * 2;

// [scale, chroma, hue] per key for the cool overhead sky and for the warm horizon.
// v3: midnight and late night are a saturated indigo; at chroma .03 they read as slate grey.
const SKY_COOL: (Lab | null)[] = [
  null,
  [0.86, 0.075, 282],
  [0.7, 0.06, 268],
  [0.5, 0.055, 266],
  [0.52, 0.052, 258],
  [0.64, 0.05, 256],
  [0.86, 0.058, 244],
  [1.18, 0.07, 236],
  null,
];
const SKY_WARM: (Lab | null)[] = [
  null,
  [0.92, 0.15, 14],
  [0.72, 0.075, 322],
  [0.5, 0.05, 272],
  [0.54, 0.05, 262],
  [0.7, 0.1, 22],
  [0.95, 0.135, 58],
  [1.14, 0.055, 96],
  null,
];
// [scale, chroma, hue] for shadows: violet at dusk, near-black blue at night, cool at dawn.
const SHADOW: (Lab | null)[] = [
  null,
  [0.88, 0.05, 276],
  [0.74, 0.044, 268],
  [0.58, 0.04, 266],
  [0.58, 0.04, 262],
  [0.64, 0.036, 266],
  [0.8, 0.042, 272],
  [0.98, 0.034, 246],
  null,
];
// [scale, chroma factor, pull toward night blue] for everything else.
const MIDDLE: (Lab | null)[] = [
  null,
  [0.9, 0.85, 0.1],
  [0.76, 0.6, 0.3],
  [0.6, 0.36, 0.5],
  [0.61, 0.36, 0.5],
  [0.69, 0.5, 0.35],
  [0.86, 0.75, 0.15],
  [1.02, 0.95, 0],
  null,
];

function target(p: Lab, role: Role, key: number, o: Preset): Lab {
  if (key === 0) return p.slice() as Lab;
  // nightDepth scales how far the night-weighted states darken (1 keeps the tuned values).
  const deep = (scale: number) =>
    scale <= 1 ? 1 - (1 - scale) * (1 + (o.nightDepth - 1) * night[key]) : scale;
  const L = p[0],
    C = Math.hypot(p[1], p[2]),
    H = ((Math.atan2(p[2], p[1]) * 180) / Math.PI + 360) % 360;
  if (role === 'sky' || role === 'water') {
    const w = warmth(p),
      [sc, cc, hc] = SKY_COOL[key] as Lab,
      [sw, cw, hw] = SKY_WARM[key] as Lab;
    const q = mix(lch(darken(L, deep(sc)), cc, hc), lch(darken(L, deep(sw)), cw, hw), w);
    if (role === 'water') {
      q[0] -= 0.02 + 0.02 * night[key];
      q[1] *= 0.85;
      q[2] *= 0.85;
    }
    return q;
  }
  if (role === 'light') {
    // Lamps come on with the afterglow, burn amber through the night and go out by morning.
    // v4: each lamp keeps its own hue and leans 35% toward amber, so red lanterns stay red.
    const glow = GLOW[key] * o.glow,
      on = Math.min(1, glow),
      amber = 70 - 6 * on;
    const hue = H + (((amber - H + 540) % 360) - 180) * 0.35;
    // Reds lit too brightly turn pink, so red-orange lamps get a lower floor than amber ones.
    const yellowish = clamp((H - 35) / 30, 0, 1),
      floor = (0.66 + 0.06 * glow) * (1 - yellowish) + (0.74 + 0.08 * glow) * yellowish;
    const lit = lch(Math.min(0.93, Math.max(L, floor)), Math.max(C * 0.95, 0.1 + 0.05 * glow), hue);
    const off = lch(darken(L, deep(0.78 - 0.4 * night[key])), C * 0.3, H);
    return mix(off, lit, on);
  }
  if (role === 'celestial') {
    // The moon cools to a pale white at night and dissolves into the morning sky.
    const pale = lch(Math.min(0.93, L + 0.03 * night[key]), 0.045, 96);
    return mix(pale, lch(0.8, 0.035, 232), DAWN[key]);
  }
  if (role === 'shadow') {
    const [s, c, h] = SHADOW[key] as Lab;
    return lch(darken(L, deep(s)), Math.min(c, C + 0.02), h);
  }
  const [s, cf, blue] = MIDDLE[key] as Lab;
  const kept = lch(darken(L, deep(s)), C * cf, H);
  return mix(kept, lch(darken(L, deep(s)), C * cf * 0.6, 258), blue);
}

export const DAYLIGHT = PRESETS.day;
/** Target L extrema bound the entire eased script, including role delay and lamp oscillation. */
export function scriptLightnessBounds(p: Lab, role: Role, preset: Preset): [number, number] {
  const values = STATES.map((_, key) => target(p, role, key, preset)[0]);
  const oscillation = role === 'light' ? 0.0018 * preset.glow : 0;
  return [Math.min(...values) - oscillation, Math.max(...values) + oscillation];
}
export function rolePaletteAt(
  palette: Lab[],
  roles: Role[],
  seconds: number,
  preset: Preset = PRESETS.day,
): Lab[] {
  const D = preset.durationSec,
    seq = preset.sequence.map(({ key, at }) => [STATES.indexOf(key), at * D]);
  return palette.map((p, k) => {
    const role = roles[k];
    // A smooth phase envelope returns to zero delay at the loop seam.
    const global = ((seconds % D) + D) % D;
    const envelope = Math.sin((Math.PI * global) / D) ** 2;
    const t = (global - DELAYS[role] * envelope + D) % D;
    let s = 0;
    while (s < seq.length - 2 && t >= seq[s + 1][1]) s++;
    const u = smooth((t - seq[s][1]) / (seq[s + 1][1] - seq[s][1]));
    const q = mix(target(p, role, seq[s][0], preset), target(p, role, seq[s + 1][0], preset), u);
    if (role === 'light') {
      // Periods of D/8 and D/5 divide the loop, so the flicker joins at the seam (3 s and 4.8 s at 24 s).
      q[0] +=
        0.0012 *
        preset.glow *
        envelope *
        (Math.sin((2 * Math.PI * global) / (D / 8)) +
          0.5 * Math.sin((2 * Math.PI * global) / (D / 5)));
    }
    return gamutMap(q);
  });
}
