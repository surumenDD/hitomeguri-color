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
    if (
      !(pkg.license === 'OFL-1.1' && location.includes('@fontsource/')) &&
      !(pkg.dev && ['MPL-2.0', 'CC-BY-4.0'].includes(pkg.license))
    )
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
const normalize = (s) => s.replace(/\r\n/g, '\n').trim();
const notices = normalize(
  await readFile(path.join(root, 'public/THIRD-PARTY-LICENSES.txt'), 'utf8'),
);
for (const name of [
  '@fontsource/zen-kaku-gothic-new',
  '@phosphor-icons/react',
  'mp4-muxer',
  'react',
  'react-dom',
  'scheduler',
]) {
  const pkg = JSON.parse(
    await readFile(path.join(root, 'node_modules', name, 'package.json'), 'utf8'),
  );
  const body = await readFile(path.join(root, 'node_modules', name, 'LICENSE'), 'utf8');
  assert.ok(notices.includes(`${name} ${pkg.version}`), `Missing license version: ${name}`);
  assert.ok(notices.includes(normalize(body)), `Stale license body: ${name}`);
}
console.log('Bundled runtime/font license versions and full texts match the installed packages.');
