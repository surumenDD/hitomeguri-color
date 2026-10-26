import { distance2, K, type Lab, rgbToLab } from '../color';
import type { Decomposition, Spatial } from './types';

/** The spike's deterministic, rare-color-weighted k-means, followed by fixed Shepard weights. */
export function preprocess(rgba: Uint8ClampedArray, width: number, height: number): Decomposition {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    rgba.length !== width * height * 4
  ) {
    throw new Error('画像の大きさと画素数が一致しません。');
  }
  const start = performance.now();
  const n = width * height;
  const lab = new Float32Array(n * 4);
  const alpha = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    lab.set(rgbToLab(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]), i * 4);
    alpha[i] = rgba[i * 4 + 3];
  }
  const converted = performance.now();
  const samples: Lab[] = [];
  const sampleCount = Math.min(32768, n);
  for (let i = 0; i < sampleCount; i++) {
    const p = Math.floor(((i + 0.5) * n) / sampleCount) * 4;
    samples.push([lab[p], lab[p + 1], lab[p + 2]]);
  }
  const palette: Lab[] = [[...samples[Math.floor(sampleCount / 2)]]];
  const nearest = new Float64Array(sampleCount).fill(Infinity);
  while (palette.length < K) {
    let farthest = 0;
    const last = palette[palette.length - 1];
    for (let i = 0; i < sampleCount; i++) {
      nearest[i] = Math.min(nearest[i], distance2(samples[i], last));
      if (nearest[i] > nearest[farthest]) farthest = i;
    }
    palette.push([...samples[farthest]]);
  }
  // Extraction-only importance: small amber lights must survive broad blue areas.
  const bin = (p: Lab) => p.map((v, j) => Math.floor(v / (j === 0 ? 0.04 : 0.03))).join(',');
  const bins = new Map<string, number>();
  for (const p of samples) bins.set(bin(p), (bins.get(bin(p)) ?? 0) + 1);
  const sampleWeights = samples.map((p) => 1 / Math.sqrt(bins.get(bin(p)) ?? 1));
  for (let iteration = 0; iteration < 20; iteration++) {
    const sums = Array.from({ length: K }, () => [0, 0, 0, 0]);
    for (let i = 0; i < samples.length; i++) {
      const p = samples[i];
      const weight = sampleWeights[i];
      let index = 0;
      let best = Infinity;
      for (let k = 0; k < K; k++) {
        const d = distance2(p, palette[k]);
        if (d < best) {
          best = d;
          index = k;
        }
      }
      for (let j = 0; j < 3; j++) sums[index][j] += p[j] * weight;
      sums[index][3] += weight;
    }
    let movement = 0;
    for (let k = 0; k < K; k++) {
      if (!sums[k][3]) continue;
      const next = sums[k].slice(0, 3).map((v) => v / sums[k][3]) as Lab;
      movement += distance2(next, palette[k]);
      palette[k] = next;
    }
    if (movement < 1e-10) break;
  }
  const extracted = performance.now();
  const counts = new Uint32Array(K);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    let best = Infinity;
    let index = 0;
    for (let k = 0; k < K; k++) {
      const c = palette[k];
      const d = (lab[p] - c[0]) ** 2 + (lab[p + 1] - c[1]) ** 2 + (lab[p + 2] - c[2]) ** 2;
      if (d < best) {
        best = d;
        index = k;
      }
    }
    lab[p + 3] = index;
    counts[index]++;
  }
  const order = Array.from({ length: K }, (_, i) => i).sort((a, b) => counts[b] - counts[a]);
  const remap = order.map((_, i) => order.indexOf(i));
  const sorted = order.map((i) => palette[i]);
  const sortedCounts = order.map((i) => counts[i]);
  for (let i = 0; i < n; i++) lab[i * 4 + 3] = remap[lab[i * 4 + 3]];
  const mapped = performance.now();
  const weights = Array.from({ length: K / 4 }, () => new Float32Array(n * 4));
  const ds = new Float64Array(K);
  const stats: Spatial[] = Array.from({ length: K }, () => ({ x: 0, y: 0, top: 0, bottom: 0 }));
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    let min = Infinity;
    let exact = -1;
    for (let k = 0; k < K; k++) {
      const c = sorted[k];
      ds[k] = (lab[p] - c[0]) ** 2 + (lab[p + 1] - c[1]) ** 2 + (lab[p + 2] - c[2]) ** 2;
      min = Math.min(min, ds[k]);
      if (ds[k] === 0 && exact < 0) exact = k;
    }
    if (exact >= 0) weights[Math.floor(exact / 4)][p + (exact % 4)] = 1;
    else {
      // Scaling all inverse fourth powers by min(d)^4 leaves the same normalized weights.
      let total = 0;
      for (let k = 0; k < K; k++) total += ds[k] = (min / ds[k]) ** 2;
      for (let k = 0; k < K; k++) weights[Math.floor(k / 4)][p + (k % 4)] = ds[k] / total;
    }
    const s = stats[lab[p + 3]];
    const x = ((i % width) + 0.5) / width;
    const y = (Math.floor(i / width) + 0.5) / height;
    s.x += x;
    s.y += y;
    if (y < 0.48) s.top++;
    if (y > 0.58) s.bottom++;
  }
  const done = performance.now();
  return {
    lab,
    weights,
    alpha,
    metadata: {
      width,
      height,
      palette: sorted,
      counts: sortedCounts,
      spatial: stats.map((s, k) => {
        const count = Math.max(1, sortedCounts[k]);
        return { x: s.x / count, y: s.y / count, top: s.top / count, bottom: s.bottom / count };
      }),
      timing: {
        conversion: converted - start,
        palette: extracted - converted,
        assignment: mapped - extracted,
        weights: done - mapped,
        total: done - start,
      },
      bytes: lab.byteLength + alpha.byteLength + weights.reduce((sum, w) => sum + w.byteLength, 0),
    },
  };
}
