import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('..', import.meta.url)),
  out = path.join(root, 'test/results/v02/videos');
const report = [];
for (const file of (await readdir(out)).filter((f) => f.endsWith('.mp4'))) {
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
  const row = JSON.parse(result.stdout);
  report.push({ file, ...row });
  await writeFile(path.join(out, `${file}.flash.json`), result.stdout);
  assert.ok(row.wcag.pass && row.itu.pass, file);
  console.log(
    `${file}: WCAG=${row.wcag.pass}, ITU=${row.itu.pass}, ${row.input.frameCount} decoded frames`,
  );
}
assert.equal(report.length, 6);
await writeFile(path.join(out, 'flash.json'), `${JSON.stringify(report, null, 2)}\n`);
