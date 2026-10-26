import type { Decomposition } from './types';

/** A worker per load makes cancellation release its arrays immediately. */
export function preprocessInWorker(image: ImageData, signal?: AbortSignal): Promise<Decomposition> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    const cleanup = () => {
      worker.terminate();
      signal?.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException('読み込みを中止しました。', 'AbortError'));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }: MessageEvent<{ data?: Decomposition; error?: string }>) => {
      cleanup();
      if (data.data) resolve(data.data);
      else reject(new Error(data.error ?? '前処理に失敗しました。'));
    };
    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message));
    };
    worker.postMessage({ rgba: image.data, width: image.width, height: image.height }, [
      image.data.buffer,
    ]);
  });
}
