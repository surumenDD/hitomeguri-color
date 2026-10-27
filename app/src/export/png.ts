import type { Renderer } from '../render';

export const canvasPng = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('静止画を保存できません。'))),
      'image/png',
    ),
  );

/** Snapshot before returning: the preview may immediately draw another frame. */
export function encodePng(renderer: Renderer, fallback: () => Promise<Blob>): Promise<Blob> {
  const canvas = renderer.canvas;
  if (typeof Worker === 'undefined' || typeof CompressionStream === 'undefined')
    return canvasPng(canvas);
  let worker: Worker;
  try {
    worker = new Worker(new URL('./png.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return canvasPng(canvas);
  }
  const { width, height } = canvas;
  let rgba: Uint8Array<ArrayBuffer>;
  try {
    rgba = renderer.read();
  } catch (error) {
    worker.terminate();
    throw error;
  }
  return new Promise<Blob>((resolve, reject) => {
    let finished = false;
    const cleanup = () => {
      finished = true;
      clearTimeout(timer);
      worker.terminate();
    };
    const fail = () => {
      if (finished) return;
      cleanup();
      fallback().then(resolve, reject);
    };
    const timer = setTimeout(fail, 30_000);
    worker.onmessage = ({ data }: MessageEvent<{ blob?: Blob }>) => {
      if (finished) return;
      if (data.blob) {
        cleanup();
        resolve(data.blob);
      } else fail();
    };
    worker.onerror = (event) => {
      event.preventDefault();
      fail();
    };
    worker.onmessageerror = fail;
    try {
      worker.postMessage({ rgba, width, height }, [rgba.buffer]);
    } catch {
      fail();
    }
  });
}
