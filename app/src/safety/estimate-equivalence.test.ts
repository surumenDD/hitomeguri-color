import { beforeAll, describe, expect, it } from 'vitest';
import {
  decodeSamples,
  GENERATED_IDS,
  generatedImages,
  SAMPLE_IDS,
} from '../../test/fixtures/estimate/images';
import { estimateSetting as referenceEstimate } from '../../test/fixtures/estimate/reference';
import { type Island, materializeIslands, splitIsland } from '../palette/islands';
import { preprocess } from '../palette/preprocess';
import type { Decomposition } from '../palette/types';
import { inferRoles, PRESETS, type Role } from '../script';
import { estimateSetting } from './estimate';

interface Scene {
  data: Decomposition;
  roles: Role[];
}
const scenes = new Map<string, Scene>();
const modes = ['base', 'split'] as const;
const settings = Object.values(PRESETS).flatMap((preset) =>
  [0.2, 4].flatMap((nightDepth) =>
    [0, 2].flatMap((glow) =>
      [12, 48].map((durationSec) => ({ ...preset, nightDepth, glow, durationSec })),
    ),
  ),
);

beforeAll(async () => {
  const images = [...(await decodeSamples()), ...generatedImages()];
  for (const image of images) {
    const data = preprocess(image.rgba, image.width, image.height);
    const roles = inferRoles(data.metadata).map((info) => info.role);
    scenes.set(`${image.id}/base`, { data, roles });
    let islands: Island[] = roles.map((role, base) => ({
      id: `base-${base}`,
      base,
      role,
      gates: [],
    }));
    islands = splitIsland(
      islands,
      0,
      { kind: 'line', bounds: [0, 0.45, 1, 1], invert: false, feather: 2 },
      'light',
    );
    islands = splitIsland(
      islands,
      1,
      { kind: 'rect', bounds: [0.2, 0.2, 0.8, 0.8], invert: false, feather: 1 },
      'water',
    );
    scenes.set(`${image.id}/split`, {
      data: materializeIslands(data, islands),
      roles: islands.map((island) => island.role),
    });
  }
}, 30_000);

describe('frozen scalar estimate equivalence (samples resized to long edge 32px)', () => {
  for (const id of [...SAMPLE_IDS, ...GENERATED_IDS]) {
    for (const mode of modes) {
      for (const preset of settings) {
        it(`${id}/${mode}/${preset.id}/depth=${preset.nightDepth}/glow=${preset.glow}/seconds=${preset.durationSec}`, () => {
          const scene = scenes.get(`${id}/${mode}`);
          if (!scene) throw new Error(`Missing scene ${id}/${mode}`);
          // Strict deep equality also checks every floating-point value, optional field,
          // Infinity and nested WCAG/ITU report; no rounding or approximate matcher.
          expect(estimateSetting(scene.data, scene.roles, preset)).toStrictEqual(
            referenceEstimate(scene.data, scene.roles, preset),
          );
        });
      }
    }
  }
});

describe('lightness tolerance regressions', () => {
  for (const bound of ['lower', 'upper'] as const) {
    for (const excursion of [0.0029, 0.0031]) {
      for (const stage of ['conservative', 'sampled'] as const) {
        it(`${stage} ${bound} bound brackets the 0.003 tolerance at ${excursion}`, () => {
          const data = preprocess(new Uint8ClampedArray([128, 128, 128, 255]), 1, 1);
          // A controlled residual isolates both tolerance checks from RGB quantization.
          // For sampled checks the full-script bounds force candidate selection,
          // while an original-only sequence holds the actual palette constant.
          const sourceL = stage === 'sampled' ? 0.5 : bound === 'lower' ? 0 : 1;
          data.metadata.palette = [[sourceL, 0, 0]];
          data.weights = [new Float32Array([1, 0, 0, 0])];
          data.lab[0] = bound === 'lower' ? -excursion : 1 + excursion;
          const preset = {
            ...PRESETS.day,
            durationSec: 12,
            glow: 0,
            sequence: [
              { key: 'original' as const, at: 0 },
              { key: 'original' as const, at: 1 },
            ],
          };
          const result = estimateSetting(data, ['middle'], preset);
          expect(result).toStrictEqual(referenceEstimate(data, ['middle'], preset));
          const outside = excursion > 0.003;
          expect(result.lightnessPotentialPixels).toBe(stage === 'sampled' || outside ? 1 : 0);
          expect(result.sampledOutPixels).toBe(outside ? 1 : 0);
          expect(result.maxClampedPixels).toBe(outside ? 1 : 0);
          expect(result.pass).toBe(!outside);
        });
      }
    }
  }

  it('accepts default lightness for a white border covering at least 15% of the image', () => {
    const image = generatedImages().find((candidate) => candidate.id === 'white-border');
    if (!image) throw new Error('Missing white-border image');
    let white = 0;
    for (let i = 0; i < image.rgba.length; i += 4)
      if (image.rgba[i] === 255 && image.rgba[i + 1] === 255 && image.rgba[i + 2] === 255) white++;
    expect(white / (image.width * image.height)).toBeGreaterThanOrEqual(0.15);
    const scene = scenes.get('white-border/base');
    if (!scene) throw new Error('Missing white-border scene');
    const result = estimateSetting(scene.data, scene.roles, PRESETS.day);
    expect(
      (result.maxClampedPixels ?? Infinity) / (image.width * image.height),
    ).toBeLessThanOrEqual(0.005);
    expect(result.maxExcursion).toBeLessThanOrEqual(0.08);
    expect(result).toStrictEqual(referenceEstimate(scene.data, scene.roles, PRESETS.day));
  });

  it('rejects a broad black field at maximum night depth', () => {
    const scene = scenes.get('black-background/base');
    if (!scene) throw new Error('Missing black-background scene');
    const preset = { ...PRESETS.day, nightDepth: 4 };
    const result = estimateSetting(scene.data, scene.roles, preset);
    expect(result.pass).toBe(false);
    expect(result.reason).toContain('明るさの範囲');
    expect(
      (result.maxClampedPixels ?? 0) / (scene.data.metadata.width * scene.data.metadata.height),
    ).toBeGreaterThan(0.005);
    expect(result).toStrictEqual(referenceEstimate(scene.data, scene.roles, preset));
  });
});
