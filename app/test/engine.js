import { exportVideo } from '../src/export/video';
import { decodeImage } from '../src/image';
import { preprocessInWorker } from '../src/palette/client';
import { curate, materializeIslands } from '../src/palette/islands';
import { Renderer } from '../src/render';
import { estimateSetting } from '../src/safety/estimate';
import { SAMPLES } from '../src/samples';
import { PRESETS, ROLES, rolePaletteAt } from '../src/script';
import { rolePaletteAt as reference, PRESETS as referencePresets } from './fixtures/v4/script.js';

let scene;
async function load(id) {
  const sample = SAMPLES.find((s) => s.id === id);
  const base = await preprocessInWorker(await decodeImage(sample.url));
  const islands = curate(id, base.metadata);
  const data = materializeIslands(base, islands);
  scene = { base, data, islands, roles: islands.map((i) => i.role) };
  return {
    id,
    palette: data.metadata.palette,
    roles: scene.roles,
    counts: data.metadata.counts,
    timing: base.metadata.timing,
    islands,
  };
}
function estimates() {
  return Object.values(PRESETS).map((p) => ({
    id: p.id,
    ...estimateSetting(scene.data, scene.roles, p),
  }));
}
function parity() {
  let maxError = 0;
  const palette = scene.base.metadata.palette;
  for (const [id, p] of Object.entries(PRESETS))
    for (const role of Object.keys(ROLES))
      for (let i = 0; i <= Math.ceil(p.durationSec * 30); i++) {
        const roles = palette.map(() => role);
        const q = rolePaletteAt(palette, roles, i / 30, p),
          ref = reference(palette, roles, i / 30, referencePresets[id]);
        q.forEach((v, k) => {
          v.forEach((x, j) => {
            maxError = Math.max(maxError, Math.abs(x - ref[k][j]));
          });
        });
      }
  return maxError;
}
async function video(id, overrides = {}, options = {}) {
  const preset = { ...PRESETS[id], ...overrides };
  const estimate = estimateSetting(scene.data, scene.roles, preset);
  const output = await exportVideo(scene.data, scene.roles, preset, options);
  const bytes = new Uint8Array(await output.blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768)
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return { ...output, blob: undefined, base64: btoa(binary), estimate };
}
window.engine = {
  load,
  estimates,
  parity,
  video,
  getScene: () => scene,
  PRESETS,
  Renderer,
  rolePaletteAt,
};
