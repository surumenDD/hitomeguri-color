import type { Preset, Role } from '../script';
import { estimateSetting } from './estimate';
import type { LightnessGroups } from './groups';

let data: LightnessGroups | undefined;
self.onmessage = ({
  data: message,
}: MessageEvent<{ data?: LightnessGroups; id?: number; roles?: Role[]; preset?: Preset }>) => {
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
