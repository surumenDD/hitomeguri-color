import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
const allowed = new Set([
  'MIT',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  'ISC',
  'MIT OR Apache-2.0',
  '(MIT OR Apache-2.0)',
  '(MIT AND BSD-3-Clause)',
]);
const invalid = [],
  licenses = new Map();
for (const [location, pkg] of Object.entries(lock.packages)) {
  if (!location) continue;
  licenses.set(pkg.license, (licenses.get(pkg.license) ?? 0) + 1);
  if (!allowed.has(pkg.license))
    invalid.push({ location, version: pkg.version, license: pkg.license });
}
console.log(
  JSON.stringify(
    {
      packages: Object.keys(lock.packages).length - 1,
      licenses: Object.fromEntries(licenses),
      invalid,
    },
    null,
    2,
  ),
);
assert.deepEqual(invalid, [], 'Every locked dependency must have an allowed license.');
