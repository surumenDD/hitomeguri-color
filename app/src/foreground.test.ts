import { describe, expect, it } from 'vitest';
import { type Lab, labToLinear, rgbToLab } from './color';
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

function expectedLight([L, a, b]: Lab) {
  const linear = labToLinear([0.85, 1.3 * a, 1.3 * b]).map((v) => (v < 0 ? 0.0001 : v));
  const maximum = Math.max(...linear);
  return {
    exposure: Math.max(0.3, Math.min(1.15, L / 0.7)),
    color: linear.map((v) => v / maximum),
  };
}

describe('foreground v2 at the script endpoints', () => {
  it('lights the material from the first frame and returns to that same light for all presets', () => {
    expect(FOREGROUND_DEFAULTS.blend).toBe(0.8);
    const sample: Lab = [0.42, 0.04, 0.03];
    for (const preset of Object.values(PRESETS)) {
      const start = foregroundLight(metadata, roles, rolePaletteAt(palette, roles, 0, preset));
      const end = foregroundLight(
        metadata,
        roles,
        rolePaletteAt(palette, roles, preset.durationSec, preset),
      );
      expect(end).toEqual(start);
      expect(adaptForeground(sample, start, 0.8)).not.toEqual(sample);
      expect(adaptForeground(sample, end, 0.8)).toEqual(adaptForeground(sample, start, 0.8));
    }
  });
});

describe('zero blend', () => {
  it('keeps linear foreground material unchanged at arbitrary times', () => {
    const colors: Lab[] = [
      [0, 0, 0],
      [0.1, 0.02, 0.01],
      [0.5, 0.8, 0.03],
      [1, 1, 1],
    ];
    for (const preset of Object.values(PRESETS)) {
      for (const fraction of [0, 0.11, 0.37, 0.81, 1]) {
        const current = rolePaletteAt(palette, roles, preset.durationSec * fraction, preset);
        const light = foregroundLight(metadata, roles, current);
        for (const color of colors) expect(adaptForeground(color, light, 0)).toEqual(color);
      }
    }
  });
});

describe('v2 exposure and colour bounds', () => {
  it('bounds exposure and normalizes the maximum colour component to one throughout all presets', () => {
    for (const preset of Object.values(PRESETS)) {
      for (let step = 0; step <= 100; step++) {
        const current = rolePaletteAt(palette, roles, (preset.durationSec * step) / 100, preset);
        const light = foregroundLight(metadata, roles, current);
        expect(light.exposure).toBeGreaterThanOrEqual(0.3);
        expect(light.exposure).toBeLessThanOrEqual(1.15);
        expect(Math.max(...light.color)).toBe(1);
        expect(light.color.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(true);
      }
    }
  });

  it('uses absolute exposure even for an originally black sky', () => {
    const black = { palette: [[0, 0, 0]] as Lab[], counts: [10] };
    const darkLight = foregroundLight(black, ['sky'], [[0, 0, 0]]);
    expect(darkLight.exposure).toBe(0.3);
    for (const component of darkLight.color) expect(component).toBeCloseTo(1, 12);
    expect(foregroundLight(black, ['sky'], [[0.7, 0, 0]]).exposure).toBe(1);
    expect(foregroundLight(black, ['sky'], [[1, 0, 0]]).exposure).toBe(1.15);
  });

  it('replaces negative linear light components with 0.0001 before normalization', () => {
    const source: Lab = [0.7, 0.4, 0.4];
    const raw = labToLinear([0.85, 0.52, 0.52]);
    expect(raw.some((v) => v < 0)).toBe(true);
    const light = foregroundLight({ palette: [source], counts: [10] }, ['sky'], [source]);
    expect(light).toEqual(expectedLight(source));
    for (let i = 0; i < 3; i++)
      if (raw[i] < 0) expect(light.color[i]).toBeCloseTo(0.0001 / Math.max(...raw), 12);
  });

  it('keeps every linear output component in 0..1 for the full light and blend ranges', () => {
    for (const channel of [0, 0.08, 0.2, 0.35, 0.5, 0.73, 0.9, 1]) {
      for (const exposure of [0.3, 0.5, 0.99, 1, 1.15]) {
        for (const f of [0, 0.2, 0.8, 0.85, 1]) {
          const out = adaptForeground(
            [channel, channel, channel],
            {
              exposure,
              color: [0.00001, 0.7, 1],
            },
            f,
          );
          expect(out.every((v) => v >= 0 && v <= 1)).toBe(true);
        }
      }
    }
    expect(adaptForeground([1, 0.5, 0], { exposure: 1.15, color: [1, 1, 1] }, 1)).toEqual([
      1, 0.575, 0,
    ]);
  });
});

describe('foreground v2 adaptation formula', () => {
  it('multiplies each linear component by the blended exposure and light colour', () => {
    const out = adaptForeground([0.6, 0.4, 0.2], { exposure: 0.5, color: [1, 0.5, 0.25] }, 0.8);
    expect(out[0]).toBeCloseTo(0.36, 12);
    expect(out[1]).toBeCloseTo(0.16, 12);
    expect(out[2]).toBeCloseTo(0.06, 12);
  });

  it('applies full light at f=1 and preserves black without any additive colour shift', () => {
    const light = { exposure: 0.3, color: [1, 0.5, 0.25] as Lab };
    expect(adaptForeground([0, 0, 0], light, 1)).toEqual([0, 0, 0]);
    expect(adaptForeground([1, 1, 1], light, 1)[0]).toBeCloseTo(0.3, 12);
    expect(adaptForeground([1, 1, 1], light, 1)[2]).toBeCloseTo(0.075, 12);
  });
});

describe('foreground light without a sky', () => {
  it('returns neutral light, leaving the material untouched', () => {
    const light = foregroundLight(metadata, ['water', 'light', 'middle', 'shadow'], palette);
    expect(light).toEqual({ exposure: 1, color: [1, 1, 1] });
    expect(adaptForeground([0.37, 0.06, 0.04], light, 1)).toEqual([0.37, 0.06, 0.04]);
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
    expect(foregroundLight(skyMetadata, ['sky', 'sky', 'water', 'sky'], current)).toEqual(
      expectedLight([0.53, -0.02, 0.025]),
    );
  });

  it('follows a role change to the larger of the changed skies', () => {
    expect(foregroundLight(skyMetadata, ['sky', 'water', 'water', 'sky'], current)).toEqual(
      expectedLight([0.45, 0.1, 0.05]),
    );
  });

  it('follows a role change to a sky that was not the largest picture colour', () => {
    expect(foregroundLight(skyMetadata, ['water', 'water', 'water', 'sky'], current)).toEqual(
      expectedLight([0.4, 0.005, 0.005]),
    );
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
