import { describe, expect, it } from 'vitest';
import { type Lab, rgbToLab } from './color';
import {
  adaptForeground,
  FOREGROUND_DEFAULTS,
  foregroundBounds,
  foregroundLight,
  OPAQUE_FOREGROUND,
  prepareForeground,
} from './foreground';
import { PRESETS, type Role, rolePaletteAt } from './script';

const palette: Lab[] = [
  [0.72, 0.03, -0.04],
  [0.55, -0.02, 0.03],
  [0.45, 0.01, 0.02],
  [0.62, 0.02, 0.01],
];
const roles: Role[] = ['sky', 'water', 'middle', 'sky'];
const metadata = { palette, counts: [1200, 500, 300, 200] };

describe('foreground light at the script endpoints', () => {
  it('is identity at the beginning and end of all three presets, using both strip colours', () => {
    expect(FOREGROUND_DEFAULTS.blend).toBe(0.8);
    const sample: Lab = [0.42, 0.04, -0.03];
    for (const preset of Object.values(PRESETS)) {
      for (const seconds of [0, preset.durationSec]) {
        const current = rolePaletteAt(palette, roles, seconds, preset);
        const light = foregroundLight(metadata, roles, current);
        expect(light.k).toBe(1);
        expect(light.shift).toEqual([0, 0]);
        expect(adaptForeground(sample, light, FOREGROUND_DEFAULTS.blend)).toEqual(sample);
      }
    }
  });
});

describe('zero blend', () => {
  it('keeps every foreground pixel unchanged at arbitrary times', () => {
    const colors: Lab[] = [
      [0.1, 0.02, -0.01],
      [0.5, 0.08, 0.03],
      [0.95, -0.02, 0.04],
    ];
    for (const preset of Object.values(PRESETS)) {
      for (const fraction of [0.11, 0.37, 0.81]) {
        const current = rolePaletteAt(palette, roles, preset.durationSec * fraction, preset);
        const light = foregroundLight(metadata, roles, current);
        for (const color of colors) expect(adaptForeground(color, light, 0)).toEqual(color);
      }
    }
  });
});

describe('lightness guardrail', () => {
  it('keeps L between 0.35 L and 1 over the whole k, L and f range', () => {
    for (const L of [0, 0.08, 0.2, 0.35, 0.5, 0.73, 0.9, 1]) {
      for (const k of [0.05, 0.2, 0.5, 0.99, 1, 1.0001, 1.16, 1.25]) {
        for (const f of [0, 0.2, 0.65, 0.85, 1]) {
          const [out] = adaptForeground([L, 0.03, -0.02], { k, shift: [0.02, -0.01] }, f);
          expect(out).toBeGreaterThanOrEqual(0.35 * L - 1e-12);
          expect(out).toBeLessThanOrEqual(1 + 1e-12);
        }
      }
    }
  });

  it('floors a night-dark pixel at 0.35 L and caps a brightened white at 1', () => {
    expect(adaptForeground([0.9, 0, 0], { k: 0.05, shift: [0, 0] }, 1)[0]).toBeCloseTo(0.315, 12);
    expect(adaptForeground([1, 0, 0], { k: 1.25, shift: [0, 0] }, 1)[0]).toBe(1);
  });

  it('clamps the brightness ratio to 0.05..1.25 and keeps k = 1 for a black start sky', () => {
    const dim = foregroundLight({ palette: [[0.2, 0, 0]], counts: [10] }, ['sky'], [[0.01, 0, 0]]);
    const bright = foregroundLight(
      { palette: [[0.2, 0, 0]], counts: [10] },
      ['sky'],
      [[0.9, 0, 0]],
    );
    const black = foregroundLight(
      { palette: [[0, 0, 0]], counts: [10] },
      ['sky'],
      [[0, 0.02, -0.04]],
    );
    expect(dim.k).toBe(0.05);
    expect(bright.k).toBe(1.25);
    expect(black.k).toBe(1);
    expect(black.shift).toEqual([0.02, -0.04]);
  });
});

describe('foreground adaptation formula', () => {
  it('applies the documented darkening, desaturation and half sky shift exactly', () => {
    const f = 0.8;
    const k = 0.33;
    const [L, a, b] = adaptForeground([0.6, 0.04, 0.03], { k, shift: [0.05, -0.02] }, f);
    const c = 1 - 0.35 * f * (1 - k);
    expect(L).toBeCloseTo(0.2784, 12);
    expect(L / 0.6).toBeCloseTo(0.464, 12);
    expect(a).toBeCloseTo(0.04 * c + 0.5 * f * 0.05, 12);
    expect(b).toBeCloseTo(0.03 * c + 0.5 * f * -0.02, 12);
  });

  it('keeps full chroma when the sky is not darker than at the start', () => {
    const [L, a, b] = adaptForeground([0.5, 0.08, 0.02], { k: 1.2, shift: [0.04, -0.02] }, 1);
    expect(L).toBeCloseTo(0.6, 12);
    expect(a).toBeCloseTo(0.08 + 0.02, 12);
    expect(b).toBeCloseTo(0.02 - 0.01, 12);
  });
});

describe('foreground light without a sky', () => {
  it('returns k = 1 and no shift, leaving the foreground untouched', () => {
    const noSky: Role[] = ['water', 'light', 'middle'];
    const light = foregroundLight({ palette: palette.slice(0, 3), counts: [10, 20, 30] }, noSky, [
      [0.2, 0.01, 0.02],
      [0.8, 0.1, 0.05],
      [0.4, 0, 0],
    ]);
    expect(light).toEqual({ k: 1, shift: [0, 0] });
    expect(adaptForeground([0.37, 0.06, -0.04], light, 1)).toEqual([0.37, 0.06, -0.04]);
  });
});

describe('overhead and horizon reference light', () => {
  const skyPalette: Lab[] = [
    [0.8, 0.02, -0.04],
    [0.7, -0.01, -0.08],
    [0.75, 0.12, 0.1],
    [0.6, 0.01, 0.01],
  ];
  const skyMetadata = { palette: skyPalette, counts: [100, 900, 800, 30] };
  const current: Lab[] = [
    [0.4, 0.2, 0.1],
    [0.56, -0.04, 0.05],
    [0.5, 0, 0],
    [0.3, 0.01, 0.01],
  ];

  it('averages the largest sky and the warm water horizon in OKLab', () => {
    const light = foregroundLight(skyMetadata, ['sky', 'sky', 'water', 'sky'], current);
    expect(light.k).toBeCloseTo((0.56 + 0.5) / (0.7 + 0.75), 12);
    expect(light.shift[0]).toBeCloseTo((-0.04 + 0) / 2 - (-0.01 + 0.12) / 2, 12);
    expect(light.shift[1]).toBeCloseTo((0.05 + 0) / 2 - (-0.08 + 0.1) / 2, 12);
  });

  it('follows a role change to the larger of the changed skies', () => {
    const light = foregroundLight(skyMetadata, ['sky', 'water', 'water', 'sky'], current);
    expect(light.k).toBeCloseTo((0.4 + 0.5) / (0.8 + 0.75), 12);
    expect(light.shift[0]).toBeCloseTo(0.2 / 2 - (0.02 + 0.12) / 2, 12);
    expect(light.shift[1]).toBeCloseTo(0.1 / 2 - (-0.04 + 0.1) / 2, 12);
  });

  it('follows a role change to a sky that was not the largest picture colour', () => {
    const light = foregroundLight(skyMetadata, ['water', 'water', 'water', 'sky'], current);
    expect(light.k).toBeCloseTo((0.3 + 0.5) / (0.6 + 0.75), 12);
    expect(light.shift[0]).toBeCloseTo(0.01 / 2 - (0.01 + 0.12) / 2, 12);
    expect(light.shift[1]).toBeCloseTo(0.01 / 2 - (0.01 + 0.1) / 2, 12);
  });
});

function pixels(width: number, height: number, alpha: (index: number) => number) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = 10;
    data[i * 4 + 1] = 20;
    data[i * 4 + 2] = 30;
    data[i * 4 + 3] = alpha(i);
  }
  return { width, height, data };
}

describe('prepareForeground transparency threshold', () => {
  it('rejects an image with fewer than 1% of its pixels below alpha 250', () => {
    const nineOfThousand = pixels(100, 10, (i) => (i < 9 ? 249 : 255));
    expect(() => prepareForeground(nineOfThousand)).toThrow(OPAQUE_FOREGROUND);
  });

  it('accepts exactly 1% and keeps the image size', () => {
    const tenOfThousand = pixels(100, 10, (i) => (i < 10 ? 249 : 255));
    const prepared = prepareForeground(tenOfThousand);
    expect(prepared.width).toBe(100);
    expect(prepared.height).toBe(10);
    expect(prepared.lab).toHaveLength(100 * 10 * 4);
  });

  it('does not count alpha 250 as transparent', () => {
    const opaqueAtBoundary = pixels(10, 10, () => 250);
    expect(() => prepareForeground(opaqueAtBoundary)).toThrow(OPAQUE_FOREGROUND);
  });
});

describe('prepareForeground conversion', () => {
  it('stores straight OKLab rows and alpha / 255 for plain ImageData-shaped input', () => {
    const image = pixels(2, 1, () => 255);
    image.data.set([255, 0, 0, 255, 0, 255, 0, 128]);
    const prepared = prepareForeground(image);
    const red = rgbToLab(255, 0, 0);
    const green = rgbToLab(0, 255, 0);
    expect(prepared.width).toBe(2);
    expect(prepared.height).toBe(1);
    for (let i = 0; i < 3; i++) {
      expect(prepared.lab[i]).toBeCloseTo(red[i], 7);
      expect(prepared.lab[4 + i]).toBeCloseTo(green[i], 7);
    }
    expect(prepared.lab[3]).toBe(1);
    expect(prepared.lab[7]).toBeCloseTo(128 / 255, 6);
  });
});

describe('foreground bounds', () => {
  it('places the default bottom-centre with the picture aspect ratio', () => {
    const bounds = foregroundBounds({ width: 400, height: 300 }, 4 / 3, FOREGROUND_DEFAULTS);
    expect(bounds.width).toBeCloseTo(0.7, 12);
    expect(bounds.height).toBeCloseTo(0.7, 12);
    expect(bounds.x).toBeCloseTo(0.68 - 0.35, 12);
    expect(bounds.y).toBeCloseTo(0.3, 12);
    expect(bounds.x + bounds.width / 2).toBeCloseTo(FOREGROUND_DEFAULTS.x, 12);
    expect(bounds.y + bounds.height).toBeCloseTo(FOREGROUND_DEFAULTS.y, 12);
  });

  it('narrows a portrait foreground by the ratio to the picture aspect', () => {
    const bounds = foregroundBounds({ width: 100, height: 200 }, 2, FOREGROUND_DEFAULTS);
    expect(bounds.width).toBeCloseTo((0.5 / 2) * 0.7, 12);
    expect(bounds.height).toBeCloseTo(0.7, 12);
    expect(bounds.x).toBeCloseTo(0.68 - bounds.width / 2, 12);
    expect(bounds.y).toBeCloseTo(0.3, 12);
  });

  it('honours explicit settings and allows the foreground to leave the picture', () => {
    const bounds = foregroundBounds({ width: 200, height: 100 }, 2, {
      x: 0,
      y: 0.8,
      size: 1.2,
      blend: 0.3,
    });
    expect(bounds.width).toBeCloseTo(1.2, 12);
    expect(bounds.height).toBeCloseTo(1.2, 12);
    expect(bounds.x).toBeCloseTo(-0.6, 12);
    expect(bounds.y).toBeCloseTo(-0.4, 12);
  });
});
