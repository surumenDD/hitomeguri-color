import { type Lab, labToLinear, rgbToLab } from './color';
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
  exposure: number;
  color: Lab;
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
  if (!roles.includes('sky')) return { exposure: 1, color: [1, 1, 1] };
  const overhead = pickOverhead(roles, metadata.counts);
  const horizon = pickHorizon(metadata.palette, roles, metadata.counts);
  const current = palette[overhead].map((v, i) => (v + palette[horizon][i]) / 2);
  const color = labToLinear([0.85, 1.3 * current[1], 1.3 * current[2]]).map((v) =>
    v < 0 ? 0.0001 : v,
  );
  const maximum = Math.max(...color);
  return {
    exposure: Math.max(0.3, Math.min(1.15, current[0] / 0.7)),
    color: color.map((v) => v / maximum) as Lab,
  };
}

/** CPU reference for ADR-0009 v2. Input and output are linear sRGB tuples. */
export function adaptForeground(linear: Lab, { exposure, color }: ForegroundLight, f: number): Lab {
  return linear.map((v, i) =>
    Math.max(0, Math.min(1, v * (1 + f * (exposure * color[i] - 1)))),
  ) as Lab;
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
