// Page behind showcase-render.mjs: loads a sample id or any image URL (a picture that is not a sample
// gets the app's automatic roles, as a user's own picture would) and exports it with the app's exporter.
import { exportVideo } from '../src/export/video';
import { decodeImage } from '../src/image';
import { preprocessInWorker } from '../src/palette/client';
import { curate, materializeIslands } from '../src/palette/islands';
import { SAMPLES } from '../src/samples';
import { PRESETS } from '../src/script';

let scene;
async function load(source) {
  const sample = SAMPLES.find((s) => s.id === source);
  const base = await preprocessInWorker(await decodeImage(sample ? sample.url : source));
  const islands = curate(sample ? sample.id : '', base.metadata);
  scene = { data: materializeIslands(base, islands), roles: islands.map((i) => i.role) };
  return scene.roles;
}
async function video(presetId, options) {
  const output = await exportVideo(scene.data, scene.roles, PRESETS[presetId], options);
  const bytes = new Uint8Array(await output.blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768)
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return { frames: output.frames, base64: btoa(binary) };
}
window.showcase = { load, video };
