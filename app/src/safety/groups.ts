import type { Lab } from '../color';
import type { Decomposition } from '../palette/types';

/** Only the exact lightness/weight tuples needed by the algebraic safety check. */
export interface LightnessGroups {
  values: Float32Array<ArrayBuffer>;
  counts: Uint32Array<ArrayBuffer>;
  metadata: { width: number; height: number; palette: Lab[] };
}

const cache = new WeakMap<Decomposition, LightnessGroups>();

export function groupLightness(data: Decomposition): LightnessGroups {
  const cached = cache.get(data);
  if (cached) return cached;
  const size = data.metadata.palette.length,
    stride = size + 1,
    pixels = data.lab.length / 4,
    lab = new Uint32Array(data.lab.buffer, data.lab.byteOffset, data.lab.length),
    weights = data.weights.map((w) => new Uint32Array(w.buffer, w.byteOffset, w.length)),
    heads = new Map<number, number>(),
    representatives: number[] = [],
    next: number[] = [],
    counts: number[] = [];
  for (let p = 0; p < pixels; p++) {
    const offset = p * 4;
    let hash = Math.imul(2166136261 ^ lab[offset], 16777619);
    for (let k = 0; k < size; k++)
      hash = Math.imul(hash ^ weights[k >>> 2][offset + (k & 3)], 16777619);
    let group = heads.get(hash) ?? -1;
    search: for (; group !== -1; group = next[group]) {
      const source = representatives[group];
      if (lab[offset] !== lab[source]) continue;
      for (let k = 0; k < size; k++)
        if (weights[k >>> 2][offset + (k & 3)] !== weights[k >>> 2][source + (k & 3)])
          continue search;
      break;
    }
    if (group === -1) {
      group = representatives.length;
      representatives.push(offset);
      counts.push(0);
      next.push(heads.get(hash) ?? -1);
      heads.set(hash, group);
    }
    counts[group]++;
  }
  const values = new Float32Array(representatives.length * stride),
    bits = new Uint32Array(values.buffer);
  for (let g = 0; g < representatives.length; g++) {
    const source = representatives[g],
      target = g * stride;
    bits[target] = lab[source];
    for (let k = 0; k < size; k++) bits[target + 1 + k] = weights[k >>> 2][source + (k & 3)];
  }
  const result = {
    values,
    counts: Uint32Array.from(counts),
    metadata: {
      width: data.metadata.width,
      height: data.metadata.height,
      palette: data.metadata.palette,
    },
  };
  cache.set(data, result);
  return result;
}
