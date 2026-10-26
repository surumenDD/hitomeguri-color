import curation from '../../../assets/hero/roles.json';
import { distance2, type Lab, rgbToLab } from '../color';
import { inferRoles, type Role } from '../script';
import type { Decomposition, Metadata } from './types';

export interface Gate {
  kind: 'line' | 'rect';
  bounds: [number, number, number, number];
  invert: boolean;
  feather: number;
}
export interface Island {
  id: string;
  base: number;
  role: Role;
  gates: Gate[];
}
interface Curation {
  maxDistance: number;
  images: Record<
    string,
    {
      colors: { hex: string; role: Role }[];
      regions?: { rect: [number, number, number, number]; hex: string[]; role: Role }[];
    }
  >;
}
const rules = curation as unknown as Curation;
const hexLab = (hex: string): Lab =>
  rgbToLab(...([1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Lab));
export function nearestColor(palette: Lab[], hex: string): number {
  const p = hexLab(hex);
  let best = -1,
    d = Infinity;
  palette.forEach((q, k) => {
    const e = distance2(p, q);
    if (e < d) {
      d = e;
      best = k;
    }
  });
  return d <= rules.maxDistance ** 2 ? best : -1;
}
export function curate(id: string, metadata: Metadata): Island[] {
  let islands = inferRoles(metadata).map((info, k) => ({
    id: `base-${k}`,
    base: k,
    role: info.role,
    gates: [] as Gate[],
  }));
  const entry = rules.images[id];
  for (const color of entry?.colors ?? []) {
    const k = nearestColor(metadata.palette, color.hex);
    if (k >= 0) islands[k].role = color.role;
  }
  for (const region of entry?.regions ?? [])
    for (const hex of region.hex) {
      const base = nearestColor(metadata.palette, hex),
        index = islands.findIndex((i) => i.base === base && i.gates.length === 0);
      if (index >= 0)
        islands = splitIsland(
          islands,
          index,
          { kind: 'rect', bounds: region.rect, invert: false, feather: 3 },
          region.role,
        );
    }
  return islands;
}
export function splitIsland(
  islands: Island[],
  index: number,
  gate: Gate,
  insideRole: Role,
): Island[] {
  const source = islands[index];
  if (!source) throw new Error('島を選んでください。');
  const pieces = [
    {
      ...source,
      id: `${source.id}-out`,
      gates: [...source.gates, { ...gate, invert: !gate.invert }],
    },
    { ...source, id: `${source.id}-in`, role: insideRole, gates: [...source.gates, gate] },
  ];
  const next = [...islands.slice(0, index), ...pieces, ...islands.slice(index + 1)];
  if (
    next.length > 32 ||
    next.reduce((n, i) => n + i.gates.length, 0) > 64 ||
    next.some((i) => i.gates.length > 8)
  )
    throw new Error('これ以上島を分けられません。');
  return next;
}
const smooth = (v: number) => {
  const u = Math.max(0, Math.min(1, v));
  return u * u * (3 - 2 * u);
};
export function gateAt(g: Gate, x: number, y: number, width: number, height: number): number {
  const f = Math.max(0.001, g.feather),
    [x0, y0, x1, y1] = g.bounds;
  let value = smooth(((y - y0) * height + f) / (2 * f));
  if (g.kind === 'rect')
    value *=
      smooth(((x - x0) * width + f) / (2 * f)) *
      smooth(((x1 - x) * width + f) / (2 * f)) *
      smooth(((y1 - y) * height + f) / (2 * f));
  return g.invert ? 1 - value : value;
}
export function islandWeight(data: Decomposition, island: Island, pixel: number): number {
  const { width, height } = data.metadata,
    p = pixel * 4;
  let w = data.weights[Math.floor(island.base / 4)][p + (island.base % 4)];
  if (w === 0) return 0;
  const x = ((pixel % width) + 0.5) / width,
    y = (Math.floor(pixel / width) + 0.5) / height;
  for (const gate of island.gates) w *= gateAt(gate, x, y, width, height);
  return w;
}
export const sourcePalette = (data: Decomposition, islands: Island[]): Lab[] =>
  islands.map((i) => data.metadata.palette[i.base]);
/** Expand only when spatial edits exist. The source image and alpha remain shared. */
export function materializeIslands(base: Decomposition, islands: Island[]): Decomposition {
  if (islands.length === 16 && islands.every((i, k) => i.base === k && i.gates.length === 0))
    return base;
  const { width, height } = base.metadata,
    n = width * height;
  const weights = Array.from(
    { length: Math.ceil(islands.length / 4) },
    () => new Float32Array(n * 4),
  );
  const counts = new Array<number>(islands.length).fill(0),
    ys = new Array<number>(islands.length).fill(0);
  for (let pixel = 0; pixel < n; pixel++)
    for (let k = 0; k < islands.length; k++) {
      const w = islandWeight(base, islands[k], pixel);
      weights[Math.floor(k / 4)][pixel * 4 + (k % 4)] = w;
      counts[k] += w;
      ys[k] += (w * (Math.floor(pixel / width) + 0.5)) / height;
    }
  return {
    lab: base.lab,
    alpha: base.alpha,
    weights,
    metadata: {
      ...base.metadata,
      palette: sourcePalette(base, islands),
      counts,
      spatial: islands.map((i, k) => ({
        ...base.metadata.spatial[i.base],
        y: ys[k] / Math.max(1e-12, counts[k]),
      })),
      bytes:
        base.lab.byteLength + base.alpha.byteLength + weights.reduce((n, w) => n + w.byteLength, 0),
    },
  };
}
