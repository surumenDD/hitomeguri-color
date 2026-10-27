import { describe, expect, it } from 'vitest';
import { estimateSetting as referenceEstimate } from '../../test/fixtures/estimate/reference';
import { materializeIslands, splitIsland } from '../palette/islands';
import { preprocess } from '../palette/preprocess';
import { PRESETS } from '../script';
import { estimateSetting } from './estimate';
import { groupLightness } from './groups';

const image = (n: number) => preprocess(new Uint8ClampedArray(n * 4).fill(128), n, 1);

describe('exact lightness tuples', () => {
  it('multiplies every potential, sampled and per-frame out-of-range count by group size', () => {
    const data = image(8);
    // A repeated residual is deliberately below its palette so all eight copies leave [0,1].
    for (let p = 0; p < 8; p++) data.lab[p * 4] = 0.01;
    const roles = data.metadata.palette.map(() => 'sky' as const),
      result = estimateSetting(data, roles, PRESETS.day);
    expect(groupLightness(data).counts.length).toBe(1);
    expect(result.lightnessPotentialPixels).toBe(8);
    expect(result.sampledOutPixels).toBe(8);
    expect(result.maxClampedPixels).toBe(8);
    expect(result).toStrictEqual(referenceEstimate(data, roles, PRESETS.day));
  });

  it('ignores chroma, alpha and source labels, and counts each identical tuple once', () => {
    const data = image(4);
    data.lab[1] = 0.2;
    data.lab[6] = -0.3;
    data.lab[11] = 15;
    data.alpha[3] = 0;
    const groups = groupLightness(data);
    expect(Array.from(groups.counts)).toEqual([4]);
    expect(groups.values.length).toBe(17);
    expect(groupLightness(data)).toBe(groups);
  });

  it('keeps signed zero and single-bit differences as distinct groups', () => {
    const data = image(4),
      lab = new Uint32Array(data.lab.buffer),
      weights = new Uint32Array(data.weights[0].buffer);
    lab[0] = 0;
    lab[4] = 0x80000000;
    weights[12] = weights[8] + 1;
    const groups = groupLightness(data),
      bits = new Uint32Array(groups.values.buffer);
    expect(Array.from(groups.counts)).toEqual([1, 1, 1, 1]);
    expect(bits[0]).toBe(0);
    expect(bits[17]).toBe(0x80000000);
    expect(bits[3 * 17 + 1]).toBe(weights[12]);
  });

  it('checks equality after a hash collision instead of merging different tuples', () => {
    const data = image(4),
      lab = new Uint32Array(data.lab.buffer),
      weights = new Uint32Array(data.weights[0].buffer);
    for (const w of data.weights) w.fill(0);
    // These two finite L/weight pairs collide under the 17-word FNV hash.
    const pairs = [
      [1057536830, 1045270408],
      [1058204865, 1045380069],
    ];
    for (let p = 0; p < 4; p++) {
      lab[p * 4] = pairs[p % 2][0];
      weights[p * 4] = pairs[p % 2][1];
    }
    const groups = groupLightness(data);
    expect(Array.from(groups.counts)).toEqual([2, 2]);
    const bits = new Uint32Array(groups.values.buffer);
    expect([bits[0], bits[1], bits[17], bits[18]]).toEqual(pairs.flat());
  });

  it('includes every weight after spatial splitting increases the palette above sixteen', () => {
    const base = image(8),
      islands = base.metadata.palette.map((_, k) => ({
        id: String(k),
        base: k,
        role: 'middle' as const,
        gates: [],
      })),
      split = splitIsland(
        islands,
        15,
        { kind: 'line', bounds: [0, 0.5, 1, 1], invert: false, feather: 3 },
        'water',
      ),
      data = materializeIslands(base, split);
    data.weights[4][0] = 0.25;
    const groups = groupLightness(data);
    expect(groups.values.length).toBe(groups.counts.length * 18);
    expect(groups.values[17]).toBe(0.25);
    expect(groups.counts.reduce((a, b) => a + b, 0)).toBe(8);
  });
});
