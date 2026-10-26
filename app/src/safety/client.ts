import type { Decomposition } from '../palette/types';
import type { Preset, Role } from '../script';
import type { Estimate } from './estimate';
export class SafetyClient {
  private worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private id = 0;
  private pending = new Map<
    number,
    { resolve: (r: Estimate) => void; reject: (e: Error) => void }
  >();
  constructor(data: Decomposition) {
    this.worker.postMessage({ data });
    this.worker.onmessage = ({
      data,
    }: {
      data: { id: number; result?: Estimate; error?: string };
    }) => {
      const job = this.pending.get(data.id);
      if (!job) return;
      this.pending.delete(data.id);
      if (data.result) job.resolve(data.result);
      else job.reject(new Error(data.error));
    };
    this.worker.onerror = (event) => {
      for (const p of this.pending.values()) p.reject(new Error(event.message));
      this.pending.clear();
    };
  }
  evaluate(roles: Role[], preset: Preset): Promise<Estimate> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, roles, preset });
    });
  }
  dispose(): void {
    this.worker.terminate();
    for (const p of this.pending.values())
      p.resolve({
        pass: false,
        reason: '読み込みを中止しました。',
        lightnessPotentialPixels: 0,
        movementLimit: 0,
        minL: 0,
        maxL: 1,
      });
    this.pending.clear();
  }
}
