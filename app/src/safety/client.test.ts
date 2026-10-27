import { afterEach, expect, it, vi } from 'vitest';
import { preprocess } from '../palette/preprocess';
import { SafetyClient } from './client';
import { groupLightness, type LightnessGroups } from './groups';

afterEach(() => vi.unstubAllGlobals());

it('transfers only grouped tuples to the safety Worker and leaves source pixel arrays intact', () => {
  const messages: { data: LightnessGroups }[] = [];
  class TestWorker {
    postMessage(message: { data: LightnessGroups }, transfer: Transferable[]) {
      messages.push(structuredClone(message, { transfer }));
    }
    terminate() {}
  }
  vi.stubGlobal('Worker', TestWorker);
  const data = preprocess(new Uint8ClampedArray([128, 128, 128, 255, 128, 128, 128, 255]), 2, 1),
    groups = groupLightness(data),
    client = new SafetyClient(groups);
  expect(Object.keys(messages[0].data).sort()).toEqual(['counts', 'metadata', 'values']);
  expect(Array.from(messages[0].data.counts)).toEqual([2]);
  expect(groups.values.byteLength).toBe(0);
  expect(groups.counts.byteLength).toBe(0);
  expect(data.lab.byteLength).toBe(32);
  expect(data.weights.every((w) => w.byteLength === 32)).toBe(true);
  client.dispose();
});
