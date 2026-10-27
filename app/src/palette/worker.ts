import { groupLightness } from '../safety/groups';
import { type Island, materializeIslands } from './islands';
import { preprocess } from './preprocess';
import type { Decomposition } from './types';

type Request =
  | { id: number; rgba: Uint8ClampedArray; width: number; height: number }
  | { id: number; islands: Island[] };

const worker = self as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};
let base: Decomposition | undefined;
worker.onmessage = ({ data: message }) => {
  try {
    if ('rgba' in message) {
      base = preprocess(message.rgba, message.width, message.height);
      // Keep the source here for future spatial edits; copy and transfer off the UI thread.
      const data = {
        ...base,
        lab: base.lab.slice(),
        alpha: base.alpha.slice(),
        weights: base.weights.map((w) => w.slice()),
      };
      worker.postMessage({ id: message.id, data }, [
        data.lab.buffer,
        data.alpha.buffer,
        ...data.weights.map((w) => w.buffer),
      ]);
      return;
    }
    if (!base) throw new Error('画像を読み込んでください。');
    const data = materializeIslands(base, message.islands),
      grouped = groupLightness(data),
      groups = { ...grouped, values: grouped.values.slice(), counts: grouped.counts.slice() },
      weights = data === base ? undefined : data.weights;
    worker.postMessage({ id: message.id, weights, metadata: data.metadata, groups }, [
      ...(weights?.map((w) => w.buffer) ?? []),
      groups.values.buffer,
      groups.counts.buffer,
    ]);
  } catch (error) {
    worker.postMessage({
      id: message.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
