#!/usr/bin/env node
// Pre-publication scan for key-like strings and local home paths.
//
// Inputs are every patch in `git log -p --all --no-ext-diff` and every text
// file listed by `git ls-files`. Matched values are never printed, written or
// kept: a finding carries only the pattern label, the value length, a reason
// for its tier and the location. The two generated reports and this script's
// own pattern definitions are classified instead of counted as candidates.
//
// Usage:
//   node app/test/scan-history.mjs
//   node app/test/scan-history.mjs --self-test
//   node app/test/scan-history.mjs --root <dir> --out <dir>

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const COMMIT_MARK = '\u001e';
const FIELD_MARK = '\u001f';
const SCRIPT_FILE = 'app/test/scan-history.mjs';
const JSON_REPORT_FILE = 'app/reports/M4-secrets.json';
const MD_REPORT_FILE = 'app/reports/M4-secrets.md';
const REPORT_FILES = new Set([JSON_REPORT_FILE, MD_REPORT_FILE]);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const cliArgs = process.argv.slice(2);

function takeOption(name) {
  const index = cliArgs.indexOf(name);
  if (index === -1) return null;
  const value = cliArgs[index + 1];
  if (!value) throw new Error(`${name} requires a path`);
  return path.resolve(value);
}

const root = takeOption('--root') ?? path.resolve(scriptDir, '..', '..');
const outDir = takeOption('--out') ?? path.join(root, 'app', 'reports');
const selfTestOnly = cliArgs.includes('--self-test');

const gitEnv = { ...process.env };
for (const key of Object.keys(gitEnv)) {
  // Some shells export GIT_CONFIG_COUNT without the matching keys, which makes
  // every git command fail. Drop the whole GIT_CONFIG_* protocol from children.
  if (
    key === 'GIT_CONFIG_COUNT' ||
    key === 'GIT_CONFIG_PARAMETERS' ||
    /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(key)
  )
    delete gitEnv[key];
}

function git(args) {
  return execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd: root,
    env: gitEnv,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    windowsHide: true,
  });
}

// ---------------------------------------------------------------------------
// Pattern definitions (safe to publish: labels are prefixes, not values)
// ---------------------------------------------------------------------------

const TYPE_WORDS = new Set([
  'string',
  'number',
  'boolean',
  'bigint',
  'symbol',
  'unknown',
  'never',
  'void',
  'object',
  'any',
  'null',
  'undefined',
]);

const PLACEHOLDER = new RegExp(
  [
    'example',
    'placeholder',
    'sample',
    'dummy',
    'redacted',
    'changeme',
    'replace[_-]?me',
    'your[_-]?',
    'todo',
    'fixme',
    'xxxx',
    '\\.\\.\\.',
    'process\\.env',
    'import\\.meta',
    'os\\.environ',
    '\\benv\\.',
    '\\$\\{',
    '\\{\\{',
    '<[^>]+>',
    '%s',
    '0{8,}',
  ].join('|'),
  'i',
);

const KEY_PATTERNS = [
  {
    id: 'figma-pat',
    label: 'figd_',
    shape: 'Figma のパーソナルアクセストークン形',
    regex: /(?<![A-Za-z0-9_])figd_[A-Za-z0-9_-]{4,}/g,
    strictMinLength: 40,
    minTailLength: 4,
    stripTrailing: /[-_]+$/,
  },
  {
    id: 'sk-prefix',
    label: 'sk-',
    shape: 'OpenAI などの sk- 接頭辞',
    regex: /(?<![A-Za-z0-9_])sk-[A-Za-z0-9_-]{4,}/g,
    strictMinLength: 40,
    minTailLength: 4,
    stripTrailing: /[-_]+$/,
  },
  {
    id: 'github-classic',
    label: 'ghp_',
    shape: 'GitHub のクラシック PAT',
    regex: /(?<![A-Za-z0-9_])ghp_[A-Za-z0-9]{8,}/g,
    strictMinLength: 40,
    minTailLength: 8,
  },
  {
    id: 'github-fine-grained',
    label: 'github_pat_',
    shape: 'GitHub の fine-grained PAT',
    regex: /(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9_]{8,}/g,
    strictMinLength: 60,
    minTailLength: 8,
  },
  {
    id: 'aws-access-key',
    label: 'AKIA',
    shape: 'AWS のアクセスキー ID',
    regex: /(?<![A-Za-z0-9_])AKIA[A-Z0-9]{4,}/g,
    strictExactLength: 20,
    minTailLength: 4,
  },
  {
    id: 'slack-token',
    label: 'xox',
    shape: 'Slack の token（xoxb- など）',
    regex: /(?<![A-Za-z0-9_])xox[baprs]-[A-Za-z0-9-]{6,}/g,
    strictMinLength: 30,
    minTailLength: 6,
    stripTrailing: /-+$/,
  },
  {
    id: 'private-key',
    label: '-----BEGIN … PRIVATE KEY-----',
    shape: 'PEM の秘密鍵ヘッダ',
    regex: /-----BEGIN (?:[A-Z0-9]+ )?(?:PRIVATE KEY(?: BLOCK)?)-----/g,
    fixedTier: 'strict',
    fixedReason: 'shape',
  },
  {
    id: 'pem-block',
    label: '-----BEGIN …-----',
    shape: 'その他の PEM ヘッダ（証明書・公開鍵など）',
    regex: /-----BEGIN [A-Z0-9 ]{0,40}-----/g,
    fixedTier: 'broad',
    fixedReason: 'non-private-pem',
  },
];

const SETTING_NAMES = [
  'api_key',
  'apikey',
  'access_key',
  'secret_key',
  'private_key',
  'client_secret',
  'access_token',
  'auth_token',
  'refresh_token',
  'id_token',
  'bearer_token',
  'token',
  'secret',
  'password',
  'passwd',
  'credential',
  'credentials',
];

const SETTING_PATTERN = {
  id: 'setting-assignment',
  label: '設定名=値',
  shape: '設定名と値の代入（大文字小文字を無視）',
  regex:
    /(?<![A-Za-z0-9_])(api[_-]?key|apikey|access[_-]?key|secret[_-]?key|private[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token|refresh[_-]?token|id[_-]?token|bearer[_-]?token|token|secret|password|passwd|credential(?:s)?)\s*[:=]\s*["'`]?([A-Za-z0-9_\-./+=]{1,})/gi,
  strictMinLength: 20,
};

const USER_NAME = 'ryo52';
const USER_PATTERN = USER_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const HOME_PATH_PATTERNS = [
  {
    variant: 'json-escaped',
    regex: new RegExp(String.raw`(?<![A-Za-z0-9_])[A-Za-z]:\\\\Users\\\\${USER_PATTERN}`, 'gi'),
  },
  {
    variant: 'windows',
    regex: new RegExp(String.raw`(?<![A-Za-z0-9_])[A-Za-z]:\\Users\\${USER_PATTERN}`, 'gi'),
  },
  {
    variant: 'posix',
    regex: new RegExp(`(?<![A-Za-z0-9_])[A-Za-z]:/Users/${USER_PATTERN}`, 'gi'),
  },
];

const HOME_VARIANTS = ['windows', 'json-escaped', 'posix'];
const HOME_VARIANT_DOCS = {
  windows: 'バックスラッシュ区切りの絶対パス',
  'json-escaped': 'JSON 文字列内の二重バックスラッシュ表記',
  posix: 'スラッシュ区切りの絶対パス（file:/// の直後を含む）',
};

// Lines that define patterns inside this script are classified by these words.
const DEFINITION_HINT =
  /(regex|label|pattern|prefix|variant|KEY_PATTERNS|HOME_PATH_PATTERNS|SELF_TEST|selfTest|expectedTier)/;

const REASON_LABELS = {
  shape: '既知の形',
  length: '長さ',
  placeholder: '例・プレースホルダ',
  diversity: '文字種の偏り',
  'low-variety': '英数字の偏り',
  identifier: '識別子らしい',
  'short-value': '短い値',
  'non-private-pem': '秘密鍵以外の PEM',
};

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

function distinctChars(value) {
  return new Set(value).size;
}

function isPlaceholder(value) {
  if (PLACEHOLDER.test(value)) return true;
  if (/^([A-Za-z0-9])\1+$/.test(value)) return true;
  if (/^(?:0123456789|1234567890|abcdefghijklmnopqrstuvwxyz)/i.test(value)) return true;
  return false;
}

function classifyKeyValue(pattern, value) {
  if (pattern.fixedTier) return { tier: pattern.fixedTier, reason: pattern.fixedReason ?? 'shape' };
  if (pattern.strictExactLength !== undefined) {
    if (value.length !== pattern.strictExactLength) return { tier: 'broad', reason: 'length' };
  } else if (value.length < pattern.strictMinLength) {
    return { tier: 'broad', reason: 'length' };
  }
  if (isPlaceholder(value)) return { tier: 'broad', reason: 'placeholder' };
  if (distinctChars(value) < 8) return { tier: 'broad', reason: 'diversity' };
  return { tier: 'strict', reason: 'shape' };
}

function classifySettingValue(value) {
  if (value.length < SETTING_PATTERN.strictMinLength) {
    return { tier: 'broad', reason: 'short-value' };
  }
  if (isPlaceholder(value)) return { tier: 'broad', reason: 'placeholder' };
  if (/^[A-Z][A-Z0-9_]*$/.test(value) && value.includes('_')) {
    return { tier: 'broad', reason: 'identifier' };
  }
  if (!/[0-9]/.test(value) || !/[A-Za-z]/.test(value)) {
    return { tier: 'broad', reason: 'low-variety' };
  }
  if (distinctChars(value) < 10) return { tier: 'broad', reason: 'diversity' };
  return { tier: 'strict', reason: 'shape' };
}

function findHomePaths(text) {
  const found = [];
  const spans = [];
  for (const pattern of HOME_PATH_PATTERNS) {
    pattern.regex.lastIndex = 0;
    for (const match of text.matchAll(pattern.regex)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (spans.some(([otherStart, otherEnd]) => start < otherEnd && otherStart < end)) continue;
      spans.push([start, end]);
      found.push({ variant: pattern.variant });
    }
  }
  return found;
}

function scanTextLine(text) {
  const candidates = [];
  for (const pattern of KEY_PATTERNS) {
    pattern.regex.lastIndex = 0;
    for (const match of text.matchAll(pattern.regex)) {
      let value = match[0];
      if (pattern.stripTrailing) value = value.replace(pattern.stripTrailing, '');
      if (pattern.minTailLength && value.length - pattern.label.length < pattern.minTailLength) {
        continue;
      }
      const tier = classifyKeyValue(pattern, value);
      candidates.push({
        pattern,
        value,
        name: null,
        start: match.index ?? 0,
        end: (match.index ?? 0) + match[0].length,
        ...tier,
      });
    }
  }
  SETTING_PATTERN.regex.lastIndex = 0;
  for (const match of text.matchAll(SETTING_PATTERN.regex)) {
    const name = match[1].toLowerCase();
    const value = match[2];
    if (TYPE_WORDS.has(value.toLowerCase())) continue;
    const tier = classifySettingValue(value);
    candidates.push({
      pattern: SETTING_PATTERN,
      value,
      name,
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      ...tier,
    });
  }
  candidates.sort(
    (a, b) =>
      (a.tier === 'strict' ? 0 : 1) - (b.tier === 'strict' ? 0 : 1) ||
      b.value.length - a.value.length ||
      a.start - b.start,
  );
  const accepted = [];
  for (const candidate of candidates) {
    const overlaps = accepted.some(
      (other) => candidate.start < other.end && other.start < candidate.end,
    );
    if (overlaps) continue;
    accepted.push(candidate);
  }
  return { keys: accepted, homePaths: findHomePaths(text) };
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

const keyFindings = { current: new Map(), history: new Map() };
const commitOrder = new Map();

function newVariantCounts() {
  return { windows: 0, 'json-escaped': 0, posix: 0 };
}

const homeAggregate = {
  current: { occurrences: 0, byVariant: newVariantCounts(), files: new Map() },
  history: {
    occurrences: 0,
    added: 0,
    removed: 0,
    byVariant: newVariantCounts(),
    files: new Map(),
    commits: new Map(),
  },
};

const classified = {
  patternDefinitions: {
    current: { keys: 0, homePaths: 0, files: new Map() },
    history: { keys: 0, homePaths: 0, files: new Map(), commits: new Set() },
  },
  reportArtifacts: {
    current: { keys: 0, homePaths: 0, files: new Map() },
    history: { keys: 0, homePaths: 0, files: new Map(), commits: new Set() },
  },
};

function classifyLocation(file, text) {
  if (REPORT_FILES.has(file)) return 'report-artifact';
  if (file === SCRIPT_FILE && DEFINITION_HINT.test(text)) return 'pattern-definition';
  return 'candidate';
}

function recordClassified(source, category, location, kind) {
  const bucket =
    category === 'pattern-definition' ? classified.patternDefinitions : classified.reportArtifacts;
  const entry = bucket[source];
  entry[kind] += 1;
  entry.files.set(location.file, (entry.files.get(location.file) ?? 0) + 1);
  if (source === 'history') entry.commits.add(location.commit);
}

function recordKeyHit(source, hit, location, classification) {
  if (classification !== 'candidate') {
    recordClassified(source, classification, location, 'keys');
    return;
  }
  const key = `${hit.pattern.id}\u0000${hit.name ?? ''}\u0000${hit.value}`;
  const findings = keyFindings[source];
  let finding = findings.get(key);
  if (!finding) {
    finding = {
      pattern: hit.pattern,
      name: hit.name,
      tier: hit.tier,
      reason: hit.reason,
      valueLength: hit.value.length,
      locations: [],
      seen: new Set(),
    };
    findings.set(key, finding);
  }
  const locationKey =
    source === 'history'
      ? `${location.commit}\u0000${location.file}\u0000${location.line}\u0000${location.side}`
      : `${location.file}\u0000${location.line}`;
  if (finding.seen.has(locationKey)) return;
  finding.seen.add(locationKey);
  finding.locations.push(location);
}

function recordHomeHit(source, hit, location, classification) {
  if (classification !== 'candidate') {
    recordClassified(source, classification, location, 'homePaths');
    return;
  }
  const aggregate = homeAggregate[source];
  aggregate.occurrences += 1;
  aggregate.byVariant[hit.variant] += 1;
  let fileEntry = aggregate.files.get(location.file);
  if (!fileEntry) {
    fileEntry = { file: location.file, occurrences: 0, added: 0, removed: 0, lines: new Set() };
    aggregate.files.set(location.file, fileEntry);
  }
  fileEntry.occurrences += 1;
  fileEntry.variants ??= newVariantCounts();
  fileEntry.variants[hit.variant] += 1;
  if (source === 'history') {
    aggregate[location.side] += 1;
    fileEntry[location.side] += 1;
    let commitEntry = aggregate.commits.get(location.commit);
    if (!commitEntry) {
      commitEntry = {
        commit: location.commit,
        date: location.date,
        occurrences: 0,
        added: 0,
        removed: 0,
      };
      aggregate.commits.set(location.commit, commitEntry);
    }
    commitEntry.occurrences += 1;
    commitEntry[location.side] += 1;
  } else {
    fileEntry.lines.add(location.line);
  }
}

function recordLine(text, location, source) {
  const { keys, homePaths } = scanTextLine(text);
  const classification = classifyLocation(location.file, text);
  for (const hit of keys) recordKeyHit(source, hit, location, classification);
  for (const hit of homePaths) recordHomeHit(source, hit, location, classification);
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

let binaryDiffCount = 0;
let historyAddedLines = 0;
let historyRemovedLines = 0;
let unsupportedHunkCount = 0;

function decodeGitQuotedPath(text) {
  const end = text.lastIndexOf('"');
  if (end <= 0) return text;
  return text.slice(1, end).replace(/\\(?:([0-7]{1,3})|(.))/g, (_whole, octal, character) => {
    if (octal) return String.fromCharCode(Number.parseInt(octal, 8));
    switch (character) {
      case 't':
        return '\t';
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 'b':
        return '\b';
      case 'f':
        return '\f';
      case 'v':
        return '\v';
      case '"':
        return '"';
      case '\\':
        return '\\';
      default:
        return character;
    }
  });
}

function parseDiffPath(raw, prefix) {
  let value = raw;
  const tab = value.indexOf('\t');
  if (tab !== -1) value = value.slice(0, tab);
  if (value.startsWith('"')) value = decodeGitQuotedPath(value);
  if (value === '/dev/null') return null;
  if (value.startsWith(prefix)) value = value.slice(prefix.length);
  return value;
}

function readHistory() {
  const format = `${COMMIT_MARK}%H${FIELD_MARK}%P${FIELD_MARK}%aI${FIELD_MARK}%s`;
  const output = git(['log', '-p', '--all', '--no-ext-diff', `--format=${format}`]);
  const commits = [];
  let current = null;
  for (const line of output.split('\n')) {
    if (line.startsWith(COMMIT_MARK)) {
      const fields = line.slice(1).split(FIELD_MARK);
      const sha = fields[0] ?? '';
      if (/^[0-9a-f]{40}$/.test(sha)) {
        const parents = (fields[1] ?? '').trim();
        current = {
          sha,
          short: sha.slice(0, 8),
          date: (fields[2] ?? '').slice(0, 10),
          subject: fields[3] ?? '',
          parents: parents ? parents.split(/\s+/) : [],
          lines: [],
        };
        commitOrder.set(current.short, commits.length);
        commits.push(current);
        continue;
      }
    }
    if (current) current.lines.push(line);
  }
  return commits;
}

// Commit messages are public too; keep only masked findings and locations.
function scanCommitMessages() {
  const output = git(['log', '--all', `--format=${COMMIT_MARK}%H%n%B`]);
  const result = { commitsScanned: 0, linesScanned: 0, keyCandidates: [], homePaths: [] };
  let commit = '',
    lineNumber = 0;
  for (const line of output.split('\n')) {
    if (line.startsWith(COMMIT_MARK) && /^[0-9a-f]{40}$/.test(line.slice(1))) {
      commit = line.slice(1);
      lineNumber = 0;
      result.commitsScanned++;
      continue;
    }
    if (!commit) continue;
    lineNumber++;
    result.linesScanned++;
    const found = scanTextLine(line);
    for (const hit of found.keys)
      result.keyCandidates.push({
        commit,
        line: lineNumber,
        pattern: hit.pattern.label,
        valueLength: hit.value.length,
        tier: hit.tier,
      });
    for (const hit of found.homePaths)
      result.homePaths.push({ commit, line: lineNumber, variant: hit.variant });
  }
  return result;
}

function scanCommit(commit) {
  let inDiff = false;
  let inHunk = false;
  let oldPath = null;
  let newPath = null;
  let oldLine = 0;
  let newLine = 0;
  for (const line of commit.lines) {
    if (inHunk) {
      const first = line.charAt(0);
      if (first === '\\') continue;
      if (first === '+' || first === '-' || first === ' ' || line === '') {
        if (first === '+') {
          historyAddedLines += 1;
          const file = newPath ?? oldPath;
          if (file) {
            recordLine(
              line.slice(1),
              {
                commit: commit.short,
                date: commit.date,
                file,
                line: newLine,
                side: 'added',
              },
              'history',
            );
          }
          newLine += 1;
        } else if (first === '-') {
          historyRemovedLines += 1;
          const file = oldPath ?? newPath;
          if (file) {
            recordLine(
              line.slice(1),
              {
                commit: commit.short,
                date: commit.date,
                file,
                line: oldLine,
                side: 'removed',
              },
              'history',
            );
          }
          oldLine += 1;
        } else {
          oldLine += 1;
          newLine += 1;
        }
        continue;
      }
      inHunk = false;
    }
    if (line.startsWith('diff --git ')) {
      inDiff = true;
      inHunk = false;
      oldPath = null;
      newPath = null;
      continue;
    }
    if (!inDiff) continue;
    if (line.startsWith('Binary files ') || line === 'GIT binary patch') {
      binaryDiffCount += 1;
      continue;
    }
    if (line.startsWith('@@@')) {
      unsupportedHunkCount += 1;
      continue;
    }
    if (line.startsWith('@@ ')) {
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (!match) continue;
      oldLine = Number(match[1]);
      newLine = Number(match[2]);
      inHunk = true;
      continue;
    }
    if (line.startsWith('--- ')) {
      oldPath = parseDiffPath(line.slice(4), 'a/');
      continue;
    }
    if (line.startsWith('+++ ')) {
      newPath = parseDiffPath(line.slice(4), 'b/');
    }
  }
}

// ---------------------------------------------------------------------------
// Current tracked files
// ---------------------------------------------------------------------------

function scanTrackedFiles() {
  const tracked = git(['ls-files', '-z'])
    .split('\0')
    .filter((entry) => entry.length > 0);
  const stats = { tracked: tracked.length, text: 0, binary: [], missing: [], excluded: [] };
  for (const file of tracked) {
    if (REPORT_FILES.has(file)) {
      stats.excluded.push(file);
      continue;
    }
    let buffer;
    try {
      buffer = readFileSync(path.join(root, file));
    } catch {
      stats.missing.push(file);
      continue;
    }
    if (buffer.includes(0)) {
      stats.binary.push(file);
      continue;
    }
    stats.text += 1;
    const lines = buffer.toString('utf8').split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].endsWith('\r') ? lines[index].slice(0, -1) : lines[index];
      recordLine(line, { file, line: index + 1 }, 'current');
    }
  }
  return stats;
}

// ---------------------------------------------------------------------------
// Self test (in memory only; no token is written to the repository or history)
// ---------------------------------------------------------------------------

const ALNUM = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v2W3x4Y5z6';
const BACKSLASH = String.fromCharCode(92);
const PEM_BEGIN = '-----BEGIN';

function runSelfTest() {
  const failures = [];
  let total = 0;
  const checkKey = (label, text, patternId, tier) => {
    total += 1;
    const hit = scanTextLine(text).keys.find((candidate) => candidate.pattern.id === patternId);
    if (!hit) {
      failures.push(`${label}: ${patternId} was not detected`);
      return;
    }
    if (hit.tier !== tier) failures.push(`${label}: ${hit.tier}, expected ${tier}`);
  };
  const checkIgnored = (label, text) => {
    total += 1;
    const hits = scanTextLine(text).keys.filter(
      (candidate) => candidate.pattern.id === SETTING_PATTERN.id,
    );
    if (hits.length > 0) failures.push(`${label}: setting assignment should be ignored`);
  };
  const checkHome = (label, text, variant) => {
    total += 1;
    const hits = scanTextLine(text).homePaths.filter((candidate) => candidate.variant === variant);
    if (hits.length !== 1) failures.push(`${label}: ${hits.length} matches for ${variant}`);
  };
  const checkClassification = (label, file, text, expected) => {
    total += 1;
    const actual = classifyLocation(file, text);
    if (actual !== expected) failures.push(`${label}: ${actual}, expected ${expected}`);
  };

  checkKey('figd_ long', `figd_${ALNUM}`, 'figma-pat', 'strict');
  checkKey('sk- long', `sk-${ALNUM}`, 'sk-prefix', 'strict');
  checkKey('ghp_ exact', `ghp_${ALNUM.slice(0, 36)}`, 'github-classic', 'strict');
  checkKey('github_pat_ long', `github_pat_${ALNUM}`, 'github-fine-grained', 'strict');
  checkKey('AKIA exact', `AKIA${'ABCDEFGHIJKLMNOP'}`, 'aws-access-key', 'strict');
  checkKey('xox long', `xoxb-${ALNUM.slice(0, 30)}`, 'slack-token', 'strict');
  checkKey('PEM private key', `${PEM_BEGIN} RSA PRIVATE KEY-----`, 'private-key', 'strict');
  checkKey('ghp_ short', `ghp_${ALNUM.slice(0, 8)}`, 'github-classic', 'broad');
  checkKey('AKIA long', `AKIA${'ABCDEFGHIJKLMNOPQ'}`, 'aws-access-key', 'broad');
  checkKey('token example', `token=${'your_token_here'}`, 'setting-assignment', 'broad');
  checkKey('token short', `token=${'abc'}`, 'setting-assignment', 'broad');
  checkKey('sk- word', `sk-${'learn'}`, 'sk-prefix', 'broad');
  checkKey('PEM certificate', `${PEM_BEGIN} CERTIFICATE-----`, 'pem-block', 'broad');
  checkKey('API_KEY long', `API_KEY=${ALNUM}`, 'setting-assignment', 'strict');
  checkIgnored('type annotation', `password: ${'string'}`);
  checkHome('home windows', `C:${BACKSLASH}Users${BACKSLASH}${USER_NAME}`, 'windows');
  checkHome('home posix', `C:/Users/${USER_NAME}`, 'posix');
  checkHome(
    'home json-escaped',
    `C:${BACKSLASH}${BACKSLASH}Users${BACKSLASH}${BACKSLASH}${USER_NAME}`,
    'json-escaped',
  );
  checkHome('home file url', `file:///${'C:'}/${'Users'}/${USER_NAME}/orca`, 'posix');
  checkClassification(
    'script pattern line',
    SCRIPT_FILE,
    'regex: /ghp_[A-Za-z0-9]{8,}/g',
    'pattern-definition',
  );
  checkClassification('report file', JSON_REPORT_FILE, 'anything', 'report-artifact');
  checkClassification('normal source', 'app/src/config.ts', 'token=abc', 'candidate');
  return { total, passed: total - failures.length, failures };
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

function maskFinding(finding) {
  if (finding.pattern.fixedTier) return finding.pattern.label;
  const prefix = finding.name ? `${finding.name}=` : finding.pattern.label;
  return `${prefix} (値 ${finding.valueLength} 文字)`;
}

const patternRank = new Map(
  [...KEY_PATTERNS, SETTING_PATTERN].map((pattern, index) => [pattern.id, index]),
);

function compareFindings(a, b) {
  if (a.tier !== b.tier) return a.tier === 'strict' ? -1 : 1;
  const rank = (patternRank.get(a.pattern.id) ?? 99) - (patternRank.get(b.pattern.id) ?? 99);
  if (rank !== 0) return rank;
  if (a.locations.length !== b.locations.length) return b.locations.length - a.locations.length;
  return a.valueLength - b.valueLength;
}

function compareCurrentLocations(a, b) {
  return a.file.localeCompare(b.file) || a.line - b.line;
}

function compareHistoryLocations(a, b) {
  const order = (commitOrder.get(a.commit) ?? 0) - (commitOrder.get(b.commit) ?? 0);
  if (order !== 0) return order;
  const file = a.file.localeCompare(b.file);
  if (file !== 0) return file;
  if (a.line !== b.line) return a.line - b.line;
  return a.side === b.side ? 0 : a.side === 'added' ? -1 : 1;
}

function publicLocations(finding, source) {
  if (source === 'current') {
    return finding.locations.map((location) => ({ file: location.file, line: location.line }));
  }
  return finding.locations.map((location) => ({
    commit: location.commit,
    date: location.date,
    file: location.file,
    line: location.line,
    side: location.side,
  }));
}

function finalizeFindings(source) {
  const list = [...keyFindings[source].values()];
  for (const finding of list) {
    finding.locations.sort(
      source === 'history' ? compareHistoryLocations : compareCurrentLocations,
    );
  }
  list.sort(compareFindings);
  return list.map((finding) => ({
    id: '',
    tier: finding.tier,
    pattern: finding.pattern.id,
    setting: finding.name,
    masked: maskFinding(finding),
    valueLength: finding.valueLength,
    reason: finding.reason,
    occurrences: finding.locations.length,
    locations: publicLocations(finding, source),
  }));
}

function variantSummary(counts) {
  return HOME_VARIANTS.map((variant) => ({
    variant,
    description: HOME_VARIANT_DOCS[variant],
    occurrences: counts[variant],
  }));
}

function publicHomeCurrent() {
  const files = [...homeAggregate.current.files.values()]
    .map((entry) => ({
      file: entry.file,
      occurrences: entry.occurrences,
      lines: [...entry.lines].sort((a, b) => a - b),
      byVariant: entry.variants,
    }))
    .sort((a, b) => b.occurrences - a.occurrences || a.file.localeCompare(b.file));
  return {
    occurrences: homeAggregate.current.occurrences,
    files: files.length,
    byVariant: variantSummary(homeAggregate.current.byVariant),
    fileDetails: files,
  };
}

function publicHomeHistory() {
  const files = [...homeAggregate.history.files.values()]
    .map((entry) => ({
      file: entry.file,
      occurrences: entry.occurrences,
      added: entry.added,
      removed: entry.removed,
      byVariant: entry.variants,
    }))
    .sort((a, b) => b.occurrences - a.occurrences || a.file.localeCompare(b.file));
  const commits = [...homeAggregate.history.commits.values()].sort(
    (a, b) => (commitOrder.get(a.commit) ?? 0) - (commitOrder.get(b.commit) ?? 0),
  );
  return {
    occurrences: homeAggregate.history.occurrences,
    added: homeAggregate.history.added,
    removed: homeAggregate.history.removed,
    files: files.length,
    commits: commits.length,
    byVariant: variantSummary(homeAggregate.history.byVariant),
    fileDetails: files,
    commitDetails: commits,
  };
}

function publicClassified(entry, source) {
  const result = {
    keys: entry.keys,
    homePaths: entry.homePaths,
    files: [...entry.files.entries()]
      .map(([file, occurrences]) => ({ file, occurrences }))
      .sort((a, b) => b.occurrences - a.occurrences || a.file.localeCompare(b.file)),
  };
  if (source === 'history') result.commits = entry.commits.size;
  return result;
}

function describePattern(pattern) {
  let strict;
  let conditions;
  if (pattern.fixedTier === 'strict') {
    strict = 'ヘッダの形';
    conditions = '—';
  } else if (pattern.fixedTier === 'broad') {
    strict = '—';
    conditions = '広い候補のみ';
  } else if (pattern.strictExactLength !== undefined) {
    strict = `値がちょうど ${pattern.strictExactLength} 文字`;
    conditions = '例・変数参照・識別子・文字種の偏りを除く';
  } else {
    strict = `値が ${pattern.strictMinLength} 文字以上`;
    conditions = '例・変数参照・識別子・文字種の偏りを除く';
  }
  return {
    id: pattern.id,
    label: pattern.label,
    shape: pattern.shape,
    strict,
    conditions,
  };
}

const LIMITS = [
  '走査は実行時点のスナップショット。作業ツリーや ref が同時に変わると、HEAD・件数・場所も変わる。',
  '`git log -p` の既定はマージコミットの差分を出さない。このリポジトリのマージコミットの差分は走査していない（件数は上の表）。',
  '`--all` は現在の ref が指すコミットだけが対象。dangling commit、reflog、stash、notes、削除済みブランチは対象外。',
  '現時点の走査は `git ls-files` の追跡ファイルの作業ツリーバイト（未コミット変更を含む）。未追跡・無視ファイル、サブモジュールの中身は対象外。',
  'バイナリは NUL バイトを含むファイル（UTF-16 のテキストもここに入る）。履歴は `Binary files ... differ` の差分を内容走査せず、件数だけ数える。',
  'Git の出力とファイルは UTF-8 として読む。非 UTF-8 のテキストは取りこぼす可能性がある。',
  '手元パスの対象ユーザー名はTask指定のryo52で固定。実行ユーザー名は参照しない。',
  '検出は正規表現だけで、エントロピー計算、外部サービスへの照会、鍵の有効性確認はしない。候補は実キーと断定できない。',
  '差分は追加行と削除行だけを走査し、文脈行は走査しない。行の周囲の文脈は保存しないため、文脈による誤検出の除外は限定的。',
  'コミットメッセージ（件名・本文）はパッチと別に全refを走査し、候補と場所だけを別集計する。パッチ内の追加・削除件数には含めない。',
  'このスクリプト自身のパターン定義行と、生成した 2 報告は候補の集計から分類して除外する。',
  '`api_key=` のように設定名だけで値が続かない言及は候補にしない。型注釈の値（`string` など）も除外する。',
];

const AGGREGATION = {
  keyCandidates:
    '同じパターン定義と同じ値の組を 1 件にまとめる。位置は現時点では (file, line)、履歴では (commit, file, line, 追加/削除) の一意な組で数える。同じ行に同じ値が複数あっても 1 か所。',
  homePaths:
    '出現するたびに 1 回と数える。同じ行の複数出現も別々に数える。ファイル数は出現のあったファイルの数。履歴の件数は追加行と削除行の合計。',
  strict:
    '既知の接頭辞の形で、値が十分な長さと文字種の多様性を持ち、例・プレースホルダ・変数参照・識別子らしい値を除いたもの。',
  broad:
    '同じ接頭辞でも短い値、例・プレースホルダ・変数参照、型注釈、識別子らしい値。ノイズを含むので、メインの確認を前提とする。',
  masking: '値は保存も表示もしない。接頭辞と値の長さだけを示す。',
};

function buildReports(commits, currentStats, selfCheck, headInfo) {
  const current = { strict: [], broad: [] };
  const history = { strict: [], broad: [] };
  const finalizedCurrent = finalizeFindings('current');
  const finalizedHistory = finalizeFindings('history');
  for (const finding of finalizedCurrent) current[finding.tier].push(finding);
  for (const finding of finalizedHistory) history[finding.tier].push(finding);
  let id = 0;
  for (const section of [current, history]) {
    for (const tier of ['strict', 'broad']) {
      for (const finding of section[tier]) {
        id += 1;
        finding.id = `K${String(id).padStart(3, '0')}`;
      }
    }
  }

  const mergeCount = commits.filter((commit) => commit.parents.length > 1).length;
  const currentHome = publicHomeCurrent();
  const historyHome = publicHomeHistory();
  const revListCount = Number.parseInt(git(['rev-list', '--all', '--count']).trim(), 10);
  const countsMatch = revListCount === commits.length;
  const head = headInfo.head;
  const branch = headInfo.branch;

  const summary = {
    commitsScanned: commits.length,
    mergeCommits: mergeCount,
    binaryDiffsSkipped: binaryDiffCount,
    current: {
      trackedFiles: currentStats.tracked,
      textFiles: currentStats.text,
      binaryFilesSkipped: currentStats.binary.length,
      missingFilesSkipped: currentStats.missing.length,
      excludedReportFiles: currentStats.excluded.length,
      keyCandidates: { strict: current.strict.length, broad: current.broad.length },
      homePathOccurrences: currentHome.occurrences,
      homePathFiles: currentHome.files,
    },
    history: {
      keyCandidates: { strict: history.strict.length, broad: history.broad.length },
      homePathOccurrences: historyHome.occurrences,
      homePathAdded: historyHome.added,
      homePathRemoved: historyHome.removed,
      homePathFiles: historyHome.files,
      homePathCommits: historyHome.commits,
    },
  };

  const report = {
    meta: {
      title: 'M4 公開前スキャン（鍵候補・手元パス）',
      tool: SCRIPT_FILE,
      head,
      branch,
      note: '値は保存も表示もしない。接頭辞と長さ、場所だけを記録する。',
    },
    summary,
    scan: {
      history: {
        command: "git log -p --all --no-ext-diff --format='<RS>%H<US>%P<US>%aI<US>%s'",
        commitsScanned: commits.length,
        mergeCommits: mergeCount,
        mergeDiffsSkipped: mergeCount,
        addedLinesScanned: historyAddedLines,
        removedLinesScanned: historyRemovedLines,
        binaryDiffMarkers: binaryDiffCount,
        unsupportedHunks: unsupportedHunkCount,
        revListCount,
        countsMatch,
      },
      current: {
        command: 'git ls-files -z',
        trackedFiles: currentStats.tracked,
        textFilesScanned: currentStats.text,
        binaryFilesSkipped: currentStats.binary,
        missingFilesSkipped: currentStats.missing,
        excludedReportFiles: currentStats.excluded,
        binaryRule: 'NUL バイトを含むファイルは走査しない',
      },
      selfCheck: { total: selfCheck.total, passed: selfCheck.passed, failures: selfCheck.failures },
    },
    keyCandidates: { current, history },
    homePaths: { current: currentHome, history: historyHome },
    classification: {
      patternDefinitions: {
        current: publicClassified(classified.patternDefinitions.current, 'current'),
        history: publicClassified(classified.patternDefinitions.history, 'history'),
      },
      reportArtifacts: {
        current: publicClassified(classified.reportArtifacts.current, 'current'),
        history: publicClassified(classified.reportArtifacts.history, 'history'),
      },
      rule: 'レポート 2 ファイルは report-artifact、このスクリプトのパターン定義行は pattern-definition として候補に数えない。',
    },
    patterns: [...KEY_PATTERNS, SETTING_PATTERN].map(describePattern),
    settingNames: SETTING_NAMES,
    aggregation: AGGREGATION,
    limits: LIMITS,
  };
  return report;
}

function mdTable(headers, rows) {
  const lines = [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`];
  for (const row of rows) lines.push(`| ${row.join(' | ')} |`);
  return lines.join('\n');
}

function formatReason(reason) {
  return REASON_LABELS[reason] ?? reason;
}

function formatLocations(locations, source) {
  if (source === 'current')
    return locations.map((location) => `\`${location.file}:${location.line}\``).join('<br>');
  return locations
    .map((location) => {
      const side = location.side === 'added' ? '追加' : '削除';
      return `\`${location.commit}\` \`${location.file}:${location.line}\`（${side}）`;
    })
    .join('<br>');
}

function countKeyCandidates(section) {
  return section.strict.length + section.broad.length;
}

function homeVariantText(byVariant) {
  return HOME_VARIANTS.map((variant) => `${variant} ${byVariant[variant]}`).join('、');
}

function buildMarkdown(report) {
  const { summary } = report;
  const currentKeys = countKeyCandidates(report.keyCandidates.current);
  const historyKeys = countKeyCandidates(report.keyCandidates.history);
  const lines = [];

  lines.push('# M4 公開前スキャン報告（鍵候補・手元パス）');
  lines.push('');
  lines.push(
    '受け手は公開可否を判断するメイン。履歴全体の差分と現時点の追跡テキストから、鍵らしい文字列と手元の絶対パスを探した。見つかったものは実キーと断定せず、メインが確認する候補として場所だけを示す。値は表示も保存もしない。',
  );
  lines.push('');
  lines.push('## 結果の要点');
  lines.push('');
  lines.push(
    mdTable(
      ['項目', '現時点（追跡ファイル）', '履歴（全コミット）'],
      [
        [
          '走査対象',
          `${summary.current.trackedFiles} ファイル（テキスト ${summary.current.textFiles}、バイナリ ${summary.current.binaryFilesSkipped}）`,
          `${summary.commitsScanned} コミット（マージ ${summary.mergeCommits}、追加 ${report.scan.history.addedLinesScanned} 行・削除 ${report.scan.history.removedLinesScanned} 行）`,
        ],
        ['履歴のバイナリ差分', '—', `${summary.binaryDiffsSkipped} 件（内容は走査しない）`],
        [
          '鍵候補（厳密）',
          `${summary.current.keyCandidates.strict} 件`,
          `${summary.history.keyCandidates.strict} 件`,
        ],
        [
          '鍵候補（広い）',
          `${summary.current.keyCandidates.broad} 件`,
          `${summary.history.keyCandidates.broad} 件`,
        ],
        [
          '手元パスの出現',
          `${summary.current.homePathOccurrences} 回（${summary.current.homePathFiles} ファイル）`,
          `${summary.history.homePathOccurrences} 回（追加 ${summary.history.homePathAdded}・削除 ${summary.history.homePathRemoved}、${summary.history.homePathFiles} ファイル）`,
        ],
        [
          '検出器の自己検査',
          `${report.scan.selfCheck.passed}/${report.scan.selfCheck.total} 合格`,
          '—',
        ],
      ],
    ),
  );
  lines.push('');
  lines.push(
    `鍵候補は現時点 ${currentKeys} 件・履歴 ${historyKeys} 件。手元パスは現時点 ${summary.current.homePathOccurrences} 回・履歴 ${summary.history.homePathOccurrences} 回だった。`,
  );
  if (!report.scan.history.countsMatch) {
    lines.push('');
    lines.push(
      `注意: 走査中に ref が動いた可能性がある（\`git rev-list\` は ${report.scan.history.revListCount} 件、解析は ${summary.commitsScanned} 件）。件数は解析した範囲の値。`,
    );
  }
  lines.push('');

  lines.push('## 鍵候補');
  lines.push('');
  if (currentKeys === 0 && historyKeys === 0) {
    lines.push('現時点・履歴とも、厳密・広いのどちらにも該当はなかった。走査した形は次のとおり。');
    lines.push('');
    lines.push(
      '候補が 0 件のため、鍵候補の場所（commit / file / line / 追加または削除）の表はない。候補がある場合はスクリプトが同じ列で出力する。',
    );
  } else {
    if (currentKeys > 0) {
      lines.push('### 現時点');
      lines.push('');
      lines.push(
        mdTable(
          ['ID', '段階', 'パターン', 'マスク', '理由', '出現', '場所'],
          ['strict', 'broad'].flatMap((tier) =>
            report.keyCandidates.current[tier].map((finding) => [
              finding.id,
              tier === 'strict' ? '厳密' : '広い',
              `\`${finding.pattern}\``,
              `\`${finding.masked}\``,
              formatReason(finding.reason),
              String(finding.occurrences),
              formatLocations(finding.locations, 'current'),
            ]),
          ),
        ),
      );
      lines.push('');
    }
    if (historyKeys > 0) {
      lines.push('### 履歴');
      lines.push('');
      lines.push(
        mdTable(
          [
            'ID',
            '段階',
            'パターン',
            'マスク',
            '理由',
            '出現',
            '場所（commit / file:line / 追加または削除）',
          ],
          ['strict', 'broad'].flatMap((tier) =>
            report.keyCandidates.history[tier].map((finding) => [
              finding.id,
              tier === 'strict' ? '厳密' : '広い',
              `\`${finding.pattern}\``,
              `\`${finding.masked}\``,
              formatReason(finding.reason),
              String(finding.occurrences),
              formatLocations(finding.locations, 'history'),
            ]),
          ),
        ),
      );
      lines.push('');
    }
  }
  lines.push('');
  lines.push(
    '検出した形（厳密はこの条件を満たすもの、広いは短い値や例を含むもの）。長さは、既知の接頭辞の形では接頭辞を含み、設定名の形では値だけを数える。',
  );
  lines.push('');
  lines.push(
    mdTable(
      ['パターン', '意味', '厳密の条件'],
      report.patterns.map((pattern) => [
        `\`${pattern.label}\``,
        pattern.shape,
        pattern.conditions === '—' ? pattern.strict : `${pattern.strict}（${pattern.conditions}）`,
      ]),
    ),
  );
  lines.push('');
  lines.push(
    `設定名は ${report.settingNames.map((name) => `\`${name}\``).join('、')} を大文字小文字を無視して拾う（区切りは \`:\` または \`=\`）。`,
  );
  lines.push('');

  lines.push('## 手元パス');
  lines.push('');
  lines.push(
    '対象はTaskで指定された手元ホームの3表記。対象ユーザー名はryo52に固定し、実行ユーザーには依存しない。定義はスクリプトの `HOME_PATH_PATTERNS`。',
  );
  lines.push('');
  lines.push(
    mdTable(
      ['表記', '意味'],
      report.homePaths.current.byVariant.map((variant) => [
        `\`${variant.variant}\``,
        variant.description,
      ]),
    ),
  );
  lines.push('');
  lines.push('### 現時点の追跡ファイル');
  lines.push('');
  if (report.homePaths.current.occurrences === 0) {
    lines.push('該当なし。');
  } else {
    lines.push(
      mdTable(
        ['ファイル', '出現', '行', '表記'],
        report.homePaths.current.fileDetails.map((file) => [
          `\`${file.file}\``,
          String(file.occurrences),
          file.lines.join(', '),
          homeVariantText(file.byVariant),
        ]),
      ),
    );
    lines.push('');
    lines.push(
      `合計 ${report.homePaths.current.occurrences} 回、${report.homePaths.current.files} ファイル。表記別は ${homeVariantText(Object.fromEntries(report.homePaths.current.byVariant.map((variant) => [variant.variant, variant.occurrences])))}。`,
    );
  }
  lines.push('');
  lines.push('### 履歴');
  lines.push('');
  if (report.homePaths.history.occurrences === 0) {
    lines.push('該当なし。');
  } else {
    lines.push(
      `合計 ${report.homePaths.history.occurrences} 回（追加 ${report.homePaths.history.added}・削除 ${report.homePaths.history.removed}）、${report.homePaths.history.files} ファイル、${report.homePaths.history.commits} コミット。表記別は ${homeVariantText(Object.fromEntries(report.homePaths.history.byVariant.map((variant) => [variant.variant, variant.occurrences])))}。`,
    );
    lines.push('');
    lines.push('ファイル別:');
    lines.push('');
    lines.push(
      mdTable(
        ['ファイル', '出現', '追加', '削除', '表記'],
        report.homePaths.history.fileDetails.map((file) => [
          `\`${file.file}\``,
          String(file.occurrences),
          String(file.added),
          String(file.removed),
          homeVariantText(file.byVariant),
        ]),
      ),
    );
    lines.push('');
    lines.push('コミット別:');
    lines.push('');
    lines.push(
      mdTable(
        ['コミット', '日付', '出現', '追加', '削除'],
        report.homePaths.history.commitDetails.map((commit) => [
          `\`${commit.commit}\``,
          commit.date,
          String(commit.occurrences),
          String(commit.added),
          String(commit.removed),
        ]),
      ),
    );
  }
  lines.push('');

  lines.push('## 集計条件');
  lines.push('');
  lines.push(`- 鍵候補: ${report.aggregation.keyCandidates}`);
  lines.push(`- 手元パス: ${report.aggregation.homePaths}`);
  lines.push(`- 厳密: ${report.aggregation.strict}`);
  lines.push(`- 広い: ${report.aggregation.broad}`);
  lines.push(`- マスク: ${report.aggregation.masking}`);
  lines.push('');

  lines.push('## 分類して除外したもの');
  lines.push('');
  lines.push(report.classification.rule);
  lines.push('');
  lines.push(
    mdTable(
      ['分類', '現時点', '履歴'],
      [
        [
          'pattern-definition（スクリプトのパターン定義）',
          `${report.classification.patternDefinitions.current.keys} 鍵 / ${report.classification.patternDefinitions.current.homePaths} 手元パス`,
          `${report.classification.patternDefinitions.history.keys} 鍵 / ${report.classification.patternDefinitions.history.homePaths} 手元パス`,
        ],
        [
          'report-artifact（生成した報告）',
          `${report.classification.reportArtifacts.current.keys} 鍵 / ${report.classification.reportArtifacts.current.homePaths} 手元パス`,
          `${report.classification.reportArtifacts.history.keys} 鍵 / ${report.classification.reportArtifacts.history.homePaths} 手元パス`,
        ],
      ],
    ),
  );
  lines.push('');
  lines.push(
    `現時点の集計から除外した報告ファイル: ${report.scan.current.excludedReportFiles.length} 件（走査時点で未追跡なら 0 件。追跡されていればパスで除外する）。`,
  );
  lines.push('');

  lines.push('## 走査の限界');
  lines.push('');
  for (const limit of report.limits) lines.push(`- ${limit}`);
  lines.push('');

  lines.push('## 再現方法');
  lines.push('');
  lines.push('```text');
  lines.push('node app/test/scan-history.mjs');
  lines.push('```');
  lines.push('');
  lines.push(
    `Node.js 24 以上、追加依存なし。HEAD は \`${report.meta.head}\`（\`${report.meta.branch}\`）。走査時点のスナップショットである。生成時刻は記録しない（同じ HEAD と同じ作業ツリーで同じ結果になるようにするため）。履歴は \`git log -p --all --no-ext-diff\`、現時点は \`git ls-files\` の作業ツリーバイトを読む。手元パスはTask指定のユーザー名ryo52を対象にする。\`--self-test\` は合成文字列だけで検出・分類・マスクを確認する（値は出力しない）。子プロセスの git からは \`GIT_CONFIG_COUNT\` など一時的な設定を除く（この環境では count だけが残り git が失敗するため）。`,
  );
  lines.push('');
  lines.push('## メインに確認してほしいこと');
  lines.push('');
  if (summary.current.homePathOccurrences > 0 || summary.history.homePathOccurrences > 0) {
    lines.push(
      '- 手元パスが現時点の追跡ファイルと履歴の両方に残っている。公開前に、地点を相対パスへ置き換えるか、履歴ごと書き換えるかを決める必要がある。このタスクでは消していない。',
    );
  } else {
    lines.push('- 手元パスは見つからなかった。公開前の再確認は不要と判断できる。');
  }
  lines.push(
    '- 鍵候補は 0 件だったが、検出は正規表現ベースで、外部サービスでの有効性確認はしていない。公開可否はメインが最終判断する。',
  );
  lines.push(
    '- 未追跡ファイル（`app/tasks/` の作業メモなど）は走査対象外。コミットする場合は同じ観点で確認する。',
  );
  lines.push('');
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const selfCheck = runSelfTest();
  if (selfTestOnly) {
    console.log(`self-test: ${selfCheck.passed}/${selfCheck.total} passed`);
    for (const failure of selfCheck.failures) console.error(`self-test failure: ${failure}`);
    if (selfCheck.failures.length > 0) process.exitCode = 1;
    return;
  }
  if (selfCheck.failures.length > 0) {
    throw new Error(`self-test failed (${selfCheck.failures.join('; ')})`);
  }

  const headInfo = {
    head: git(['rev-parse', 'HEAD']).trim(),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']).trim(),
  };
  const commits = readHistory();
  for (const commit of commits) scanCommit(commit);
  const currentStats = scanTrackedFiles();
  const report = buildReports(commits, currentStats, selfCheck, headInfo);
  report.commitMessages = scanCommitMessages();

  mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, path.basename(JSON_REPORT_FILE));
  const mdPath = path.join(outDir, path.basename(MD_REPORT_FILE));
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const messages = report.commitMessages;
  const messageSection = `\n## コミットメッセージの追加走査\n\n件名と本文も全${messages.commitsScanned}コミット・${messages.linesScanned}行を走査した。鍵候補${messages.keyCandidates.length}件、手元パス${messages.homePaths.length}回。パッチの追加・削除とは別集計。候補があればJSONのcommitMessagesにコミットと行・接頭辞・長さだけを示し、値は保存しない。\n`;
  writeFileSync(mdPath, buildMarkdown(report) + messageSection, 'utf8');

  const keyCount = (section) => section.strict.length + section.broad.length;
  console.log(
    `scan: commits=${report.summary.commitsScanned} merges=${report.summary.mergeCommits} tracked=${report.summary.current.trackedFiles} text=${report.summary.current.textFiles} binary=${report.summary.current.binaryFilesSkipped}`,
  );
  console.log(
    `key-candidates: current=${keyCount(report.keyCandidates.current)} history=${keyCount(report.keyCandidates.history)} (strict ${report.summary.current.keyCandidates.strict}/${report.summary.history.keyCandidates.strict}, broad ${report.summary.current.keyCandidates.broad}/${report.summary.history.keyCandidates.broad})`,
  );
  console.log(
    `home-paths: current=${report.summary.current.homePathOccurrences} occurrences in ${report.summary.current.homePathFiles} files; history=${report.summary.history.homePathOccurrences} occurrences (added ${report.summary.history.homePathAdded}, removed ${report.summary.history.homePathRemoved}) in ${report.summary.history.homePathFiles} files`,
  );
  console.log(`self-check: ${selfCheck.passed}/${selfCheck.total}`);
  console.log(`wrote: ${JSON_REPORT_FILE}, ${MD_REPORT_FILE}`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`secret-scan failed: ${message}`);
  process.exitCode = 1;
}
