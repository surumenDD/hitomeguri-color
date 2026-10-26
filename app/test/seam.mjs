import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const video = fileURLToPath(new URL('./results/m2-v41-videos/1080p-12s.mp4', import.meta.url));
const size = 384 * 216 * 3,
  means = [];
let pending = Buffer.alloc(0),
  first,
  previous,
  count = 0;
const mae = (a, b) => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
};
const child = spawn(
  'ffmpeg',
  [
    '-v',
    'error',
    '-i',
    video,
    '-vf',
    'scale=384:216',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    'pipe:1',
  ],
  { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
);
let error = '';
child.stderr.on('data', (data) => (error += data));
child.stdout.on('data', (chunk) => {
  pending = Buffer.concat([pending, chunk]);
  while (pending.length >= size) {
    const frame = Buffer.from(pending.subarray(0, size));
    pending = pending.subarray(size);
    if (previous) means.push(mae(previous, frame));
    else first = frame;
    previous = frame;
    count++;
  }
});
await new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(error))));
});
const sorted = [...means].sort((a, b) => a - b),
  seam = mae(previous, first),
  maximum = Math.max(...means);
const report = {
  video: '1080p-12s.mp4',
  frames: count,
  metric: 'decoded RGB MAE at 384x216, byte units',
  seam,
  firstNeighbor: means[0],
  lastNeighbor: means.at(-1),
  neighborMedian: sorted[Math.floor(sorted.length / 2)],
  neighborP95: sorted[Math.floor(sorted.length * 0.95)],
  neighborMax: maximum,
  pass: seam <= maximum * 2 + 0.5,
};
assert.equal(count, 360);
assert.ok(report.pass);
await writeFile(
  new URL('../reports/M2-loop.json', import.meta.url),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(report);
