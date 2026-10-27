import { writeFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeSamples, SAMPLE_IDS, type TestImage } from '../../test/fixtures/estimate/images';
import { estimateSetting as referenceEstimate } from '../../test/fixtures/estimate/reference';
import { materializeIslands, splitIsland } from '../palette/islands';
import { preprocess } from '../palette/preprocess';
import type { Decomposition } from '../palette/types';
import { inferRoles, PRESETS, type Preset, type Role } from '../script';
import { estimateSetting } from './estimate';
import { groupLightness } from './groups';

const enabled = process.env.HITOMEGURI_NATIVE_ESTIMATE === '1',
  evidence: {
    id: string;
    width: number;
    height: number;
    groups: number;
    largestGroup: number;
    comparisons: number;
    ms: number;
  }[] = [];

function compare(data: Decomposition, roles: Role[], preset: Preset) {
  expect(estimateSetting(data, roles, preset)).toStrictEqual(
    referenceEstimate(data, roles, preset),
  );
}

function record(id: string, data: Decomposition, comparisons: number, start: number) {
  const groups = groupLightness(data);
  evidence.push({
    id,
    width: data.metadata.width,
    height: data.metadata.height,
    groups: groups.counts.length,
    largestGroup: groups.counts.reduce((a, b) => Math.max(a, b), 0),
    comparisons,
    ms: performance.now() - start,
  });
}

function repeatedImage(id: string): TestImage {
  const width = 512,
    height = 512,
    rgba = new Uint8ClampedArray(width * height * 4),
    colors = [
      [52, 85, 108],
      [83, 143, 172],
      [29, 52, 76],
      [199, 151, 109],
    ];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const border = x < 20 || x >= width - 20 || y < 20 || y >= height - 20,
        line = (x + y * 2) % 19 === 0,
        black = x < Math.ceil(width * 0.6),
        rgb =
          id === 'border' && border
            ? [255, 255, 255]
            : id === 'lines' && line
              ? [255, 255, 255]
              : id === 'black' && black
                ? [0, 0, 0]
                : colors[Math.floor(y / 128)];
      rgba.set([...rgb, 255], (y * width + x) * 4);
    }
  return { id, width, height, rgba };
}

// Run separately to avoid adding native scalar scans to every routine npm test:
// $env:HITOMEGURI_NATIVE_ESTIMATE='1'; npx vitest run src/safety/estimate-native.test.ts
describe.skipIf(!enabled)('native-size frozen estimate comparisons', () => {
  let samples: TestImage[];
  beforeAll(async () => {
    samples = await decodeSamples(Infinity);
  }, 60_000);
  for (const id of SAMPLE_IDS)
    it(`${id}: native pixels, three preset defaults`, () => {
      const image = samples.find((s) => s.id === id);
      if (!image) throw new Error(`Missing native sample ${id}`);
      expect(Math.max(image.width, image.height)).toBeGreaterThan(32);
      const start = performance.now(),
        data = preprocess(image.rgba, image.width, image.height),
        roles = inferRoles(data.metadata).map((r) => r.role);
      for (const preset of Object.values(PRESETS)) compare(data, roles, preset);
      record(id, data, 3, start);
    }, 120_000);

  for (const id of ['border', 'lines', 'black'])
    it(`512×512 ${id}: repeated tuples, four settings, base and split`, () => {
      const image = repeatedImage(id),
        start = performance.now(),
        base = preprocess(image.rgba, image.width, image.height),
        roles = inferRoles(base.metadata).map((r) => r.role),
        islands = roles.map((role, k) => ({ id: String(k), base: k, role, gates: [] })),
        pieces = splitIsland(
          islands,
          0,
          { kind: 'line', bounds: [0, 0.5, 1, 1], invert: false, feather: 3 },
          'water',
        ),
        split = materializeIslands(base, pieces),
        settings = [
          PRESETS.day,
          { ...PRESETS.day, nightDepth: 4 },
          { ...PRESETS.day, glow: 2 },
          { ...PRESETS.day, durationSec: 12 },
        ];
      for (const preset of settings) {
        compare(base, roles, preset);
        compare(
          split,
          pieces.map((i) => i.role),
          preset,
        );
      }
      expect(groupLightness(base).counts.length).toBeLessThan(10);
      expect(groupLightness(base).counts.some((n) => n >= 10_000)).toBe(true);
      record(`generated-${id}`, base, 4, start);
      record(`generated-${id}-split`, split, 4, start);
    }, 120_000);

  afterAll(async () => {
    console.log(`Native estimate comparisons: ${JSON.stringify(evidence)}`);
    await writeFile(
      new URL('../../test/fixtures/estimate/native-results.json', import.meta.url),
      `${JSON.stringify({ when: new Date().toISOString(), evidence }, null, 2)}\n`,
    );
  });
});
