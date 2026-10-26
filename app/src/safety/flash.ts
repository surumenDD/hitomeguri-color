// Detects flashes that can trigger photosensitive seizures ("dangerous flashing"), judged
// separately against WCAG 2.x SC 2.3.1 (general flash / red flash thresholds) and
// ITU-R BT.1702-3 Guideline 1. This is the browser-safe port of the analysis core in
// tools/visual-qa/flash-check.mjs: the algorithm, constants, rounding and report shape are
// unchanged, and only the PNG reader / CLI / ffmpeg parts are left out. See
// tools/visual-qa/README.md ("解釈") for how each criterion was read.

// Thresholds taken from the two criteria (line numbers in README "解釈").
const VISUAL_FIELD_CSS = [341, 256] as const; // 10 degree visual field at 1024x768 (WCAG Note 1)
const AREA_LIMIT = 0.25; // 25% of the visual field (WCAG) / of the screen (ITU)
const FLASH_LIMIT = 3; // more than three flashes in any one second is a failure
const ITU_GAP_MS = 334; // 60 Hz leading-edge spacing that is always acceptable
const DEFAULT_WHITE_CD = 200;
const DEFAULT_BLOCK = 8;
const DEFAULT_CSS_PX_PER_PX = 1;
const DEFAULT_MIN_SWING = 0.01;

export type FlashCriterion = 'wcag' | 'itu';

/** Options accepted by analyzeFrames. Omitted fields fall back to the tool defaults. */
export interface FlashOptions {
  blockSize?: number;
  cssPxPerPx?: number;
  whiteLuminanceCdM2?: number;
  minSwing?: number;
}

/** Settings actually used for an analysis, echoed back in the report. */
export interface FlashAnalysis {
  blockSize: number;
  cssPxPerPx: number;
  whiteLuminanceCdM2: number;
  minSwing: number;
  visualFieldCssPx: readonly [number, number];
  visualFieldBlocks: [number, number];
}

/** One-second window in which a single location blinked the most. */
export interface FlashWindow {
  startSec: number | null;
  endSec: number | null;
  flashCount: number;
  generalFlashes: number;
  redFlashes: number;
}

/** Verdict for one criterion (wcag or itu). */
export interface FlashVerdict {
  pass: boolean;
  rateExceeded: boolean;
  areaExceeded: boolean;
  worstWindow: FlashWindow;
  totalFlashes: number;
  maxFlashesPerSecond: number;
  maxGeneralFlashesPerSecond: number;
  maxRedFlashesPerSecond: number;
  minLeadingEdgeGapMs: number | null;
  maxConcurrentFlashAreaRatio: number;
}

/** Full analysis report. Same fields as the JSON printed by tools/visual-qa/flash-check.mjs. */
export interface FlashReport {
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  durationSec: number;
  analysis: FlashAnalysis;
  wcag: FlashVerdict;
  itu: FlashVerdict;
}

/** Options with every field resolved to a number. */
interface ResolvedFlashOptions {
  blockSize: number;
  cssPxPerPx: number;
  whiteLuminanceCdM2: number;
  minSwing: number;
}

const round = (x: number, d = 4): number => Math.round(x * 10 ** d) / 10 ** d;

// --- color: WCAG relative luminance and CIE 1976 UCS chromaticity ---
function toLinear(c8: number): number {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(r8: number, g8: number, b8: number): number {
  return 0.2126 * toLinear(r8) + 0.7152 * toLinear(g8) + 0.0722 * toLinear(b8);
}

type Chromaticity = readonly [number, number];

function chromaticity(r8: number, g8: number, b8: number): Chromaticity | null {
  const [r, g, b] = [toLinear(r8), toLinear(g8), toLinear(b8)];
  const X = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
  const Y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const Z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b;
  const d = X + 15 * Y + 3 * Z;
  return d > 0 ? [(4 * X) / d, (9 * Y) / d] : null; // pure black has no chromaticity
}

function isSaturatedRed(r8: number, g8: number, b8: number): boolean {
  return r8 + g8 + b8 > 0 && r8 / (r8 + g8 + b8) >= 0.8;
}

function chromaDistance(a: Chromaticity | null, b: Chromaticity | null): number {
  // Black has no u'v'; treat the pair as maximally different (the conservative side).
  if (!a || !b) return Infinity;
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

interface BlockState {
  r: number;
  g: number;
  b: number;
  L: number;
  uv: Chromaticity | null;
}

function blockState(r8: number, g8: number, b8: number): BlockState {
  return { r: r8, g: g8, b: b8, L: relativeLuminance(r8, g8, b8), uv: chromaticity(r8, g8, b8) };
}

// --- transitions ---
interface Extremum {
  i: number;
  v: number;
}

// Peaks and valleys of one block's luminance series. A reversal only counts once it has
// moved at least `swing` away from the last confirmed extremum, so small wobble is ignored.
function seriesExtrema(values: Float64Array, swing: number): Extremum[] {
  const extrema: Extremum[] = [];
  let dir = 0; // +1 rising, -1 falling, 0 not committed yet
  let runMax = values[0],
    runMaxI = 0;
  let runMin = values[0],
    runMinI = 0;
  let candI = 0,
    candV = values[0];
  for (let i = 1; i < values.length; i++) {
    const v = values[i];
    if (dir === 0) {
      if (v > runMax) {
        runMax = v;
        runMaxI = i;
      }
      if (v < runMin) {
        runMin = v;
        runMinI = i;
      }
      if (runMax - v >= swing) {
        extrema.push({ i: runMaxI, v: runMax });
        dir = -1;
        candI = i;
        candV = v;
        runMax = v;
        runMaxI = i;
        runMin = v;
        runMinI = i;
      } else if (v - runMin >= swing) {
        extrema.push({ i: runMinI, v: runMin });
        dir = 1;
        candI = i;
        candV = v;
        runMax = v;
        runMaxI = i;
        runMin = v;
        runMinI = i;
      }
    } else if (dir === 1) {
      if (v > candV) {
        candV = v;
        candI = i;
      } else if (candV - v >= swing) {
        extrema.push({ i: candI, v: candV });
        dir = -1;
        candI = i;
        candV = v;
      }
    } else {
      if (v < candV) {
        candV = v;
        candI = i;
      } else if (v - candV >= swing) {
        extrema.push({ i: candI, v: candV });
        dir = 1;
        candI = i;
        candV = v;
      }
    }
  }
  return extrema;
}

// --- frame collection: mean sRGB per block ---
/** Mean sRGB per block for one frame, rounded to 8 bit. */
interface BlockMean {
  r: Uint8Array;
  g: Uint8Array;
  b: Uint8Array;
}

interface Collector {
  cols: number;
  rows: number;
  blockAreas: Float64Array;
  means: BlockMean[];
  push(frame: Uint8Array): void;
}

// Frames are reduced to per-block mean colors (rounded to 8 bit) before analysis;
// that keeps the analysis cost at frame x block instead of frame x pixel.
function createCollector(width: number, height: number, blockSize: number): Collector {
  const cols = Math.ceil(width / blockSize);
  const rows = Math.ceil(height / blockSize);
  const n = cols * rows;
  const blockAreas = new Float64Array(n);
  for (let by = 0; by < rows; by++) {
    const bh = Math.min(blockSize, height - by * blockSize);
    for (let bx = 0; bx < cols; bx++) {
      blockAreas[by * cols + bx] = bh * Math.min(blockSize, width - bx * blockSize);
    }
  }
  const means: BlockMean[] = [];
  const sr = new Float64Array(n),
    sg = new Float64Array(n),
    sb = new Float64Array(n);
  return {
    cols,
    rows,
    blockAreas,
    means,
    push(frame) {
      sr.fill(0);
      sg.fill(0);
      sb.fill(0);
      for (let y = 0; y < height; y++) {
        const rowBase = y * width * 3;
        const gridBase = ((y / blockSize) | 0) * cols;
        for (let x = 0; x < width; x++) {
          const i = rowBase + x * 3;
          const bi = gridBase + ((x / blockSize) | 0);
          sr[bi] += frame[i];
          sg[bi] += frame[i + 1];
          sb[bi] += frame[i + 2];
        }
      }
      const r = new Uint8Array(n),
        g = new Uint8Array(n),
        b = new Uint8Array(n);
      for (let bi = 0; bi < n; bi++) {
        const a = blockAreas[bi];
        r[bi] = Math.round(sr[bi] / a);
        g[bi] = Math.round(sg[bi] / a);
        b[bi] = Math.round(sb[bi] / a);
      }
      means.push({ r, g, b });
    },
  };
}

// --- area accounting ---
interface AnalyzeContext {
  cols: number;
  rows: number;
  blockAreas: Float64Array;
  width: number;
  height: number;
  winCols: number;
  winRows: number;
  windowTotals: Float64Array;
  scratch: Float64Array;
}

function rectSum(
  S: Float64Array,
  cols: number,
  x: number,
  y: number,
  w: number,
  h: number,
): number {
  return (
    S[(y + h) * (cols + 1) + (x + w)] -
    S[y * (cols + 1) + (x + w)] -
    S[(y + h) * (cols + 1) + x] +
    S[y * (cols + 1) + x]
  );
}

// Largest share of a 341x256 CSS px visual field that concurrently flashing blocks cover.
function worstFieldRatio(grid: Float64Array, ctx: AnalyzeContext): number {
  const { cols, rows, winCols, winRows, windowTotals, scratch } = ctx;
  scratch.fill(0);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      scratch[(y + 1) * (cols + 1) + (x + 1)] =
        grid[y * cols + x] +
        scratch[y * (cols + 1) + (x + 1)] +
        scratch[(y + 1) * (cols + 1) + x] -
        scratch[y * (cols + 1) + x];
    }
  }
  let worst = 0;
  for (let y = 0; y + winRows <= rows; y++) {
    for (let x = 0; x + winCols <= cols; x++) {
      const ratio = rectSum(scratch, cols, x, y, winCols, winRows) / windowTotals[y * cols + x];
      if (ratio > worst) worst = ratio;
    }
  }
  return worst;
}

// One block's flashing span inside the frame range used for area accounting.
interface FlashSpan {
  bi: number;
  lead: number;
  end: number;
  area: number;
}

// Max concurrently flashing area over time: as a share of the screen (ITU) and as the
// worst share of any visual field (WCAG). A flash is active from its leading transition
// up to the second transition (the plateau of the middle state).
function areaRatios(
  list: readonly FlashSpan[],
  frameCount: number,
  ctx: AnalyzeContext,
): { screen: number; field: number } {
  const { cols, rows, width, height } = ctx;
  const grid = new Float64Array(cols * rows);
  const byLead = [...list].sort((a, b) => a.lead - b.lead);
  const byEnd = [...list].sort((a, b) => a.end - b.end);
  let iA = 0,
    iR = 0,
    active = 0,
    maxScreen = 0,
    maxField = 0;
  for (let f = 0; f < frameCount; f++) {
    while (iR < byEnd.length && byEnd[iR].end <= f) {
      const r = byEnd[iR++];
      if (grid[r.bi]) {
        grid[r.bi] = 0;
        active -= r.area;
      }
    }
    while (iA < byLead.length && byLead[iA].lead <= f) {
      const r = byLead[iA++];
      if (!grid[r.bi]) {
        grid[r.bi] = r.area;
        active += r.area;
      }
    }
    if (active > maxScreen) maxScreen = active;
    if (active > 0) maxField = Math.max(maxField, worstFieldRatio(grid, ctx));
  }
  return { screen: maxScreen / (width * height), field: maxField };
}

// --- one-second windows ---
interface FlashEvent {
  t: number;
  general: boolean;
  red: boolean;
}

function maxInOneSecond(events: readonly FlashEvent[], pred: (e: FlashEvent) => boolean): number {
  let best = 0,
    j = 0,
    count = 0;
  for (let i = 0; i < events.length; i++) {
    while (j < events.length && events[j].t < events[i].t + 1) {
      if (pred(events[j])) count++;
      j++;
    }
    if (count > best) best = count;
    if (pred(events[i])) count--;
  }
  return best;
}

function worstOneSecond(events: readonly FlashEvent[]): FlashWindow {
  let best: FlashWindow | null = null,
    bestTotal = -1,
    j = 0;
  let total = 0,
    general = 0,
    red = 0;
  for (let i = 0; i < events.length; i++) {
    while (j < events.length && events[j].t < events[i].t + 1) {
      const e = events[j++];
      total++;
      general += e.general ? 1 : 0;
      red += e.red ? 1 : 0;
    }
    if (total > bestTotal) {
      bestTotal = total;
      best = {
        startSec: round(events[i].t, 3),
        endSec: round(events[i].t + 1, 3),
        flashCount: total,
        generalFlashes: general,
        redFlashes: red,
      };
    }
    const e = events[i];
    total--;
    general -= e.general ? 1 : 0;
    red -= e.red ? 1 : 0;
  }
  return best ?? { startSec: null, endSec: null, flashCount: 0, generalFlashes: 0, redFlashes: 0 };
}

// --- verdict per criterion ---
/** One qualifying block flash: first transition at `lead`, second at `end`. */
interface FlashRecord extends FlashSpan {
  general: boolean;
  red: boolean;
}

// `list` holds qualifying block flashes as { bi, lead, end, area, general, red }.
// Frequency is counted per location (block): the criteria ask how often the same place
// blinks within one second, so flashes at different blocks are never summed together.
function judge(
  list: readonly FlashRecord[],
  frameCount: number,
  fps: number,
  ctx: AnalyzeContext,
  kind: FlashCriterion,
): FlashVerdict {
  const perBlock = new Map<number, FlashRecord[]>();
  for (const f of list) {
    const bucket = perBlock.get(f.bi);
    if (bucket) bucket.push(f);
    else perBlock.set(f.bi, [f]);
  }

  let worstWindow: FlashWindow = {
    startSec: null,
    endSec: null,
    flashCount: 0,
    generalFlashes: 0,
    redFlashes: 0,
  };
  let worstTotal = -1;
  let maxFlashesPerSecond = 0,
    maxGeneralFlashesPerSecond = 0,
    maxRedFlashesPerSecond = 0;
  let minLeadingEdgeGapMs: number | null = null;
  let rateExceeded = false;
  for (const flashes of perBlock.values()) {
    flashes.sort((a, b) => a.lead - b.lead);
    const events = flashes.map((f) => ({ t: f.lead / fps, general: f.general, red: f.red }));
    const w = worstOneSecond(events);
    if (w.flashCount > worstTotal) {
      worstTotal = w.flashCount;
      worstWindow = w;
    }
    const total = maxInOneSecond(events, () => true);
    const gen = maxInOneSecond(events, (e) => e.general);
    const red = maxInOneSecond(events, (e) => e.red);
    maxFlashesPerSecond = Math.max(maxFlashesPerSecond, total);
    maxGeneralFlashesPerSecond = Math.max(maxGeneralFlashesPerSecond, gen);
    maxRedFlashesPerSecond = Math.max(maxRedFlashesPerSecond, red);
    // ITU allows successive flashes whose leading edges are >= 334 ms apart (60 Hz).
    let wideGap = true;
    for (let i = 1; i < events.length; i++) {
      const gapMs = (events[i].t - events[i - 1].t) * 1000;
      if (minLeadingEdgeGapMs === null || gapMs < minLeadingEdgeGapMs)
        minLeadingEdgeGapMs = round(gapMs, 1);
      if (gapMs < ITU_GAP_MS) wideGap = false;
    }
    rateExceeded ||=
      kind === 'wcag' ? gen > FLASH_LIMIT || red > FLASH_LIMIT : total > FLASH_LIMIT && !wideGap;
  }

  const maxConcurrentFlashAreaRatio = round(
    overFrequentAreaRatio(perBlock, frameCount, fps, ctx, kind),
  );
  const areaExceeded = maxConcurrentFlashAreaRatio > AREA_LIMIT;

  return {
    pass: !(rateExceeded && areaExceeded),
    rateExceeded,
    areaExceeded,
    worstWindow,
    totalFlashes: list.length,
    maxFlashesPerSecond,
    maxGeneralFlashesPerSecond,
    maxRedFlashesPerSecond,
    minLeadingEdgeGapMs,
    maxConcurrentFlashAreaRatio,
  };
}

// Concurrent flashing area of the blocks that blink more than three times per second,
// measured inside the very one-second window where they do. WCAG: worst share of a
// 341x256 CSS px visual field. ITU: share of the screen. (More than three flashes in a
// window already implies leading edges closer than 334 ms, so the ITU gap allowance
// cannot rescue an over-frequent block here.)
function overFrequentAreaRatio(
  perBlock: ReadonlyMap<number, readonly FlashRecord[]>,
  frameCount: number,
  fps: number,
  ctx: AnalyzeContext,
  kind: FlashCriterion,
): number {
  const all: FlashRecord[] = [];
  for (const flashes of perBlock.values()) all.push(...flashes);
  if (!all.length) return 0;
  all.sort((a, b) => a.lead - b.lead);
  const windowFrames = Math.max(1, Math.round(fps));
  const anchors = [...new Set(all.map((f) => f.lead))];
  const counts = new Map<number, { total: number; general: number; red: number }>(); // bi -> inside the window
  const bump = (f: FlashRecord, d: number): void => {
    let c = counts.get(f.bi);
    if (!c) {
      c = { total: 0, general: 0, red: 0 };
      counts.set(f.bi, c);
    }
    c.total += d;
    if (f.general) c.general += d;
    if (f.red) c.red += d;
    if (c.total === 0) counts.delete(f.bi);
  };
  let maxRatio = 0,
    i = 0,
    j = 0;
  for (const w of anchors) {
    while (i < all.length && all[i].lead < w) bump(all[i++], -1);
    while (j < all.length && all[j].lead < w + windowFrames) bump(all[j++], 1);
    const len = Math.min(windowFrames, frameCount - w);
    if (len <= 0) continue;
    const sub: FlashSpan[] = [];
    for (const [bi, c] of counts) {
      const over =
        kind === 'wcag' ? c.general > FLASH_LIMIT || c.red > FLASH_LIMIT : c.total > FLASH_LIMIT;
      if (!over) continue;
      const flashes = perBlock.get(bi);
      if (!flashes) continue;
      for (const f of flashes) {
        const lead = Math.max(f.lead, w),
          end = Math.min(f.end, w + windowFrames);
        if (end > lead) sub.push({ bi, lead: lead - w, end: end - w, area: f.area });
      }
    }
    if (!sub.length) continue;
    const ratios = areaRatios(sub, len, ctx);
    const r = kind === 'wcag' ? ratios.field : ratios.screen;
    if (r > maxRatio) maxRatio = r;
  }
  return maxRatio;
}

// --- analysis core ---
function analyzeCollected(
  collector: Collector,
  width: number,
  height: number,
  fps: number,
  opts: ResolvedFlashOptions,
): FlashReport {
  const { cols, rows, blockAreas, means } = collector;
  const frameCount = means.length;
  const n = cols * rows;

  // Visual field window on the block grid (341x256 CSS px, rounded up to whole blocks).
  const winCols = Math.min(
    cols,
    Math.max(1, Math.round(VISUAL_FIELD_CSS[0] / (opts.blockSize * opts.cssPxPerPx))),
  );
  const winRows = Math.min(
    rows,
    Math.max(1, Math.round(VISUAL_FIELD_CSS[1] / (opts.blockSize * opts.cssPxPerPx))),
  );
  const scratch = new Float64Array((cols + 1) * (rows + 1));
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      scratch[(y + 1) * (cols + 1) + (x + 1)] =
        blockAreas[y * cols + x] +
        scratch[y * (cols + 1) + (x + 1)] +
        scratch[(y + 1) * (cols + 1) + x] -
        scratch[y * (cols + 1) + x];
    }
  }
  const windowTotals = new Float64Array(cols * rows);
  for (let y = 0; y + winRows <= rows; y++) {
    for (let x = 0; x + winCols <= cols; x++) {
      windowTotals[y * cols + x] = rectSum(scratch, cols, x, y, winCols, winRows);
    }
  }
  const ctx: AnalyzeContext = {
    cols,
    rows,
    blockAreas,
    width,
    height,
    winCols,
    winRows,
    windowTotals,
    scratch: new Float64Array((cols + 1) * (rows + 1)),
  };

  // Per block: find peaks and valleys of relative luminance, then pair adjacent
  // opposing transitions into flashes ((e0,e1,e2), (e2,e3,e4), ... so a periodic
  // blink counts one flash per cycle, matching "six changes = three flashes").
  const wcagList: FlashRecord[] = [];
  const ituList: FlashRecord[] = [];
  const lums = new Float64Array(frameCount);
  for (let bi = 0; bi < n; bi++) {
    for (let t = 0; t < frameCount; t++) {
      const m = means[t];
      lums[t] = relativeLuminance(m.r[bi], m.g[bi], m.b[bi]);
    }
    const extrema = seriesExtrema(lums, opts.minSwing);
    for (let k = 0; k + 2 < extrema.length; k += 2) {
      const e0 = extrema[k],
        e1 = extrema[k + 1],
        e2 = extrema[k + 2];
      const s0 = blockState(means[e0.i].r[bi], means[e0.i].g[bi], means[e0.i].b[bi]);
      const s1 = blockState(means[e1.i].r[bi], means[e1.i].g[bi], means[e1.i].b[bi]);
      const s2 = blockState(means[e2.i].r[bi], means[e2.i].g[bi], means[e2.i].b[bi]);
      const d1 = Math.abs(s1.L - s0.L),
        d2 = Math.abs(s2.L - s1.L);
      const dark = Math.min(s0.L, s1.L, s2.L),
        bright = Math.max(s0.L, s1.L, s2.L);
      // WCAG general flash: both opposing changes are >= 0.1 and the darker image is below 0.80.
      const general = Math.min(d1, d2) >= 0.1 && dark < 0.8;
      // WCAG red flash: one transition is to/from a saturated red and the states of that
      // transition are more than 0.2 apart in the CIE 1976 UCS chromaticity diagram.
      const red1 =
        (isSaturatedRed(s0.r, s0.g, s0.b) || isSaturatedRed(s1.r, s1.g, s1.b)) &&
        chromaDistance(s0.uv, s1.uv) > 0.2;
      const red2 =
        (isSaturatedRed(s1.r, s1.g, s1.b) || isSaturatedRed(s2.r, s2.g, s2.b)) &&
        chromaDistance(s1.uv, s2.uv) > 0.2;
      const red = red1 || red2;
      // ITU luminance rule: screen luminance = relative luminance x white luminance.
      const w = opts.whiteLuminanceCdM2;
      const ituHarmful = dark * w < 160 && (bright - dark) * w >= 20 && Math.min(d1, d2) * w >= 20;
      // ITU: a transition to or from a saturated red is harmful regardless of luminance.
      const ituRed =
        isSaturatedRed(s0.r, s0.g, s0.b) ||
        isSaturatedRed(s1.r, s1.g, s1.b) ||
        isSaturatedRed(s2.r, s2.g, s2.b);
      const rec = { bi, lead: e1.i, end: e2.i, area: blockAreas[bi] };
      if (general || red) wcagList.push({ ...rec, general, red });
      if (ituHarmful || ituRed) ituList.push({ ...rec, general: ituHarmful, red: ituRed });
    }
  }

  return {
    width,
    height,
    fps,
    frameCount,
    durationSec: round(frameCount / fps, 3),
    analysis: {
      blockSize: opts.blockSize,
      cssPxPerPx: opts.cssPxPerPx,
      whiteLuminanceCdM2: opts.whiteLuminanceCdM2,
      minSwing: opts.minSwing,
      visualFieldCssPx: VISUAL_FIELD_CSS,
      visualFieldBlocks: [winCols, winRows],
    },
    wcag: judge(wcagList, frameCount, fps, ctx, 'wcag'),
    itu: judge(ituList, frameCount, fps, ctx, 'itu'),
  };
}

/**
 * Analyzes RGB24 frames for dangerous flashing. `frames` is either one flat buffer of
 * `width * height * 3` bytes per frame back to back, or one Uint8Array per frame.
 */
export function analyzeFrames(
  frames: Uint8Array | readonly Uint8Array[],
  width: number,
  height: number,
  fps: number,
  options: FlashOptions = {},
): FlashReport {
  const opts: ResolvedFlashOptions = {
    blockSize: options.blockSize ?? DEFAULT_BLOCK,
    cssPxPerPx: options.cssPxPerPx ?? DEFAULT_CSS_PX_PER_PX,
    whiteLuminanceCdM2: options.whiteLuminanceCdM2 ?? DEFAULT_WHITE_CD,
    minSwing: options.minSwing ?? DEFAULT_MIN_SWING,
  };
  const frameSize = width * height * 3;
  const collector = createCollector(width, height, opts.blockSize);
  if (frames instanceof Uint8Array) {
    if (frames.byteLength % frameSize !== 0)
      throw new Error(`frame buffer is not a multiple of ${frameSize} bytes`);
    for (let off = 0; off < frames.byteLength; off += frameSize)
      collector.push(frames.subarray(off, off + frameSize));
  } else {
    for (const f of frames) {
      if (f.byteLength !== frameSize)
        throw new Error(`frame is ${f.byteLength} bytes, expected ${frameSize}`);
      collector.push(f);
    }
  }
  return analyzeCollected(collector, width, height, fps, opts);
}
