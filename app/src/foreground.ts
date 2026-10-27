import { type Lab, rgbToLab } from './color';
import { decodeImage } from './image';
import type { Metadata } from './palette/types';
import type { Role } from './script';
import { pickHorizon, pickOverhead } from './script/strip';

export interface ForegroundData {
  width: number;
  height: number;
  /** Straight OKLab + alpha, in top-down RGBA32F rows. */
  lab: Float32Array<ArrayBuffer>;
}
export interface ForegroundSettings {
  x: number;
  y: number;
  size: number;
  blend: number;
}
export interface Foreground extends ForegroundSettings {
  data: ForegroundData;
  name: string;
  thumbnail: string;
}
export interface ForegroundLight {
  k: number;
  shift: [number, number];
}
export const FOREGROUND_DEFAULTS: ForegroundSettings = { x: 0.68, y: 1, size: 0.7, blend: 0.8 };
export const OPAQUE_FOREGROUND =
  'この画像には透けた部分がありません。背景が透けた PNG を選んでください。';

/** Averages the strip's overhead and horizon in OKLab. No sky means identity. */
export function foregroundLight(
  metadata: Pick<Metadata, 'palette' | 'counts'>,
  roles: Role[],
  palette: Lab[],
): ForegroundLight {
  if (!roles.includes('sky')) return { k: 1, shift: [0, 0] };
  const overhead = pickOverhead(roles, metadata.counts);
  const horizon = pickHorizon(metadata.palette, roles, metadata.counts);
  const start = metadata.palette[overhead].map((v, i) => (v + metadata.palette[horizon][i]) / 2),
    current = palette[overhead].map((v, i) => (v + palette[horizon][i]) / 2);
  return {
    k: start[0] > 0 ? Math.max(0.05, Math.min(1.25, current[0] / start[0])) : 1,
    shift: [current[1] - start[1], current[2] - start[2]],
  };
}

/** CPU reference for the shader's ADR-0009 formula; gamut mapping follows this step. */
export function adaptForeground([L, a, b]: Lab, { k, shift }: ForegroundLight, f: number): Lab {
  const c = 1 - 0.35 * f * (1 - Math.min(k, 1));
  return [
    Math.max(0.35 * L, Math.min(1, L * (1 + f * (k - 1)))),
    a * c + 0.5 * f * shift[0],
    b * c + 0.5 * f * shift[1],
  ];
}

export function foregroundBounds(
  data: Pick<ForegroundData, 'width' | 'height'>,
  imageAspect: number,
  settings: ForegroundSettings,
): { x: number; y: number; width: number; height: number } {
  const width = (data.width / data.height / imageAspect) * settings.size;
  return { x: settings.x - width / 2, y: settings.y - settings.size, width, height: settings.size };
}

export function prepareForeground(
  pixels: Pick<ImageData, 'width' | 'height' | 'data'>,
): ForegroundData {
  const count = pixels.width * pixels.height;
  let transparent = 0;
  for (let i = 3; i < pixels.data.length; i += 4) if (pixels.data[i] < 250) transparent++;
  if (transparent / count < 0.01) throw new Error(OPAQUE_FOREGROUND);
  const lab = new Float32Array(count * 4);
  for (let i = 0; i < lab.length; i += 4) {
    const color = rgbToLab(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]);
    lab.set(color, i);
    lab[i + 3] = pixels.data[i + 3] / 255;
  }
  return { width: pixels.width, height: pixels.height, lab };
}

export async function loadForeground(source: string | File): Promise<ForegroundData> {
  if (typeof source !== 'string') {
    // Windows WebKit can report an empty/OS-specific MIME type for a valid WebP file.
    // Check the file itself, then give the shared decoder a canonical MIME type.
    const header = new Uint8Array(await source.slice(0, 12).arrayBuffer());
    const png = [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => header[i] === v);
    const webp =
      String.fromCharCode(...header.subarray(0, 4)) === 'RIFF' &&
      String.fromCharCode(...header.subarray(8, 12)) === 'WEBP';
    if (!png && !webp)
      throw new Error(
        'この画像は開けませんでした。背景が透けた PNG・WebP の人物を選んでください。',
      );
    const type = png ? 'image/png' : 'image/webp';
    if (source.type !== type) source = new File([source], source.name, { type });
  }
  return prepareForeground(await decodeImage(source, { maxEdge: 2048, resize: true }));
}
