import { pngBlob } from './png-encode';

const worker = self as unknown as {
  onmessage:
    | ((
        event: MessageEvent<{
          rgba: Uint8Array<ArrayBuffer>;
          width: number;
          height: number;
        }>,
      ) => void)
    | null;
  postMessage: (message: unknown) => void;
};
worker.onmessage = async ({ data: { rgba, width, height } }) => {
  try {
    worker.postMessage({ blob: await pngBlob(rgba, width, height) });
  } catch {
    worker.postMessage({});
  }
};
