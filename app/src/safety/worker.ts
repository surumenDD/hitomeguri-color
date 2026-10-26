import type { Decomposition } from '../palette/types';
import type { Preset, Role } from '../script';
import { estimateSetting } from './estimate';

let data: Decomposition | undefined;
self.onmessage = ({
  data: message,
}: MessageEvent<{ data?: Decomposition; id?: number; roles?: Role[]; preset?: Preset }>) => {
  if (message.data) {
    data = message.data;
    return;
  }
  try {
    if (!data || !message.roles || !message.preset) throw new Error('画像を読み込んでください。');
    self.postMessage({
      id: message.id,
      result: estimateSetting(data, message.roles, message.preset),
    });
  } catch (error) {
    self.postMessage({
      id: message.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
