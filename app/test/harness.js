// Browser-only integration harness: real Workers, shader and exact source pixels.
import { decodeImage } from '../src/image';
import { preprocessInWorker } from '../src/palette/client';
import { Renderer } from '../src/render';
import { SAMPLES } from '../src/samples';
import { inferRoles, PRESETS, rolePaletteAt } from '../src/script';
import { DEVELOPMENT_SAMPLES } from './samples';

const renderer = new Renderer(document.querySelector('#result'));
function psnr(a, b) {
  let squared = 0,
    max = 0;
  for (let i = 0; i < a.length; i++)
    if (i % 4 !== 3) {
      const d = a[i] - b[i];
      squared += d * d;
      max = Math.max(max, Math.abs(d));
    }
  return {
    psnrDb: squared ? 10 * Math.log10(255 ** 2 / (squared / ((a.length / 4) * 3))) : 'Infinity',
    maxByteError: max,
  };
}
async function sampleTest(id) {
  const sample = [...SAMPLES, ...DEVELOPMENT_SAMPLES].find((s) => s.id === id),
    image = await decodeImage(sample.url),
    expected = image.data.slice(),
    data = await preprocessInWorker(image);
  const { width, height, palette } = data.metadata;
  renderer.upload(data);
  renderer.size(width, height);
  renderer.draw(palette);
  const identity = psnr(expected, renderer.read()),
    roles = inferRoles(data.metadata).map((i) => i.role),
    endpoints = [];
  for (const preset of Object.values(PRESETS))
    for (const seconds of [0, preset.durationSec]) {
      renderer.draw(rolePaletteAt(palette, roles, seconds, preset));
      endpoints.push({ preset: preset.id, seconds, ...psnr(expected, renderer.read()) });
    }
  return { id, width, height, identity, endpoints, timing: data.metadata.timing };
}
async function alphaTest() {
  const rgba = new Uint8ClampedArray([20, 40, 60, 255, 80, 100, 120, 128, 0, 0, 0, 0]),
    expected = rgba.slice();
  const data = await preprocessInWorker(new ImageData(rgba, 3, 1));
  renderer.upload(data);
  renderer.size(3, 1);
  renderer.draw(data.metadata.palette);
  const actual = renderer.read();
  return {
    rgb: psnr(expected, actual),
    alphaExact: expected.every((v, i) => i % 4 !== 3 || actual[i] === v),
  };
}
async function fallbackTest() {
  const data = await preprocessInWorker(
    new ImageData(new Uint8ClampedArray([20, 40, 60, 255]), 1, 1),
  );
  renderer.upload(data);
  renderer.size(1, 1);
  return [-2, 2].map((delta) => {
    const palette = data.metadata.palette.map((p) => [p[0] + delta, p[1], p[2]]);
    renderer.draw(palette, { diagnostic: true });
    const diagnostic = renderer.read()[0];
    renderer.draw(palette);
    return { diagnostic, rgba: [...renderer.read()] };
  });
}
window.harness = { sampleTest, alphaTest, fallbackTest, gpu: renderer.info };
