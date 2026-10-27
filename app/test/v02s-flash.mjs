import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = path.join(root, 'test/results/v02s/videos');
await mkdir(out, { recursive: true });
const jobs = ['festival', 'seaside'].flatMap((id) =>
  ['day', 'longDusk', 'nightLights'].map((preset) => `${id}-${preset}=${id}:${preset}`),
);
const rendered = await promisify(execFile)(
  process.execPath,
  ['test/showcase-render.mjs', out, ...jobs],
  { cwd: root, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
);
console.log(rendered.stdout.trim());
const report = [];
for (const job of jobs) {
  const file = `${job.split('=')[0]}.mp4`;
  const result = await promisify(execFile)(
    process.execPath,
    [
      path.join(root, '../tools/visual-qa/flash-check.mjs'),
      path.join(out, file),
      '--css-px-per-px',
      '1.6',
    ],
    { windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
  );
  const row = { file, ...JSON.parse(result.stdout) };
  report.push(row);
  await writeFile(path.join(out, `${file}.flash.json`), result.stdout);
  await writeFile(path.join(out, 'flash.json'), `${JSON.stringify(report, null, 2)}\n`);
  assert.ok(row.wcag.pass && row.itu.pass, file);
  console.log(
    `${file}: WCAG=${row.wcag.pass}, ITU=${row.itu.pass}, ${row.input.frameCount} frames`,
  );
}
assert.equal(report.length, 6);
