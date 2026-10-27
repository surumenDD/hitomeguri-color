import type { LightnessGroups } from '../safety/groups';
import type { Island } from './islands';
import type { Decomposition, Metadata } from './types';

interface Response {
  id: number;
  data?: Decomposition;
  weights?: Float32Array<ArrayBuffer>[];
  metadata?: Metadata;
  groups?: LightnessGroups;
  error?: string;
}

/** Owns the source arrays off the UI thread until the image is replaced or cancelled. */
export class PaletteClient {
  private worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private id = 0;
  private base?: Decomposition;
  private disposed = false;
  private pending = new Map<
    number,
    { resolve: (r: Response) => void; reject: (e: Error) => void }
  >();
  constructor(private signal?: AbortSignal) {
    this.worker.onmessage = ({ data }: MessageEvent<Response>) => {
      const job = this.pending.get(data.id);
      if (!job) return;
      this.pending.delete(data.id);
      if (data.error) job.reject(new Error(data.error));
      else job.resolve(data);
    };
    this.worker.onerror = (event) => this.dispose(new Error(event.message));
    signal?.addEventListener('abort', this.abort, { once: true });
    if (signal?.aborted) this.abort();
  }
  private abort = () => this.dispose();
  private request(message: object, transfer: Transferable[] = []): Promise<Response> {
    if (this.disposed)
      return Promise.reject(new DOMException('読み込みを中止しました。', 'AbortError'));
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...message, id }, transfer);
    });
  }
  async preprocess(image: ImageData): Promise<Decomposition> {
    const result = await this.request(
      { rgba: image.data, width: image.width, height: image.height },
      [image.data.buffer],
    );
    if (!result.data) throw new Error('前処理に失敗しました。');
    this.base = result.data;
    return result.data;
  }
  async materialize(islands: Island[]): Promise<{ data: Decomposition; groups: LightnessGroups }> {
    const result = await this.request({ islands });
    if (!this.base || !result.metadata || !result.groups) throw new Error('前処理に失敗しました。');
    return {
      data: result.weights
        ? { ...this.base, weights: result.weights, metadata: result.metadata }
        : this.base,
      groups: result.groups,
    };
  }
  dispose(error: Error = new DOMException('読み込みを中止しました。', 'AbortError')): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.terminate();
    this.signal?.removeEventListener('abort', this.abort);
    for (const job of this.pending.values()) job.reject(error);
    this.pending.clear();
    this.base = undefined;
  }
}

/** One-shot preprocessing for callers that do not need spatial editing. */
export async function preprocessInWorker(
  image: ImageData,
  signal?: AbortSignal,
): Promise<Decomposition> {
  const client = new PaletteClient(signal);
  try {
    return await client.preprocess(image);
  } finally {
    client.dispose();
  }
}
