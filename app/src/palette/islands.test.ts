import { describe, expect, it } from 'vitest';
import { gateAt, type Island, materializeIslands, splitIsland } from './islands';
import { preprocess } from './preprocess';

describe('spatial islands', () => {
  it('partitions a palette weight with a smooth half plane and preserves identity sources', () => {
    const data = preprocess(
      Uint8ClampedArray.from({ length: 8 * 8 * 4 }, (_, i) => (i % 4 === 3 ? 255 : (i * 17) % 256)),
      8,
      8,
    );
    const islands: Island[] = data.metadata.palette.map((_, k) => ({
      id: String(k),
      base: k,
      role: 'sky',
      gates: [],
    }));
    const next = splitIsland(
      islands,
      0,
      { kind: 'line', bounds: [0, 0.5, 1, 1], invert: false, feather: 2 },
      'water',
    );
    const expanded = materializeIslands(data, next);
    for (let i = 0; i < 64; i++) {
      let sum = 0;
      for (let k = 0; k < next.length; k++) {
        const w = expanded.weights[Math.floor(k / 4)][i * 4 + (k % 4)];
        expect(w).toBeGreaterThanOrEqual(0);
        sum += w;
      }
      expect(sum).toBeCloseTo(1, 6);
      expect(expanded.weights[0][i * 4] + expanded.weights[0][i * 4 + 1]).toBeCloseTo(
        data.weights[0][i * 4],
        6,
      );
    }
    expect(expanded.metadata.palette[0]).toEqual(expanded.metadata.palette[1]);
  });
  it('rectangles leave distant dunes and shore unchanged', () => {
    const gate = {
      kind: 'rect',
      bounds: [0.06, 0.42, 0.38, 0.6],
      invert: false,
      feather: 3,
    } as const;
    const g = { ...gate, bounds: [...gate.bounds] as [number, number, number, number] };
    expect(gateAt(g, 0.2, 0.5, 1536, 1024)).toBe(1);
    expect(gateAt(g, 0.7, 0.5, 1536, 1024)).toBe(0);
    expect(gateAt(g, 0.2, 0.8, 1536, 1024)).toBe(0);
    expect(gateAt(g, 0.06, 0.5, 1536, 1024)).toBeCloseTo(0.5);
  });
});
