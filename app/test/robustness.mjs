// Real Chrome UI regression matrix. No private app API, network upload, or external artwork.
// npm run test:robustness -- [--url URL] [--only name,...] [--timeout seconds] [--export] [--strict]
// --list prints fixture IDs. Results are overwritten; previous runs are archived first.
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from '../../tools/visual-qa/node_modules/playwright-core/index.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = path.join(root, 'test/results');
const presets = ['1日の光', '長い夕暮れ', '夜の灯り'];
const fixtures = [
  ['white-person', '白い背景40%・人物の塊', 'person'],
  ['white-border', '白い縁15%', 'white-border'],
  ['black-background', '黒い背景60%・明るい色', 'black-background'],
  ['black-border', '黒い縁15%', 'black-border'],
  ['black-line-art', '白地に細い黒線', 'black-line-art'],
  ['white-line-art', '黒地に細い白線', 'white-line-art'],
  ['neon-night', '黒地に彩度の高いネオン', 'neon'],
  ['rain-lines', '雨のような白い細線', 'rain'],
  ['sky-sea', '空と海のグラデーション', 'scene'],
  ['photo-noise', '写真風の細かなノイズ', 'photo'],
  ['low-key', '暗い絵', 'low-key'],
  ['high-key', '明るい絵', 'high-key'],
  ['white', '真っ白', 'white'],
  ['black', '真っ黒', 'black'],
  ['gray', '中間の灰色1色', 'gray'],
  ['two-colors', '2色だけ', 'two-colors'],
  ['checkerboard', '白黒の市松', 'checkerboard'],
  ['random-noise', '重複しないランダム色のノイズ', 'noise'],
  ['gray-steps', 'グレーの階段', 'gray-steps'],
  ['rainbow', '彩度最大の虹', 'rainbow'],
  ...[
    [1, 1],
    [2, 2],
    [16, 16],
    [64, 48],
    [8000, 6000],
    [6000, 300],
    [300, 6000],
    [4096, 4096],
  ].map(([w, h]) => [`size-${w}x${h}`, `${w}×${h}`, 'scene', w, h]),
  ['jpeg', 'JPEGの絵', 'scene', 640, 480, 'image/jpeg'],
  ['webp', 'WebPの絵', 'scene', 640, 480, 'image/webp'],
  ['transparent', '全体が透明なPNG', 'transparent'],
  ['half-transparent', '半分が透明なPNG', 'half-transparent'],
  ['alpha-border', '縁が半透明なPNG', 'alpha-border'],
].map(([name, description, kind, width = 640, height = 480, mimeType = 'image/png']) => ({
  name,
  description,
  kind,
  width,
  height,
  mimeType,
}));

function options(args) {
  const parsed = { timeout: 180, export: false, strict: false };
  for (let i = 0; i < args.length; i++) {
    const [flag, inline] = args[i].split(/=(.*)/s);
    if (['--export', '--strict', '--list', '--help'].includes(flag)) {
      parsed[flag.slice(2)] = true;
    } else if (['--url', '--only', '--timeout'].includes(flag)) {
      const value = inline ?? args[++i];
      if (!value || value.startsWith('--')) throw new Error(`${flag} の値が必要です。`);
      parsed[flag.slice(2)] = flag === '--timeout' ? Number(value) : value;
    } else throw new Error(`未対応の引数: ${flag}`);
  }
  if (!Number.isFinite(parsed.timeout) || parsed.timeout <= 0)
    throw new Error('--timeout は1枚の上限秒数（正の数）です。');
  if (parsed.url && !['http:', 'https:'].includes(new URL(parsed.url).protocol))
    throw new Error('--url は http(s) のURLを指定してください。');
  if (parsed.only) {
    parsed.only = parsed.only.split(',');
    const unknown = parsed.only.filter((name) => !fixtures.some((f) => f.name === name));
    if (unknown.length) throw new Error(`未知の画像: ${unknown.join(', ')}（--list で一覧）`);
  }
  return parsed;
}

// Executed in an independent blank page, outside the measured app page.
function generateImage(fixture) {
  const { width, height, kind, mimeType } = fixture;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  let seed = 0x12345678;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const rect = (color, x, y, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };
  // Work in normalised coordinates so very small and very large files share the same scene.
  ctx.scale(width, height);
  const gradient = ctx.createLinearGradient(0, 0, 0, 1);
  for (const [at, color] of [
    [0, '#5195bb'],
    [0.48, '#e3ac78'],
    [0.5, '#346779'],
    [1, '#213b61'],
  ])
    gradient.addColorStop(at, color);
  rect(gradient, 0, 0, 1, 1);
  rect('#4b3546', 0.15, 0.35, 0.17, 0.35);
  rect('#bf5d50', 0.34, 0.25, 0.15, 0.45);
  rect('#e3b151', 0.52, 0.44, 0.19, 0.26);
  rect('#1c343b', 0, 0.7, 1, 0.06);
  for (let x = 0.17; x < 0.7; x += 0.07) rect('#ffd387', x, 0.52, 0.024, 0.05);
  if (kind === 'white-border' || kind === 'black-border' || kind === 'alpha-border') {
    // 1 - (1 - 2*inset)^2 = 0.15 of the image area (before pixel rounding).
    const inset = (1 - Math.sqrt(0.85)) / 2;
    const color = kind === 'black-border' ? '#000' : '#fff';
    if (kind === 'alpha-border') {
      ctx.clearRect(0, 0, 1, inset);
      ctx.clearRect(0, 1 - inset, 1, inset);
      ctx.clearRect(0, inset, inset, 1 - 2 * inset);
      ctx.clearRect(1 - inset, inset, inset, 1 - 2 * inset);
      ctx.globalAlpha = 0.35;
    }
    rect(color, 0, 0, 1, inset);
    rect(color, 0, 1 - inset, 1, inset);
    rect(color, 0, inset, inset, 1 - 2 * inset);
    rect(color, 1 - inset, inset, inset, 1 - 2 * inset);
  } else if (kind === 'person') {
    rect('#fff', 0, 0, 1, 1);
    // Silhouette area: head ellipse 0.12 + trapezoidal body 0.48 = 60%, white 40%.
    ctx.fillStyle = '#c78c76';
    ctx.beginPath();
    ctx.ellipse(0.5, 0.21, 0.12 / (Math.PI * 0.19), 0.19, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4c5977';
    ctx.beginPath();
    ctx.moveTo(0.2, 0.4);
    ctx.lineTo(0.8, 0.4);
    ctx.lineTo(1, 1);
    ctx.lineTo(0, 1);
    ctx.fill();
    rect('#352b32', 0.39, 0.12, 0.22, 0.05);
  } else if (kind === 'black-background') {
    rect('#000', 0, 0, 1, 1);
    for (let i = 0; i < 4; i++)
      rect(['#fa7e35', '#51e4c9', '#ede842', '#ce59f4'][i], i / 4, 0.3, 0.25, 0.4);
  } else if (['black-line-art', 'white-line-art', 'neon', 'rain'].includes(kind)) {
    rect(kind === 'black-line-art' ? '#fff' : kind === 'rain' ? '#254359' : '#000', 0, 0, 1, 1);
    ctx.lineWidth = 1 / width;
    for (let i = 0; i < (kind === 'neon' ? 140 : 55); i++) {
      ctx.strokeStyle = kind === 'black-line-art' ? '#000' : '#fff';
      const x = random(),
        y = random();
      if (kind === 'neon') {
        rect(`hsl(${Math.floor(random() * 360)} 100% 60%)`, x, y, 0.006, 0.012);
      } else {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(kind === 'rain' ? x - 0.04 : random(), kind === 'rain' ? y + 0.18 : random());
        ctx.stroke();
      }
    }
  } else if (
    ['white', 'black', 'gray', 'two-colors', 'checkerboard', 'gray-steps', 'rainbow'].includes(kind)
  ) {
    if (['white', 'black', 'gray'].includes(kind))
      rect({ white: '#fff', black: '#000', gray: '#808080' }[kind], 0, 0, 1, 1);
    if (kind === 'two-colors') {
      rect('#285f89', 0, 0, 1, 1);
      rect('#da8849', 0.5, 0, 0.5, 1);
    }
    if (kind === 'checkerboard') {
      for (let y = 0; y < 16; y++)
        for (let x = 0; x < 16; x++)
          rect((x + y) % 2 ? '#000' : '#fff', x / 16, y / 16, 1 / 16, 1 / 16);
    }
    if (kind === 'gray-steps') {
      for (let x = 0; x < 16; x++) rect(`rgb(${x * 17} ${x * 17} ${x * 17})`, x / 16, 0, 1 / 16, 1);
    }
    if (kind === 'rainbow') {
      for (let x = 0; x < width; x++)
        rect(`hsl(${(x / width) * 360} 100% 50%)`, x / width, 0, 1 / width, 1);
    }
  } else if (['photo', 'noise', 'low-key', 'high-key'].includes(kind)) {
    const pixels = ctx.getImageData(0, 0, width, height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      // Odd multiplication is bijective modulo 2^24: noise has one distinct colour per pixel.
      const color = (Math.imul(i / 4, 0x5bd1e9) + 0x123456) & 0xffffff;
      for (let c = 0; c < 3; c++) {
        const value = pixels.data[i + c];
        pixels.data[i + c] =
          kind === 'noise'
            ? (color >>> (c * 8)) & 255
            : kind === 'low-key'
              ? Math.round(value * 0.16)
              : kind === 'high-key'
                ? Math.round(220 + value * 0.13)
                : Math.max(0, Math.min(255, value + (random() - 0.5) * 75));
      }
    }
    ctx.putImageData(pixels, 0, 0);
  } else if (kind === 'transparent') ctx.clearRect(0, 0, 1, 1);
  else if (kind === 'half-transparent') ctx.clearRect(0, 0, 0.5, 1);
  const url = canvas.toDataURL(mimeType, 0.92);
  if (!url.startsWith(`data:${mimeType};`))
    throw new Error(`Canvas encoder unavailable: ${mimeType}`);
  return url.split(',')[1];
}

// Observe only browser/DOM APIs so the identical probe works with a production URL.
function installProbe() {
  const probe = {
    stage: 'navigation',
    measurementStart: null,
    lastEventAt: null,
    settledAt: null,
    events: [],
    longTasks: [],
  };
  window.__robustness = probe;
  const emit = (data) => {
    void window.robustnessTelemetry(data).catch(() => {});
  };
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const task = {
          stage: probe.stage,
          startTime: entry.startTime,
          durationMs: entry.duration,
          scope:
            probe.measurementStart === null || entry.startTime < probe.measurementStart
              ? 'setup'
              : 'image',
        };
        probe.longTasks.push(task);
        emit({ type: 'longtask', ...task });
      }
    });
    observer.observe({ type: 'longtask', buffered: true });
    emit({ type: 'observer', supported: true });
  } catch (error) {
    emit({ type: 'observer', supported: false, error: String(error) });
  }
  for (const type of ['input', 'change', 'click']) {
    document.addEventListener(
      type,
      () => {
        probe.lastEventAt = performance.now();
        probe.settledAt = null;
      },
      true,
    );
  }
  let previous;
  new MutationObserver(() => {
    const text = document.querySelector('.sr-only[role="status"]')?.textContent?.trim() ?? '';
    if (!text || text === previous) return;
    previous = text;
    const event = { stage: probe.stage, at: performance.now(), text };
    probe.events.push(event);
    if (text.includes('準備できました') && !text.includes('確かめ')) probe.settledAt = event.at;
    emit({ type: 'status', ...event });
  }).observe(document, { subtree: true, childList: true, characterData: true });
}

function snapshot() {
  const text = (selector) => document.querySelector(selector)?.textContent?.trim() ?? null;
  const canvas = document.querySelector('.picture canvas');
  return {
    status: text('.sr-only[role="status"]'),
    alerts: [...document.querySelectorAll('[role="alert"]')].map((e) => e.textContent.trim()),
    editNote: text('.edit-note'),
    selectedPreset: text('.presets [aria-pressed="true"]'),
    playEnabled: document.querySelector('.play')?.disabled === false,
    clock: text('.when span'),
    analysisSize: canvas ? { width: canvas.width, height: canvas.height } : null,
    resizeNote:
      [...document.querySelectorAll('.note')]
        .map((e) => e.textContent)
        .find((t) => t.includes('縮めて')) ?? null,
    islands: document.querySelectorAll('.swatch').length,
    controls: [...document.querySelectorAll('.slider input')].map((e) => ({
      name: e.getAttribute('aria-label'),
      value: Number(e.value),
      min: Number(e.min),
      max: Number(e.max),
      label: e.getAttribute('aria-valuetext'),
      disabled: e.disabled,
    })),
  };
}

async function ready(page) {
  await page.waitForFunction(
    () => {
      const status = document.querySelector('.sr-only[role="status"]')?.textContent ?? '';
      return (
        !document.querySelector('.picture-skeleton') &&
        !document.querySelector('[role="progressbar"]') &&
        (status.includes('準備できました') || status.includes('開けませんでした')) &&
        !status.includes('確かめ')
      );
    },
    null,
    { polling: 50, timeout: 0 },
  );
  // Let React commit and the status observer run, including immediate rejection/no-op paths.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  return page.evaluate(snapshot);
}

function round(value) {
  return Math.round(value * 10) / 10;
}
function message(error) {
  return error instanceof Error ? error.message : String(error);
}

async function testFixture(browser, url, fixture, file, settings) {
  const result = {
    ...fixture,
    bytes: file.bytes,
    inputFile: file.path,
    opened: false,
    timedOut: false,
    stage: 'navigation',
    operations: [],
    errors: [],
    statusHistory: [],
    longTasks: [],
    setupLongTasks: [],
    maxLongTaskMs: 0,
    longTaskObserver: null,
    default: null,
    playback: null,
    save: null,
    video: null,
  };
  const started = performance.now();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    reducedMotion: 'no-preference',
    serviceWorkers: 'block',
    acceptDownloads: true,
  });
  await context.exposeBinding('robustnessTelemetry', (_source, event) => {
    if (event.type === 'longtask') {
      if (event.scope === 'setup') {
        result.setupLongTasks.push(event);
        return;
      }
      result.longTasks.push(event);
      result.maxLongTaskMs = Math.max(result.maxLongTaskMs, event.durationMs);
    } else if (event.type === 'status') result.statusHistory.push(event);
    else if (event.type === 'observer') result.longTaskObserver = event;
  });
  await context.addInitScript(installProbe);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', (error) =>
    result.errors.push({ type: 'pageerror', stage: result.stage, message: message(error) }),
  );
  page.on('console', (entry) => {
    if (entry.type() === 'error')
      result.errors.push({ type: 'console.error', stage: result.stage, message: entry.text() });
  });
  page.on('crash', () =>
    result.errors.push({ type: 'crash', stage: result.stage, message: 'Chrome page crashed' }),
  );

  async function stage(name, action, settle = true) {
    if (result.timedOut) throw new Error(`画像の時間切れ後の操作は中止: ${name}`);
    result.stage = name;
    const operation = { stage: name, completed: false };
    result.operations.push(operation);
    const at = performance.now();
    try {
      await page.evaluate((name) => {
        if (name === 'open') window.__robustness.measurementStart = performance.now();
        return Object.assign(window.__robustness, {
          stage: name,
          lastEventAt: null,
          settledAt: null,
        });
      }, name);
      const detail = await action();
      if (settle) operation.state = await ready(page);
      operation.detail = detail ?? null;
      operation.timing = await page.evaluate(() => {
        const probe = window.__robustness;
        return {
          lastInputAt: probe.lastEventAt,
          settledAt: probe.settledAt,
          lastInputToSettledMs:
            probe.lastEventAt === null
              ? null
              : (probe.settledAt ?? performance.now()) - probe.lastEventAt,
          observedStatusTransition: probe.settledAt !== null,
        };
      });
      operation.completed = true;
    } catch (error) {
      if (result.timedOut) {
        operation.cancelledByCaseTimeout = true;
        operation.error = `1枚の上限 ${settings.timeout} 秒で中止`;
      } else {
        operation.error = message(error);
        result.errors.push({ type: 'operation', stage: name, message: message(error) });
      }
    } finally {
      operation.durationMs = round(performance.now() - at);
    }
    return operation;
  }

  async function download(name) {
    const started = performance.now();
    const button = page.getByRole('button', { name, exact: true });
    const enabled = await button.isEnabled();
    if (!enabled) return { enabled, downloaded: false, reason: 'ボタンが無効' };
    // Resolve on an export error too, rather than consuming the entire per-picture deadline.
    const downloadWait = page.waitForEvent('download', { timeout: 0 }).then((item) => ({ item }));
    const errorWait = page
      .waitForFunction(
        () => {
          const error = document.querySelector('.actions [role="alert"]');
          return error?.textContent;
        },
        null,
        { timeout: 0 },
      )
      .then(async (handle) => ({ error: await handle.jsonValue() }));
    // The context is closed after this case; both losing promises are always observed.
    void downloadWait.catch(() => {});
    void errorWait.catch(() => {});
    await button.click();
    const outcome = await Promise.race([downloadWait, errorWait]);
    if (outcome.error) return { enabled, downloaded: false, reason: outcome.error };
    const failure = await outcome.item.failure();
    const downloadedPath = failure ? null : await outcome.item.path();
    const bytes = downloadedPath ? (await stat(downloadedPath)).size : 0;
    return {
      enabled,
      downloaded: !failure && bytes > 0,
      filename: outcome.item.suggestedFilename(),
      bytes,
      failure,
      downloadMs: round(performance.now() - started),
    };
  }

  async function run() {
    // A single Node-side deadline owns navigation and all subsequent operations.
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 0 });
    await page.getByLabel('画像ファイル', { exact: true }).waitFor({ state: 'attached' });
    const open = await stage('open', () =>
      page.getByLabel('画像ファイル', { exact: true }).setInputFiles(file.path),
    );
    result.opened =
      open.completed &&
      open.state.status?.includes('準備できました') &&
      (await page.locator('.picture canvas').getAttribute('aria-label')) ===
        `${fixture.name}の色の台本`;
    result.openMs = open.durationMs;
    result.analysisSize = result.opened ? open.state.analysisSize : null;
    result.default = open.state
      ? { ...open.state, passed: open.state.playEnabled, reason: open.state.editNote }
      : null;
    if (!result.opened) return;
    const playback = await stage(
      'playback',
      async () => {
        const enabled = await page.getByRole('button', { name: '再生', exact: true }).isEnabled();
        if (!enabled)
          return { enabled, advanced: false, reason: open.state.editNote ?? '再生ボタンが無効' };
        const before = Number.parseFloat(await page.locator('.when span').textContent());
        await page.getByRole('button', { name: '再生', exact: true }).click();
        await page.waitForTimeout(1000);
        const after = Number.parseFloat(await page.locator('.when span').textContent());
        await page.getByRole('button', { name: '一時停止', exact: true }).click();
        return { enabled, before, after, advanced: after > before, observationMs: 1000 };
      },
      false,
    );
    result.playback = playback.detail;
    const save = await stage('save-png', () => download('この瞬間を画像で保存'), false);
    result.save = save.detail;
    const video = page.getByRole('button', { name: '動画を書き出す', exact: true });
    result.video = { enabled: await video.isEnabled(), requested: settings.export };
    result.video.attempted = settings.export && result.video.enabled;
    if (settings.export && result.video.enabled) {
      const exported = await stage('export-video', () => download('動画を書き出す'));
      Object.assign(result.video, exported.detail, { durationMs: exported.durationMs });
    }
    for (const label of ['夜の深さ', '灯りの強さ']) {
      // Each slider starts from the default preset; the other one stays at its default.
      await stage(`reset-before-${label}`, () =>
        page.getByRole('button', { name: presets[0], exact: true }).click(),
      );
      for (const endpoint of ['min', 'max']) {
        await stage(`slider-${label}-${endpoint}`, async () => {
          const control = page.getByRole('slider', { name: label, exact: true });
          const before = await control.evaluate((e) => ({
            value: Number(e.value),
            min: Number(e.min),
            max: Number(e.max),
          }));
          await control.press(endpoint === 'min' ? 'Home' : 'End');
          return { requested: before[endpoint], before };
        });
        const operation = result.operations.at(-1);
        operation.accepted = operation.state?.controls.find((c) => c.name === label) ?? null;
        operation.passed = operation.completed && !operation.state.editNote;
      }
    }
    for (const name of [presets[1], presets[2], presets[0]]) {
      const operation = await stage(`preset-${name}`, () =>
        page.getByRole('button', { name, exact: true }).click(),
      );
      operation.passed =
        operation.completed && !operation.state.editNote && operation.state.selectedPreset === name;
    }
    const role = await stage('island-role', async () => {
      const swatch = page.locator('.swatch').first();
      if (!(await swatch.count())) return { skipped: true, reason: '選択できる島がない' };
      const island = await swatch.getAttribute('data-testid');
      await swatch.click();
      const control = page.getByRole('combobox', { name: '役割', exact: true });
      const before = await control.inputValue();
      const requested = before === 'sky' ? 'water' : 'sky';
      await control.selectOption(requested);
      return { island, before, requested };
    });
    if (role.detail && !role.detail.skipped && role.completed) {
      role.detail.accepted = await page
        .getByRole('combobox', { name: '役割', exact: true })
        .inputValue();
      role.passed = role.detail.accepted === role.detail.requested && !role.state.editNote;
      // Return the selected island to its original role before testing a split.
      await stage('reset-island-role', () =>
        page.getByRole('combobox', { name: '役割', exact: true }).selectOption(role.detail.before),
      );
      const split = await stage('island-split', async () => {
        const before = await page.locator('.swatch').count();
        await page.getByRole('button', { name: '上下の線で分ける', exact: true }).click();
        const line = page.getByRole('slider', { name: '島を分ける線', exact: true });
        const position = await line.getAttribute('aria-valuenow');
        // Keep both roles unchanged to isolate the cost/acceptance of the split itself.
        await page.getByRole('button', { name: '分ける', exact: true }).click();
        return { before, position: Number(position) };
      });
      split.passed =
        split.completed && !split.state.editNote && split.state.islands === split.detail.before + 1;
    } else {
      result.operations.push({
        stage: 'island-split',
        completed: false,
        skipped: true,
        reason: '島の選択・役割変更を完了できない',
      });
    }
  }

  let timer;
  try {
    await Promise.race([
      run(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          result.timedOut = true;
          result.timeoutStage = result.stage;
          reject(new Error(`1枚の上限 ${settings.timeout} 秒: ${result.stage}`));
        }, settings.timeout * 1000);
      }),
    ]);
  } catch (error) {
    result.errors.push({ type: 'case', stage: result.stage, message: message(error) });
  } finally {
    clearTimeout(timer);
    // Closing aborts outstanding Playwright calls, even if the renderer is in a long task.
    await context.close();
    result.totalMs = round(performance.now() - started);
    result.maxLongTaskMs = round(result.maxLongTaskMs);
  }
  return result;
}

function problems(result) {
  const issues = [];
  if (!result.opened) issues.push(`開けない（${result.timeoutStage ?? 'open'}）`);
  if (result.timedOut) issues.push(`時間切れ: ${result.timeoutStage}`);
  if (result.opened && !result.default?.playEnabled)
    issues.push(
      `既定で再生できない: ${result.default?.editNote ?? result.default?.alerts.join(' / ')}`,
    );
  if (result.playback?.enabled && !result.playback.advanced)
    issues.push('再生1秒後に時刻が進まない');
  for (const operation of result.operations) {
    if (operation.durationMs > 3000) issues.push(`${operation.stage}: ${operation.durationMs} ms`);
    if (!operation.completed && !operation.skipped && !operation.cancelledByCaseTimeout)
      issues.push(`${operation.stage}: ${operation.error ?? '未完了'}`);
    if (operation.passed === false && !operation.stage.startsWith('slider-'))
      issues.push(
        `${operation.stage}: 拒否（${operation.state?.editNote ?? '変更が反映されない'}）`,
      );
    if (operation.skipped || operation.detail?.skipped)
      issues.push(`${operation.stage}: 未実施（${operation.reason ?? operation.detail?.reason}）`);
    for (const alert of operation.state?.alerts ?? []) {
      if (alert !== operation.state.editNote) issues.push(`${operation.stage}: ${alert}`);
    }
  }
  if (result.maxLongTaskMs > 200) issues.push(`long task: ${result.maxLongTaskMs} ms`);
  if (result.longTaskObserver?.supported !== true) issues.push('long task の観測ができない');
  if (result.save && !result.save.downloaded) issues.push('PNGを保存できない');
  if (result.video?.attempted && result.video.enabled && !result.video.downloaded)
    issues.push('動画を書き出せない');
  for (const error of result.errors) {
    if (!(result.timedOut && error.type === 'case'))
      issues.push(`${error.type} / ${error.stage}: ${error.message}`);
  }
  // Rejection/limit messages are recorded, but expected slider limits alone are not an error.
  return [...new Set(issues)];
}

function markdown(report) {
  const cell = (value) =>
    String(value ?? '—')
      .replaceAll('|', '\\|')
      .replaceAll('\n', ' ');
  const maxTime = (result, prefix) => {
    const operations = result.operations.filter((op) => op.stage.startsWith(prefix));
    return operations.length ? Math.max(...operations.map((op) => op.durationMs ?? 0)) : '—';
  };
  const lines = [
    '# いろいろな絵の実機検査',
    '',
    `実行日時: ${report.when} / URL: ${report.url} / Chrome: ${report.browser ?? '起動失敗'}`,
    `検査ワークツリーHEAD: ${report.gitHead ?? '不明'}${report.options.url ? '（公開サイトの配信コミットは未確認）' : ''} / 1枚の上限: ${report.options.timeout} 秒 / 動画の実書き出し: ${report.options.export ? 'あり' : 'なし'}`,
    '',
    `全${report.results.length}枚、問題のある絵 ${report.problemCount}枚。実行時間 ${round(report.durationMs / 1000)} 秒。`,
    '',
    '時間は ms。開く時間はファイルを input に渡す直前から準備完了まで（ファイル転送を含む）。操作時間は操作開始から画面の検査完了まで。JSON の timing.lastInputToSettledMs はブラウザー内の最後の入力イベントから準備状態へ戻った時点まで（状態遷移がない場合は観測終了まで）。',
    '解析寸法は描画キャンバスのピクセル寸法。long task はファイルを渡す直前からページを閉じるまでの main thread の観測最大値。画像と無関係な初期起動は JSON の setupLongTasks に分け、生成用ページは含まない。時間切れで継続中の task は未観測のため下限値になる。',
    'スライダーは1本ずつ既定の台本へ戻して min → max。台本は長い夕暮れ → 夜の灯り → 1日の光。最初の島を空または水へ変え、元に戻して同じ役割のまま上下に分割。PNG保存と動画ボタンの確認は既定状態で行う。',
    '生成画像は test/results/robustness-inputs/ の実行別フォルダーに保存し、setInputFiles(path) で渡す。buffer渡しのブラウザー内File組み立てによるlong taskを混ぜず、生成物も再確認できる。',
    '設定の拒否・スライダーの制限はすべてJSONに残す。問題判定: 開けない、時間切れ、既定で再生できない、操作3秒超、long task 200ms超、保存失敗、エラー。通常の範囲制限だけでは問題に数えない。',
    '',
    '| 絵 / 形式 / 元の寸法 | 開く | 解析寸法 | 既定再生 / 1秒後 | スライダー最大 | 台本最大 | 役割 / 分割 | PNG / 動画ボタン | long task最大 | 結果 |',
    '|---|---:|---|---|---:|---:|---|---|---:|---|',
  ];
  for (const result of report.results) {
    const operation = (name) => result.operations.find((op) => op.stage === name);
    const png = result.save ? (result.save.downloaded ? '保存' : '不可') : '未確認';
    let video = result.video ? (result.video.enabled ? '可' : '不可') : '未確認';
    if (result.video?.attempted)
      video = result.video.downloaded ? `保存（${result.video.durationMs} ms）` : '書出失敗';
    lines.push(
      `| ${cell(`${result.name}: ${result.description} / ${result.mimeType} / ${result.width}×${result.height}`)} | ${result.openMs ?? '—'} | ${result.analysisSize ? `${result.analysisSize.width}×${result.analysisSize.height}` : '—'} | ${result.default?.playEnabled ? '可' : '不可'} / ${result.playback?.advanced ? '進む' : '—'} | ${maxTime(result, 'slider-')} | ${maxTime(result, 'preset-')} | ${operation('island-role')?.durationMs ?? '—'} / ${operation('island-split')?.durationMs ?? '—'} | ${png} / ${video} | ${result.maxLongTaskMs} | ${result.issues.length ? `問題${result.issues.length}件` : '通過'}${result.timedOut ? `・時間切れ(${cell(result.timeoutStage)})` : ''} |`,
    );
  }
  lines.push('', '## 問題のある絵', '');
  for (const result of report.results.filter((r) => r.issues.length)) {
    lines.push(`### ${result.name}（${result.description}）`, '');
    for (const issue of result.issues) lines.push(`- ${cell(issue)}`);
    lines.push('');
  }
  lines.push('## 拒否・制限・未実施の操作', '');
  for (const result of report.results) {
    const rejected = result.operations.filter(
      (op) => op.passed === false || op.skipped || op.detail?.skipped,
    );
    if (rejected.length) {
      lines.push(
        `- ${result.name}: ${rejected.map((op) => `${op.stage} = ${cell(op.state?.editNote ?? op.reason ?? op.detail?.reason ?? '受け入れられなかった')}${op.accepted ? `（位置${op.accepted.value}、${op.accepted.label}、範囲${op.accepted.min}〜${op.accepted.max}）` : ''}`).join(' / ')}`,
      );
    }
  }
  if (report.fatalError) lines.push('', `検査の実行エラー: ${cell(report.fatalError)}`);
  return `${lines.join('\n')}\n`;
}

async function main() {
  const settings = options(process.argv.slice(2));
  if (settings.help) {
    console.log(
      'npm run test:robustness -- [--url URL] [--only name,...] [--timeout seconds=180] [--export] [--strict] [--list]',
    );
    return;
  }
  if (settings.list) {
    for (const fixture of fixtures) console.log(`${fixture.name}\t${fixture.description}`);
    return;
  }
  const selected = fixtures.filter(
    (fixture) => !settings.only || settings.only.includes(fixture.name),
  );
  await mkdir(out, { recursive: true });
  const when = new Date().toISOString();
  const inputDirectory = path.join(out, 'robustness-inputs', when.replaceAll(':', '-'));
  await mkdir(inputDirectory, { recursive: true });
  // Preserve measurements from previous invocations, including local vs public-site runs.
  for (const extension of ['json', 'md']) {
    try {
      await copyFile(
        path.join(out, `robustness.${extension}`),
        path.join(out, `robustness-before-${when.replaceAll(':', '-')}.${extension}`),
      );
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const report = {
    when,
    options: settings,
    inputDirectory,
    fixtures: selected,
    results: [],
    problemCount: 0,
  };
  try {
    report.gitHead = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
  } catch {
    report.gitHead = null;
  }
  let browser, server;
  const at = performance.now();
  async function saveReport() {
    report.problemCount = report.results.filter((r) => r.issues.length > 0).length;
    report.durationMs = round(performance.now() - at);
    await writeFile(path.join(out, 'robustness.json'), `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(path.join(out, 'robustness.md'), markdown(report));
  }
  try {
    if (!settings.url) {
      server = await createServer({
        root,
        base: '/',
        logLevel: 'error',
        server: {
          host: '127.0.0.1',
          port: 0,
          hmr: false,
          watch: { ignored: ['**/test/results/**'] },
        },
      });
      await server.listen();
    }
    report.url = settings.url ?? server.resolvedUrls.local[0];
    browser = await chromium.launch({ channel: 'chrome' });
    report.browser = browser.version();
    const generator = await browser.newPage();
    for (const fixture of selected) {
      console.log(`[${report.results.length + 1}/${selected.length}] ${fixture.name}`);
      let result;
      try {
        const generatedAt = performance.now();
        const base64 = await generator.evaluate(generateImage, fixture);
        const generationMs = round(performance.now() - generatedAt);
        const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[
          fixture.mimeType
        ];
        const inputPath = path.join(inputDirectory, `${fixture.name}.${extension}`);
        const buffer = Buffer.from(base64, 'base64');
        await writeFile(inputPath, buffer, { flag: 'wx' });
        result = await testFixture(
          browser,
          report.url,
          fixture,
          {
            path: inputPath,
            bytes: buffer.length,
          },
          settings,
        );
        result.generationMs = generationMs;
      } catch (error) {
        result = {
          ...fixture,
          opened: false,
          operations: [],
          errors: [{ type: 'harness', stage: 'generation-or-context', message: message(error) }],
          maxLongTaskMs: 0,
          totalMs: 0,
        };
      }
      result.issues = problems(result);
      report.results.push(result);
      await saveReport();
      console.log(
        `  ${result.opened ? '開けた' : '開けない'} / ${result.totalMs} ms / 問題${result.issues.length}件${result.timedOut ? ` / 時間切れ: ${result.timeoutStage}` : ''}`,
      );
    }
    await generator.close();
  } catch (error) {
    report.fatalError = message(error);
  } finally {
    await browser?.close();
    await server?.close();
    await saveReport();
  }
  console.log(
    `問題のある絵: ${report.problemCount} / ${report.results.length}枚（${round(report.durationMs / 1000)}秒）`,
  );
  console.log(path.join(out, 'robustness.md'));
  if (report.fatalError) {
    console.error(report.fatalError);
    process.exitCode = 1;
  } else if (settings.strict && report.problemCount) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(message(error));
  process.exitCode = 1;
}
