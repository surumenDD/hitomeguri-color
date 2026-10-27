import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { groupLightness } from '../safety/groups';
import { PaletteClient } from './client';
import { preprocess } from './preprocess';

class TestWorker {
  static instances: TestWorker[] = [];
  onmessage?: (e: MessageEvent) => void;
  onerror?: (e: ErrorEvent) => void;
  messages: { id: number; islands?: unknown[]; rgba?: Uint8ClampedArray }[] = [];
  terminate = vi.fn();
  constructor() {
    TestWorker.instances.push(this);
  }
  postMessage(message: (typeof this.messages)[number], transfer: Transferable[]) {
    this.messages.push(structuredClone(message, { transfer }));
  }
  reply(data: object) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

beforeEach(() => {
  TestWorker.instances = [];
  vi.stubGlobal('Worker', TestWorker);
});
afterEach(() => vi.unstubAllGlobals());

describe('palette Worker lifetime and spatial transfers', () => {
  it('sends only island descriptors when splitting and shares source lab and alpha on return', async () => {
    const client = new PaletteClient(),
      worker = TestWorker.instances[0],
      rgba = new Uint8ClampedArray([128, 128, 128, 255]),
      base = preprocess(rgba, 1, 1),
      loading = client.preprocess({ data: rgba, width: 1, height: 1 } as ImageData);
    expect(rgba.byteLength).toBe(0);
    worker.reply({ id: 1, data: base });
    expect(await loading).toBe(base);
    expect(worker.terminate).not.toHaveBeenCalled();
    const pending = client.materialize([]),
      weights = base.weights.map((w) => w.slice()),
      groups = groupLightness(base);
    expect(worker.messages[1]).toEqual({ id: 2, islands: [] });
    worker.reply({ id: 2, weights, metadata: base.metadata, groups });
    const result = await pending;
    expect(result.data.lab).toBe(base.lab);
    expect(result.data.alpha).toBe(base.alpha);
    expect(result.data.weights).toBe(weights);
    expect(result.groups).toBe(groups);
    client.dispose();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('rejects pending work and terminates the source Worker when aborted', async () => {
    const control = new AbortController(),
      client = new PaletteClient(control.signal),
      pending = client.materialize([]),
      rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    control.abort();
    await rejection;
    expect(TestWorker.instances[0].terminate).toHaveBeenCalledOnce();
    await expect(client.materialize([])).rejects.toMatchObject({ name: 'AbortError' });
    client.dispose();
    expect(TestWorker.instances[0].terminate).toHaveBeenCalledOnce();
  });

  it('releases all pending requests if the Worker fails', async () => {
    const client = new PaletteClient(),
      first = expect(client.materialize([])).rejects.toThrow('worker failed'),
      second = expect(client.materialize([])).rejects.toThrow('worker failed');
    TestWorker.instances[0].onerror?.({ message: 'worker failed' } as ErrorEvent);
    await Promise.all([first, second]);
    expect(TestWorker.instances[0].terminate).toHaveBeenCalledOnce();
  });
});
