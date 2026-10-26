import { describe, expect, it } from 'vitest';
import {
  rolePaletteAt as reference,
  PRESETS as referencePresets,
} from '../../test/fixtures/v4/script.js';
import { rgbToLab } from '../color';
import { PRESETS, ROLES, type Role, rolePaletteAt } from './index';

describe('v4.2 reference parity', () => {
  const palette = Array.from({ length: 16 }, (_, i) =>
    rgbToLab((i * 37) % 256, (i * 71) % 256, (i * 113) % 256),
  );
  for (const [id, preset] of Object.entries(PRESETS))
    it(`${id} preserves every scalar at default and slider corners`, () => {
      const overrides = [
        {},
        ...[12, 48].flatMap((durationSec) =>
          [0.2, 4].flatMap((nightDepth) =>
            [0, 2].map((glow) => ({ durationSec, nightDepth, glow })),
          ),
        ),
      ];
      for (const override of overrides) {
        const p = { ...preset, ...override };
        for (const role of Object.keys(ROLES) as Role[]) {
          const roles = palette.map(() => role);
          for (let i = 0; i <= 48; i++) {
            const t = (i / 48) * p.durationSec;
            expect(rolePaletteAt(palette, roles, t, p)).toEqual(
              reference(palette, roles, t, { ...referencePresets[id], ...override }),
            );
          }
        }
      }
    });
});
