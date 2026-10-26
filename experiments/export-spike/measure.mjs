// Measures the exports with ffprobe/ffmpeg and refreshes the generated block in NOTES.md.
//
//   node measure.mjs
//
// PSNR/SSIM compare each decoded file against the reference PNG sequence the encoder
// saw, converted to RGB24 so chroma subsampling loss counts (that is what a viewer sees).
// Loop seam numbers compare frame 0 against the last frame, next to the median
// frame-to-frame PSNR of the same file: if the wrap is no bigger a jump than any other
// frame step, the loop closes smoothly.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname;
const OUT = path.join(HERE, 'out');
const TMP = path.join(OUT, 'metrics-tmp');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

const JOBS = [
  { name: 'loop-1280x720-h264.mp4', ref: 'ref-1280x720-30fps', fps: 30, frames: 240, label: 'MP4 / H.264', size: '1280×720' },
  { name: 'loop-1920x1080-h264.mp4', ref: 'ref-1920x1080-30fps', fps: 30, frames: 240, label: 'MP4 / H.264', size: '1920×1080' },
  { name: 'loop-1280x720-vp9.webm', ref: 'ref-1280x720-30fps', fps: 30, frames: 240, label: 'WebM / VP9', size: '1280×720' },
  { name: 'loop-1920x1080-vp9.webm', ref: 'ref-1920x1080-30fps', fps: 30, frames: 240, label: 'WebM / VP9', size: '1920×1080' },
  { name: 'loop-960x540-20fps.gif', ref: 'ref-960x540-20fps', fps: 20, frames: 160, label: 'GIF / ローカルパレット', size: '960×540' },
  { name: 'loop-960x540-20fps-global-palette.gif', ref: 'ref-960x540-20fps', fps: 20, frames: 160, label: 'GIF / 全体パレット', size: '960×540' },
];

function sh(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, cwd });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function probe(file) {
  const r = sh('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  if (r.status !== 0) throw new Error(`ffprobe failed on ${file}: ${r.stderr}`);
  const json = JSON.parse(r.stdout);
  const v = json.streams.find((s) => s.codec_type === 'video');
  const fps = v.avg_frame_rate ?? v.r_frame_rate;
  const [num, den] = String(fps).split('/').map(Number);
  return {
    format: json.format.format_name,
    codec: v.codec_name,
    profile: v.profile ?? null,
    level: v.level ?? null,
    width: v.width,
    height: v.height,
    pixFmt: v.pix_fmt,
    colorSpace: v.color_space ?? null,
    colorRange: v.color_range ?? null,
    nbFrames: v.nb_frames ? Number(v.nb_frames) : null,
    avgFrameRate: fps,
    avgFps: den ? +(num / den).toFixed(3) : null,
    duration: Number(json.format.duration ?? v.duration),
    bitRate: json.format.bit_rate ? Number(json.format.bit_rate) : null,
    sizeBytes: Number(json.format.size),
    raw: { stream: v, format: { format_name: json.format.format_name, duration: json.format.duration, size: json.format.size, bit_rate: json.format.bit_rate } },
  };
}

// Per-frame PSNR/SSIM against the reference PNG sequence.
// ffmpeg runs with cwd = out/metrics-tmp and writes stats files by bare name: a Windows
// path inside a filtergraph would be mangled by the ':' separator.
const STATS_CWD = TMP;

function statsArgs(name) {
  return `stats_file=${name}`;
}

function psnrVsReference(file, refDir, fps, tag) {
  const logName = `${tag}-psnr.log`;
  const r = sh('ffmpeg', [
    '-hide_banner', '-nostdin', '-y',
    '-framerate', String(fps), '-i', path.join(refDir, 'f%04d.png'),
    '-i', file,
    '-lavfi', `[0:v]format=rgb24[a];[1:v]format=rgb24[b];[a][b]psnr=${statsArgs(logName)}`,
    '-f', 'null', '-',
  ], STATS_CWD);
  if (r.status !== 0) throw new Error(`psnr failed on ${file}: ${r.stderr.slice(-800)}`);
  return parsePsnr(path.join(TMP, logName));
}

function ssimVsReference(file, refDir, fps, tag) {
  const logName = `${tag}-ssim.log`;
  const r = sh('ffmpeg', [
    '-hide_banner', '-nostdin', '-y',
    '-framerate', String(fps), '-i', path.join(refDir, 'f%04d.png'),
    '-i', file,
    '-lavfi', `[0:v]format=rgb24[a];[1:v]format=rgb24[b];[a][b]ssim=${statsArgs(logName)}`,
    '-f', 'null', '-',
  ], STATS_CWD);
  if (r.status !== 0) throw new Error(`ssim failed on ${file}: ${r.stderr.slice(-800)}`);
  const values = parseColumn(path.join(TMP, logName), /All:([\d.]+)/);
  return summarize(values);
}

function parsePsnr(log) {
  return summarize(parseColumn(log, /psnr_avg:([\d.]+|inf)/, true));
}

function parseColumn(log, re, allowInf = false) {
  return fs.readFileSync(log, 'utf8').trim().split('\n').map((line) => {
    const m = re.exec(line);
    if (!m) return null;
    if (allowInf && m[1] === 'inf') return Infinity;
    return Number(m[1]);
  }).filter((v) => v !== null);
}

function summarize(values) {
  if (!values.length) return null;
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return { n: values.length, mean: 'inf', min: 'inf', median: 'inf', max: 'inf', infinite: true };
  const sorted = [...finite].sort((a, b) => a - b);
  const mean = finite.reduce((a, b) => a + b, 0) / finite.length;
  return {
    n: values.length,
    mean: +mean.toFixed(3),
    min: +sorted[0].toFixed(3),
    median: +sorted[Math.floor(sorted.length / 2)].toFixed(3),
    max: +sorted[sorted.length - 1].toFixed(3),
    infinite: finite.length !== values.length,
  };
}

// Same-file comparisons stay in the decoded YUV domain: this is "how different do two
// frames look", not "how much did the codec lose".
function framePairPsnr(file, tag, filters) {
  const logName = `${tag}.log`;
  const r = sh('ffmpeg', [
    '-hide_banner', '-nostdin', '-y', '-i', file,
    '-lavfi', `${filters};[x][y]psnr=${statsArgs(logName)}`,
    '-f', 'null', '-',
  ], STATS_CWD);
  if (r.status !== 0) throw new Error(`psnr pair failed on ${file}: ${r.stderr.slice(-800)}`);
  return parsePsnr(path.join(TMP, logName));
}

function seam(file, frames, tag) {
  const last = frames - 1;
  const wrap = framePairPsnr(file, `${tag}-wrap`,
    `[0:v]split=2[a][b];[a]select='eq(n\\,0)',setpts=N/TB[x];[b]select='eq(n\\,${last})',setpts=N/TB[y]`);
  const adjacent = framePairPsnr(file, `${tag}-adj`,
    `[0:v]split=2[a][b];[a]select='lt(n\\,${last})',setpts=N/TB[x];[b]select='gt(n\\,0)',setpts=N/TB[y]`);
  return { wrap: wrap?.mean ?? null, adjacentMedian: adjacent?.median ?? null, adjacent };
}

// The source closes exactly if the still at t=8 is byte-identical to the one at t=0.
function stillSeam(width, height) {
  const dir = path.join(OUT, `stills-${width}x${height}`);
  const a = fs.readFileSync(path.join(dir, 't0.png'));
  const b = fs.readFileSync(path.join(dir, 't8.png'));
  return { identical: a.equals(b), bytes: a.length };
}

const run = JSON.parse(fs.readFileSync(path.join(OUT, 'run.json'), 'utf8'));
const results = [];

for (const job of JOBS) {
  const file = path.join(OUT, job.name);
  if (!fs.existsSync(file)) {
    console.error('missing', job.name);
    continue;
  }
  const tag = job.name.replace(/[^\w.-]+/g, '_');
  const meta = probe(file);
  const psnr = psnrVsReference(file, path.join(OUT, job.ref), job.fps, tag);
  const ssim = ssimVsReference(file, path.join(OUT, job.ref), job.fps, tag);
  const seams = seam(file, job.frames, tag);
  const stats = run.exports.find((e) => e.name === job.name);
  results.push({ ...job, ...meta, psnr, ssim, seams, encode: stats ?? null });
  console.log(job.name, 'psnr', psnr.mean, 'ssim', ssim.mean, 'seam', seams.wrap, 'adj', seams.adjacentMedian);
}

const stillRows = {};
for (const [w, h] of [[1280, 720], [1920, 1080], [960, 540]]) {
  stillRows[`${w}x${h}`] = stillSeam(w, h);
}

const metrics = {
  measuredAt: new Date().toISOString(),
  machine: {
    chrome: run.browser?.version,
    userAgent: run.browser?.userAgent,
    gpu: run.browser?.gpu?.renderer,
    ffmpeg: sh('ffmpeg', ['-version']).stdout.split('\n')[0],
  },
  settings: run.settings,
  determinism: run.determinism,
  stillSeam: stillRows,
  results,
};
fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify(metrics, null, 2));
console.log('wrote', path.join(OUT, 'metrics.json'));

// ---- generated block for NOTES.md -------------------------------------------------
const fmt = (n, digits = 2) => (typeof n === 'number' ? n.toFixed(digits) : String(n ?? '—'));
const levelOf = (r) => (r.level && r.level > 0 ? `${r.profile}, level ${(r.level / 10).toFixed(1)}` : (r.profile ?? null));
const codecOf = (r) => (levelOf(r) ? `${r.codec} (${levelOf(r)})` : r.codec);

const timeTable = [
  '| 形式 | 大きさ | コマ数 | 描画 + 取り込み | 符号化 | 多重化 | 合計 | 実時間比 | ファイル |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
];
for (const r of results) {
  const e = r.encode;
  const isGif = e?.format === 'gif';
  const renderMs = e ? Math.round((e.renderMs ?? 0) + (e.captureMs ?? 0)) : null;
  // Video: encoder queue + flush. GIF has no encoder stage, so the same column holds
  // palette build + quantise + stream write.
  const encodeMs = e
    ? Math.round(isGif ? (e.paletteMs ?? 0) + (e.mapMs ?? 0) + (e.writeMs ?? 0) : e.encodeMs)
    : null;
  const muxMs = e?.muxMs ?? null;
  const total = e ? Math.round(e.totalMs) : null;
  const speed = e ? (run.settings.seconds * 1000 / e.totalMs).toFixed(1) : '—';
  timeTable.push(
    `| ${r.label} | ${r.size} | ${r.frames} | ${renderMs ?? '—'} ms | ${encodeMs == null ? '—' : encodeMs + ' ms'} | ${muxMs == null ? '—' : muxMs.toFixed(1) + ' ms'} | ${total ?? '—'} ms | ${speed}× | ${fmt(r.sizeBytes / 1048576)} MB |`,
  );
}

const qualityTable = [
  '| 形式 | 大きさ | PSNR (RGB) 平均 | PSNR 最小 | SSIM (RGB) | 継ぎ目 PSNR | 隣接フレーム PSNR (中央値) |',
  '| --- | --- | --- | --- | --- | --- | --- |',
];
for (const r of results) {
  qualityTable.push(
    `| ${r.label} | ${r.size} | ${fmt(r.psnr.mean)} dB | ${fmt(r.psnr.min)} dB | ${fmt(r.ssim.mean, 3)} | ${fmt(r.seams.wrap)} dB | ${fmt(r.seams.adjacentMedian)} dB |`,
  );
}

const probeTable = [
  '| ファイル | コンテナ | コーデック | 解像度 | fps | 長さ | フレーム数 | ビットレート |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
];
for (const r of results) {
  probeTable.push(
    `| \`${r.name}\` | ${r.format} | ${codecOf(r)} | ${r.width}×${r.height} | ${r.avgFps} | ${fmt(r.duration, 3)} s | ${r.nbFrames ?? '—'} | ${r.codec === 'gif' || !r.bitRate ? '—' : fmt(r.bitRate / 1e6) + ' Mb/s'} |`,
  );
}

const probeBlocks = results.map((r) => [
  `**${r.name}**`,
  '',
  '```',
  `format_name      ${r.format}`,
  `codec_name       ${codecOf(r)}`,
  `width x height   ${r.width} x ${r.height}`,
  `pix_fmt          ${r.pixFmt}${r.colorSpace ? ` / ${r.colorSpace}${r.colorRange ? ` / ${r.colorRange}` : ''}` : ''}`,
  `nb_frames        ${r.nbFrames ?? '(未記録)'}`,
  `avg_frame_rate   ${r.avgFrameRate}${r.avgFps ? ` (${r.avgFps} fps)` : ''}`,
  `duration         ${r.duration.toFixed(3)} s`,
  `bit_rate         ${r.bitRate ? `${(r.bitRate / 1e6).toFixed(2)} Mb/s` : '(未記録)'}`,
  `size             ${r.sizeBytes} bytes`,
  '```',
  '',
].join('\n')).join('\n');

const seamNote = Object.entries(stillRows)
  .map(([k, v]) => `- ${k.replace('x', '×')}: t=0 と t=8 の PNG が${v.identical ? '**完全一致**（バイト単位で同じ）' : '不一致'}`)
  .join('\n');

const block = [
  '<!-- metrics:start -->',
  '<!-- この節は measure.mjs が out/metrics.json から自動生成する。手で編集しない。 -->',
  '',
  '### 時間とサイズ',
  '',
  ...timeTable,
  '',
  '「符号化」は `VideoEncoder` に投げてから `flush()` が返るまで。「多重化」は muxer の',
  '`finalize()`。GIF には符号化の段が無いので、同じ列にパレット作成・量子化・ストリーム書き出しの',
  '合計を入れてある。「実時間比」は 8 秒ぶんを何倍速で書き出せたか。',
  '',
  '### 品質',
  '',
  ...qualityTable,
  '',
  'PSNR/SSIM は元のフレーム（PNG、RGB24）と復号結果を RGB で比べたもの。色変換は各ファイルが',
  '宣言している BT.709 に従わせている。PSNR は全フレームの平均と最小。',
  '「継ぎ目 PSNR」は復号した先頭フレームと最終フレームの比較、「隣接フレーム PSNR」は同じ',
  'ファイルの全フレーム間 PSNR の中央値。両者が同程度なら、1周して戻る瞬間の見た目の差は',
  'ふつうのコマ送り1回分と同じで、継ぎ目は目立たない。',
  '',
  'ソースのループの閉じ方（同じ時刻を再レンダリングした結果の比較）:',
  '',
  seamNote,
  '',
  '### ffprobe の要点',
  '',
  ...probeTable,
  '',
  probeBlocks,
  '<!-- metrics:end -->',
].join('\n');

const notesPath = path.join(HERE, 'NOTES.md');
const notes = fs.readFileSync(notesPath, 'utf8');
const updated = notes.replace(/<!-- metrics:start -->[\s\S]*<!-- metrics:end -->/, block);
fs.writeFileSync(notesPath, updated);
console.log('updated', notesPath, updated === notes ? '(no change)' : '');
