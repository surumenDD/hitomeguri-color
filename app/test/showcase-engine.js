// Page behind showcase-render.mjs: loads a sample id or any image URL (a picture that is not a sample
// gets the app's automatic roles, as a user's own picture would), optionally adds a cut-out
// foreground prepared by the app, and exports it with the app's exporter.
import { exportVideo } from '../src/export/video';
import { FOREGROUND_DEFAULTS, loadForeground } from '../src/foreground';
import { decodeImage } from '../src/image';
import { preprocessInWorker } from '../src/palette/client';
import { curate, materializeIslands } from '../src/palette/islands';
import { SAMPLES } from '../src/samples';
import { PRESETS } from '../src/script';

let scene;
let foreground;

/** Fills unspecified foreground settings from the app defaults and rejects impossible values. */
function foregroundSettings(options) {
  const settings = { ...FOREGROUND_DEFAULTS };
  for (const key of ['x', 'y', 'size', 'blend']) {
    const value = options[key];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value))
      throw new Error(`foreground ${key} must be a finite number.`);
    settings[key] = value;
  }
  if (settings.size < 0.2 || settings.size > 1.2)
    throw new Error('foreground size must be between 0.2 and 1.2.');
  if (settings.blend < 0 || settings.blend > 1)
    throw new Error('foreground blend must be between 0 and 1.');
  if (settings.x < 0 || settings.x > 1) throw new Error('foreground x must be between 0 and 1.');
  if (settings.y < 0.2 || settings.y > 1 + settings.size * 0.5)
    throw new Error('foreground y must be between 0.2 and 1 + size / 2.');
  return settings;
}

/** The image name without its extension, as the app labels a dropped picture. */
function foregroundName(source) {
  const file = decodeURIComponent(source.slice(source.lastIndexOf('/') + 1));
  const dot = file.lastIndexOf('.');
  return dot > 0 ? file.slice(0, dot) : file;
}

async function load(source, overrides = {}, foregroundOptions) {
  // Every job starts without the previous job's foreground.
  foreground = undefined;
  let settings;
  let foregroundSource;
  if (foregroundOptions) {
    if (typeof foregroundOptions.source !== 'string' || !foregroundOptions.source)
      throw new Error('foreground source must be an image URL or path.');
    settings = foregroundSettings(foregroundOptions);
    foregroundSource = foregroundOptions.source;
  }
  const sample = SAMPLES.find((s) => s.id === source);
  if (!foregroundOptions && sample?.foreground) {
    settings = foregroundSettings(sample.foreground);
    foregroundSource = sample.foreground.url;
  }
  const base = await preprocessInWorker(await decodeImage(sample ? sample.url : source));
  const islands = curate(sample ? sample.id : '', base.metadata);
  for (const [k, role] of Object.entries(overrides)) islands[Number(k)].role = role;
  scene = { data: materializeIslands(base, islands), roles: islands.map((i) => i.role) };
  if (settings && foregroundSource)
    foreground = {
      ...settings,
      data: await loadForeground(foregroundSource),
      name:
        !foregroundOptions && sample?.foreground
          ? sample.foreground.name
          : foregroundName(foregroundSource),
      thumbnail: '',
    };
  return scene.roles;
}

async function video(presetId, options) {
  const output = await exportVideo(scene.data, scene.roles, PRESETS[presetId], {
    ...options,
    foreground,
  });
  const bytes = new Uint8Array(await output.blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768)
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return { frames: output.frames, base64: btoa(binary), report: output.report };
}
window.showcase = { load, video };
