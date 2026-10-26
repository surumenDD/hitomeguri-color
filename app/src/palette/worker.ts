import { preprocess } from './preprocess';

const worker = self as unknown as {
  onmessage:
    | ((event: MessageEvent<{ rgba: Uint8ClampedArray; width: number; height: number }>) => void)
    | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};
worker.onmessage = ({ data: { rgba, width, height } }) => {
  try {
    const data = preprocess(rgba, width, height);
    worker.postMessage({ data }, [
      data.lab.buffer,
      data.alpha.buffer,
      ...data.weights.map((w) => w.buffer),
    ]);
  } catch (error) {
    worker.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
