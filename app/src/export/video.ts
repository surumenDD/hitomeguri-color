import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { type Foreground, foregroundLight } from '../foreground';
import type { Decomposition } from '../palette/types';
import { Renderer } from '../render';
import { estimateSetting } from '../safety/estimate';
import { analyzeFrames, type FlashReport } from '../safety/flash';
import { type Preset, type Role, rolePaletteAt } from '../script';
import { canvasPng, encodePng } from './png';

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
  foreground?: Foreground;
}
export const exportSize = (width: number, height: number, maxEdge = 1920): [number, number] => {
  const edge = Math.max(width, height);
  const scale = Math.min(maxEdge / edge, Math.max(1, 512 / edge));
  return [
    Math.max(2, Math.floor((width * scale) / 2) * 2),
    Math.max(2, Math.floor((height * scale) / 2) * 2),
  ];
};
export const VIDEO_UNSUPPORTED =
  'このブラウザでは動画を書き出せません。Chrome・Edge・Firefox（デスクトップ）・Safari 16.4 以降で開いてください。静止画の保存はこのまま使えます。';
export const VIDEO_SIZE_UNSUPPORTED =
  'この絵の大きさでは動画を書き出せません。静止画の保存はこのまま使えます。';
export type VideoSupport = 'supported' | 'browser-unsupported' | 'size-unsupported';
const videoConfig = (width: number, height: number): VideoEncoderConfig => ({
  // Baseline has no B-frames: all browsers can feed the muxer in presentation order.
  codec: 'avc1.420033',
  width,
  height,
  bitrate: 12_000_000,
  framerate: 30,
  latencyMode: 'quality',
  avc: { format: 'avc' },
});
export async function videoExportSupport(width: number, height: number): Promise<VideoSupport> {
  if (typeof VideoEncoder === 'undefined') return 'browser-unsupported';
  try {
    const [w, h] = exportSize(width, height);
    if ((await VideoEncoder.isConfigSupported(videoConfig(w, h))).supported) return 'supported';
    // Without H.264 at an ordinary size, the browser is the limit rather than this picture.
    return (await VideoEncoder.isConfigSupported(videoConfig(1280, 720))).supported
      ? 'size-unsupported'
      : 'browser-unsupported';
  } catch {
    return 'size-unsupported';
  }
}
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
    renderer.uploadForeground(options.foreground?.data);
    renderer.size(width, height);
    for (let frame = 0; frame < count; frame++) {
      abort(options.signal);
      const palette = rolePaletteAt(data.metadata.palette, roles, frame / fps, preset);
      renderer.draw(palette, {
        foreground: options.foreground && {
          ...options.foreground,
          light: foregroundLight(data.metadata, roles, palette),
        },
      });
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
  if (typeof VideoEncoder === 'undefined') throw new Error(VIDEO_UNSUPPORTED);
  const config = videoConfig(width, height);
  if (!(await VideoEncoder.isConfigSupported(config)).supported)
    throw new Error(VIDEO_SIZE_UNSUPPORTED);
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
    renderer.uploadForeground(options.foreground?.data);
    renderer.size(width, height);
    encoder.configure(config);
    for (let i = 0; i < frames; i++) {
      abort(options.signal);
      if (error) throw error;
      const palette = rolePaletteAt(data.metadata.palette, roles, i / fps, preset);
      renderer.draw(palette, {
        contain: true,
        foreground: options.foreground && {
          ...options.foreground,
          light: foregroundLight(data.metadata, roles, palette),
        },
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
  foreground?: Foreground,
  preview?: Renderer,
): Promise<Blob> {
  const renderer = preview ?? new Renderer(document.createElement('canvas'));
  const draw = (target: Renderer, upload = true) => {
    if (upload) target.upload(data);
    target.uploadForeground(foreground?.data);
    target.size(data.metadata.width, data.metadata.height);
    const palette = rolePaletteAt(data.metadata.palette, roles, seconds, preset);
    target.draw(palette, {
      foreground: foreground && {
        ...foreground,
        light: foregroundLight(data.metadata, roles, palette),
      },
    });
  };
  const fallback = async () => {
    // The preview may now show another scene. Re-render the captured inputs only on worker failure.
    const copy = new Renderer(document.createElement('canvas'));
    try {
      draw(copy);
      return await canvasPng(copy.canvas);
    } finally {
      copy.dispose();
    }
  };
  try {
    draw(renderer, !preview);
    return await encodePng(renderer, fallback);
  } finally {
    if (!preview) renderer.dispose();
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
