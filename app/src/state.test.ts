import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ForegroundData } from './foreground';
import { loadForeground } from './foreground';
import { decodeImage } from './image';
import { SAMPLES } from './samples';
import { AppStore } from './state';

vi.mock('./image', () => ({ decodeImage: vi.fn() }));
vi.mock('./foreground', async (original) => ({
  ...(await original<typeof import('./foreground')>()),
  loadForeground: vi.fn(),
}));
vi.mock('./palette/client', () => ({ preprocessInWorker: vi.fn(async () => ({})) }));
vi.mock('./palette/islands', () => ({
  curate: () => [],
  materializeIslands: (base: unknown) => base,
}));
vi.mock('./script', async (original) => ({
  ...(await original<typeof import('./script')>()),
  inferRoles: () => [],
}));
vi.mock('./safety/client', () => ({
  SafetyClient: class {
    evaluate = async () => ({ pass: true });
    dispose() {}
  },
}));

const person: ForegroundData = { width: 1, height: 1, lab: new Float32Array([0.5, 0, 0, 0.5]) };
const sample = (id: string) => {
  const found = SAMPLES.find((s) => s.id === id);
  if (!found) throw new Error(`missing sample ${id}`);
  return found;
};
const festival = sample('festival'),
  seaside = sample('seaside'),
  canal = sample('canal');
let store: AppStore;
const open = (sample: (typeof SAMPLES)[number]) => store.load(sample.url, sample.name, sample.id);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(decodeImage).mockResolvedValue({ width: 1, height: 1 } as ImageData);
  vi.mocked(loadForeground).mockResolvedValue(person);
  store = new AppStore();
});
afterEach(() => store.dispose());

describe('sample people', () => {
  it('loads the approved person and resets every setting on each sample open', async () => {
    await open(festival);
    expect(store.getState().foreground).toMatchObject({
      name: '浴衣の女の子',
      origin: 'sample',
      x: 0.5,
      y: 1.26,
      size: 1.05,
      blend: 0.8,
    });
    store.setForeground({ x: 0.1, y: 0.9, size: 0.4, blend: 0 });
    await open(seaside);
    expect(store.getState().foreground).toMatchObject({
      name: '海辺の女の子',
      origin: 'sample',
      x: 0.76,
      y: 1.6,
      size: 1.2,
      blend: 0.8,
    });
    store.removeForeground();
    await open(seaside);
    expect(store.getState().foreground?.name).toBe('海辺の女の子');
  });

  it('removes sample people on a person-free sample and on a local picture', async () => {
    await open(festival);
    await open(canal);
    expect(store.getState().foreground).toBeUndefined();
    await open(seaside);
    await store.load(new File([], 'local.png'), 'local.png');
    expect(store.getState().foreground).toBeUndefined();
  });

  it('keeps a replacement user person and all settings until a sample replaces it', async () => {
    await open(festival);
    store.setForeground({ x: 0.2, y: 1.1, size: 0.9, blend: 0.6 });
    await store.addForeground('/user.png', 'my.person.png');
    expect(store.getState().foreground).toMatchObject({ x: 0.2, y: 1.1, size: 0.9, blend: 0.6 });
    store.setForeground({ x: 0.3, y: 1.2, size: 0.8, blend: 0.4 });
    const foreground = store.getState().foreground;
    expect(foreground).toMatchObject({ name: 'my.person', origin: 'user' });
    await open(canal);
    expect(store.getState().foreground).toBe(foreground);
    await store.load(new File([], 'local.png'), 'local.png');
    expect(store.getState().foreground).toBe(foreground);
    await open(seaside);
    expect(store.getState().foreground?.origin).toBe('sample');
    expect(store.getState().foreground?.name).toBe('海辺の女の子');
  });

  it('publishes the background and person together, with no mismatched intermediate scene', async () => {
    await open(canal);
    const scenes: string[] = [];
    store.subscribe(() => {
      const s = store.getState();
      if (!s.loading) scenes.push(`${s.image?.id}/${s.foreground?.name}`);
    });
    await open(festival);
    expect(scenes).toEqual(['festival/浴衣の女の子']);
  });

  it('does not apply a stale person after a newer background has loaded', async () => {
    let finish!: (value: ForegroundData) => void;
    vi.mocked(loadForeground).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = open(festival);
    await open(canal);
    finish(person);
    await pending;
    expect(store.getState().image?.id).toBe('canal');
    expect(store.getState().foreground).toBeUndefined();
  });

  it('keeps the previous complete scene when the new sample person cannot load', async () => {
    await open(seaside);
    const { image, foreground } = store.getState();
    vi.mocked(loadForeground).mockRejectedValueOnce(new Error('person failed'));
    await open(festival);
    expect(store.getState()).toMatchObject({
      image,
      foreground,
      loading: false,
      error: 'person failed',
    });
  });
});
