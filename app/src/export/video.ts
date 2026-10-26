import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type { Decomposition } from '../palette/types';
import { Renderer } from '../render';
import { estimateSetting } from '../safety/estimate';
import { analyzeFrames, type FlashReport } from '../safety/flash';
import { type Preset, type Role, rolePaletteAt } from '../script';

export interface ExportProgress {
  phase: 'analysis' | 'encoding';
  fraction: number;
}
export interface ExportOptions {
  maxEdge?: number;
  width?: number;
  height?: number;
  signal?: AbortSignal;
  progress?: (value: ExportProgress) => void;
}
export const exportSize = (width: number, height: number, maxEdge = 1920): [number, number] => {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return [
    Math.max(2, Math.floor((width * scale) / 2) * 2),
    Math.max(2, Math.floor((height * scale) / 2) * 2),
  ];
};
const abort = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('中止しました。', 'AbortError');
};
const yieldTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
function rgb(rgba: Uint8Array): Uint8Array {
  const out = new Uint8Array((rgba.length / 4) * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    out[j] = rgba[i];
    out[j + 1] = rgba[i + 1];
    out[j + 2] = rgba[i + 2];
  }
  return out;
}
export async function checkFrames(
  data: Decomposition,
  roles: Role[],
  preset: Preset,
  options: ExportOptions = {},
): Promise<FlashReport> {
  const canvas = document.createElement('canvas'),
    renderer = new Renderer(canvas);
  const [width, height] = exportSize(data.metadata.width, data.metadata.height, 384);
  const frames: Uint8Array[] = [],
    fps = 30,
    count = Math.round(fps * preset.durationSec);
  try {
    renderer.upload(data);
    renderer.size(width, height);
    for (let frame = 0; frame < count; frame++) {
      abort(options.signal);
      renderer.draw(rolePaletteAt(data.metadata.palette, roles, frame / fps, preset));
      frames.push(rgb(renderer.read()));
      if (frame % 15 === 0) {
        options.progress?.({ phase: 'analysis', fraction: frame / count });
        await yieldTask();
      }
    }
    const report = analyzeFrames(frames, width, height, fps, {
      blockSize: 2,
      cssPxPerPx: data.metadata.width / width,
    });
    options.progress?.({ phase: 'analysis', fraction: 1 });
    return report;
  } finally {
    renderer.dispose();
  }
}
export async function exportVideo(
  data: Decomposition,
  roles: Role[],
  preset: Preset,
  options: ExportOptions = {},
): Promise<{ blob: Blob; report: FlashReport; width: number; height: number; frames: number }> {
  const [naturalWidth, naturalHeight] = exportSize(
    data.metadata.width,
    data.metadata.height,
    options.maxEdge ?? 1920,
  );
  const width = options.width ?? naturalWidth,
    height = options.height ?? naturalHeight,
    fps = 30;
  if (width % 2 || height % 2 || Math.max(width, height) > 1920)
    throw new Error('動画の大きさは長辺1920px以内の偶数にしてください。');
  if (typeof VideoEncoder === 'undefined')
    throw new Error(
      'このブラウザでは動画を書き出せません。Chrome・Edge・Firefox（デスクトップ）・Safari 16.4 以降で開いてください。静止画の保存はこのまま使えます。',
    );
  const config: VideoEncoderConfig = {
    // Baseline has no B-frames: all browsers can feed the muxer in presentation order.
    codec: 'avc1.420033',
    width,
    height,
    bitrate: 12_000_000,
    framerate: fps,
    latencyMode: 'quality',
    avc: { format: 'avc' },
  };
  if (!(await VideoEncoder.isConfigSupported(config)).supported)
    throw new Error(
      'この端末はH.264の動画の書き出しに対応していません。静止画の保存はこのまま使えます。',
    );
  const report = await checkFrames(data, roles, preset, options);
  const estimate = estimateSetting(data, roles, preset);
  if (!estimate.pass) throw new Error(estimate.reason);
  if (!report.wcag.pass || !report.itu.pass)
    throw new Error(
      'この設定では、光の変化が速すぎて点滅の基準を超えます。長さを伸ばすか、夜の深さを浅くしてください。',
    );
  const canvas = document.createElement('canvas'),
    renderer = new Renderer(canvas),
    target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width, height, frameRate: fps },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'strict',
  });
  let error: Error | undefined;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      if (error) return;
      try {
        muxer.addVideoChunk(chunk, meta);
      } catch {
        error = new Error(
          'この端末はH.264の動画の書き出しに対応していません。静止画の保存はこのまま使えます。',
        );
      }
    },
    error: (e) => {
      error = e;
    },
  });
  const frames = Math.round(preset.durationSec * fps);
  try {
    renderer.upload(data);
    renderer.size(width, height);
    encoder.configure(config);
    for (let i = 0; i < frames; i++) {
      abort(options.signal);
      if (error) throw error;
      renderer.draw(rolePaletteAt(data.metadata.palette, roles, i / fps, preset), {
        contain: true,
      });
      const frame = new VideoFrame(canvas, {
        timestamp: Math.round((i * 1e6) / fps),
        duration: Math.round(1e6 / fps),
      });
      try {
        encoder.encode(frame, { keyFrame: i % fps === 0 });
      } finally {
        frame.close();
      }
      if (i % 15 === 0) {
        options.progress?.({ phase: 'encoding', fraction: i / frames });
        await yieldTask();
      }
      while (encoder.encodeQueueSize > 8) {
        abort(options.signal);
        if (error) throw error;
        await yieldTask();
      }
    }
    await encoder.flush();
    if (error) throw error;
    abort(options.signal);
    muxer.finalize();
    options.progress?.({ phase: 'encoding', fraction: 1 });
    return {
      blob: new Blob([target.buffer], { type: 'video/mp4' }),
      report,
      width,
      height,
      frames,
    };
  } finally {
    if (encoder.state !== 'closed') encoder.close();
    renderer.dispose();
  }
}
export async function exportPng(
  data: Decomposition,
  roles: Role[],
  preset: Preset,
  seconds: number,
): Promise<Blob> {
  const canvas = document.createElement('canvas'),
    renderer = new Renderer(canvas);
  try {
    renderer.upload(data);
    renderer.size(data.metadata.width, data.metadata.height);
    renderer.draw(rolePaletteAt(data.metadata.palette, roles, seconds, preset));
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('静止画を保存できません。'))),
        'image/png',
      ),
    );
  } finally {
    renderer.dispose();
  }
}
export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
