import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ForegroundData } from './foreground';
import { loadForeground } from './foreground';
import { type DecodedImage, decodeImage } from './image';
import { curate } from './palette/islands';
import type { Estimate } from './safety/estimate';
import { SAMPLES } from './samples';
import { DAYLIGHT, PRESETS, type Preset } from './script';
import { AppStore } from './state';

vi.mock('./image', () => ({ decodeImage: vi.fn() }));
vi.mock('./foreground', async (original) => ({
  ...(await original<typeof import('./foreground')>()),
  loadForeground: vi.fn(),
}));
vi.mock('./palette/client', () => ({
  PaletteClient: class {
    async preprocess() {
      return {};
    }
    async materialize() {
      return { data: {}, groups: {} };
    }
    dispose() {}
  },
}));
vi.mock('./palette/islands', () => ({
  curate: vi.fn(() => []),
  materializeIslands: (base: unknown) => base,
}));
vi.mock('./script', async (original) => ({
  ...(await original<typeof import('./script')>()),
  inferRoles: () => [],
}));
const safety = vi.hoisted(() => ({
  evaluate: vi.fn(),
}));
vi.mock('./safety/client', () => ({
  SafetyClient: class {
    evaluate = safety.evaluate;
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
  safety.evaluate.mockResolvedValue({ pass: true });
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

const estimate = (pass: boolean): Estimate => ({
  pass,
  reason: pass ? undefined : 'unsafe',
  lightnessPotentialPixels: 0,
  movementLimit: 0,
  minL: 0,
  maxL: 1,
});
function controlledSafety() {
  const jobs: {
    preset: Preset;
    resolve: (result: Estimate) => void;
    reject: (e: Error) => void;
  }[] = [];
  safety.evaluate.mockImplementation(
    (_roles, preset: Preset) =>
      new Promise<Estimate>((resolve, reject) => jobs.push({ preset, resolve, reject })),
  );
  const finish = async (index: number, pass: boolean) => {
    jobs[index].resolve(estimate(pass));
    // Let the store publish the result and start the next queued evaluation.
    await Promise.resolve();
  };
  return { jobs, finish };
}

describe('parameter drafts and safety queue', () => {
  beforeEach(async () => {
    await open(canal);
    safety.evaluate.mockClear();
  });

  it('discards drafts and stops retrying when the safety client is missing', async () => {
    Reflect.set(store, 'safety', undefined);
    const preset = store.getState().preset;
    const pending = store.setParameter('nightDepth', 1.1);
    const snapshot = store.getSnapshot();
    try {
      await Promise.resolve();
      expect(store.getSnapshot()).toBe(snapshot);
      expect(snapshot.drafts).toEqual({});
      expect(snapshot.checking).toBe(false);
      expect(snapshot.preset).toBe(preset);
      expect(safety.evaluate).not.toHaveBeenCalled();
    } finally {
      // Stop even a regressed retry loop before awaiting its completion.
      store.dispose();
      await pending;
    }
  });

  it('publishes input immediately, stops playback, and checks only the first and latest of six inputs', async () => {
    const { jobs, finish } = controlledSafety();
    store.setPlaying(true);
    const original = store.getState().preset.nightDepth;
    const first = store.setParameter('nightDepth', 1.1);
    expect(store.getSnapshot()).toMatchObject({
      drafts: { nightDepth: 1.1 },
      checking: true,
      playing: false,
      preset: { nightDepth: original },
    });
    const remaining = [1.2, 1.3, 1.4, 1.5, 1.6].map((n) => store.setParameter('nightDepth', n));
    expect(jobs).toHaveLength(1);
    expect(store.getSnapshot().drafts.nightDepth).toBe(1.6);
    await finish(0, true);
    expect(store.getState().preset.nightDepth).toBe(1.1);
    expect(store.getSnapshot().drafts.nightDepth).toBe(1.6);
    expect(store.getState().checking).toBe(true);
    expect(jobs).toHaveLength(2);
    expect(jobs[1].preset.nightDepth).toBe(1.6);
    await finish(1, true);
    await Promise.all([first, ...remaining]);
    expect(jobs).toHaveLength(2);
    expect(store.getState()).toMatchObject({
      preset: { nightDepth: 1.6 },
      drafts: {},
      checking: false,
    });
  });

  it('ignores a rejected intermediate value and searches only the rejected latest value', async () => {
    const { jobs, finish } = controlledSafety();
    const first = store.setParameter('nightDepth', 2);
    const latest = store.setParameter('nightDepth', 3);
    await finish(0, false);
    expect(jobs).toHaveLength(2);
    expect(jobs[1].preset.nightDepth).toBe(3);
    expect(store.getState().drafts.nightDepth).toBe(3);
    expect(store.getState().preset.nightDepth).toBe(DAYLIGHT.nightDepth);
    await finish(1, false);
    for (let i = 2; i < 9; i++) {
      expect(jobs).toHaveLength(i + 1);
      expect(store.getState().drafts.nightDepth).toBe(3);
      await finish(i, jobs[i].preset.nightDepth <= 2.5);
    }
    await Promise.all([first, latest]);
    const state = store.getState();
    expect(state.preset.nightDepth).toBeLessThanOrEqual(2.5);
    expect(state.preset.nightDepth).toBeGreaterThan(2.48);
    expect(state.estimate?.pass).toBe(true);
    expect(state.limits.nightDepth[1]).toBe(state.preset.nightDepth);
    expect(state.editError).toBe('これ以上動かすと、点滅または明るさの基準を超えます。');
    expect(state.drafts).toEqual({});
    expect(state.checking).toBe(false);
  });

  it('abandons bisection on new input to the same slider without applying its result', async () => {
    const { jobs, finish } = controlledSafety();
    const first = store.setParameter('nightDepth', 3);
    await finish(0, false);
    expect(jobs).toHaveLength(2);
    const latest = store.setParameter('nightDepth', 1.2);
    await finish(1, true);
    expect(store.getState().preset.nightDepth).toBe(DAYLIGHT.nightDepth);
    expect(store.getState().drafts.nightDepth).toBe(1.2);
    expect(jobs).toHaveLength(3);
    expect(jobs[2].preset.nightDepth).toBe(1.2);
    await finish(2, true);
    await Promise.all([first, latest]);
    expect(store.getState().limits.nightDepth).toEqual([0.2, 4]);
    expect(store.getState().editError).toBeUndefined();
    expect(store.getState().preset.nightDepth).toBe(1.2);
  });

  it('discards drafts on a preset change and never applies stale results', async () => {
    const { jobs, finish } = controlledSafety();
    const first = store.setParameter('nightDepth', 1.1);
    const latest = store.setParameter('nightDepth', 1.4);
    const preset = Object.values(PRESETS).find((p) => p.id !== DAYLIGHT.id);
    if (!preset) throw new Error('missing alternative preset');
    const changed = store.setPreset(preset.id);
    expect(store.getState().drafts).toEqual({});
    await finish(1, true);
    await changed;
    await finish(0, true);
    await Promise.all([first, latest]);
    expect(jobs).toHaveLength(2);
    expect(store.getState()).toMatchObject({ preset, checking: false, drafts: {} });
  });

  it('discards the published drafts immediately on a role change and ignores the old check', async () => {
    vi.mocked(curate).mockReturnValueOnce([{ id: 'base-0', base: 0, role: 'sky', gates: [] }]);
    await open(canal);
    const { jobs, finish } = controlledSafety();
    const pending = store.setParameter('nightDepth', 1.1);
    const changing = store.setRole(0, 'water');
    expect(store.getSnapshot().drafts).toEqual({});
    await finish(0, true);
    await pending;
    expect(store.getState().preset.nightDepth).toBe(DAYLIGHT.nightDepth);
    expect(store.getState().checking).toBe(true);
    await finish(1, true);
    await changing;
    expect(store.getState().image?.roles).toEqual(['water']);
    expect(jobs).toHaveLength(2);
  });

  it('keeps the rendered duration and time unchanged until the duration draft passes', async () => {
    const { finish } = controlledSafety();
    store.seek(12);
    const pending = store.setParameter('durationSec', 36);
    expect(store.getState()).toMatchObject({
      seconds: 12,
      preset: { durationSec: 24 },
      drafts: { durationSec: 36 },
    });
    await finish(0, true);
    await pending;
    expect(store.getState()).toMatchObject({
      seconds: 18,
      preset: { durationSec: 36 },
      drafts: {},
    });
  });

  it('finishes each slider in first-input order, composing the next check on accepted values', async () => {
    const { jobs, finish } = controlledSafety();
    const first = store.setParameter('nightDepth', 1.1);
    const second = store.setParameter('glow', 0.5);
    const latest = store.setParameter('nightDepth', 1.4);
    expect(store.getState().drafts).toEqual({ nightDepth: 1.4, glow: 0.5 });
    await finish(0, true);
    expect(jobs[1].preset).toMatchObject({ nightDepth: 1.4, glow: DAYLIGHT.glow });
    await finish(1, true);
    expect(store.getState().drafts).toEqual({ glow: 0.5 });
    expect(jobs[2].preset).toMatchObject({ nightDepth: 1.4, glow: 0.5 });
    await finish(2, true);
    await Promise.all([first, second, latest]);
    expect(store.getState()).toMatchObject({
      preset: { nightDepth: 1.4, glow: 0.5 },
      drafts: {},
      checking: false,
    });
  });

  it('keeps bisection running when another slider is drafted', async () => {
    const { jobs, finish } = controlledSafety();
    const first = store.setParameter('nightDepth', 3);
    await finish(0, false);
    const second = store.setParameter('glow', 0.5);
    for (let i = 1; i < 8; i++) await finish(i, jobs[i].preset.nightDepth <= 2.5);
    const edge = store.getState().preset.nightDepth;
    expect(store.getState().drafts).toEqual({ glow: 0.5 });
    expect(jobs[8].preset).toMatchObject({ nightDepth: edge, glow: 0.5 });
    await finish(8, true);
    await Promise.all([first, second]);
    expect(store.getState().preset).toMatchObject({ nightDepth: edge, glow: 0.5 });
  });

  it('accepts foreground size and blend changes while safety is checking', async () => {
    await open(seaside);
    const { finish } = controlledSafety();
    const pending = store.setParameter('nightDepth', 1.1);
    store.setForeground({ size: 0.6, blend: 0.3 });
    expect(store.getState().foreground).toMatchObject({ size: 0.6, blend: 0.3 });
    expect(store.getState().checking).toBe(true);
    await finish(0, true);
    await pending;
  });

  it('retains input during a preset check and applies it on the newly accepted preset', async () => {
    const { jobs, finish } = controlledSafety();
    const changing = store.setPreset(DAYLIGHT.id);
    await store.setParameter('glow', 0.5);
    expect(jobs).toHaveLength(1);
    await finish(0, true);
    expect(jobs[1].preset).toMatchObject({ ...DAYLIGHT, glow: 0.5 });
    await finish(1, true);
    await changing;
    expect(store.getState()).toMatchObject({ preset: { glow: 0.5 }, drafts: {}, checking: false });
  });
});

describe('background size', () => {
  it('opens a 3000px picture at 2048px and keeps its original size only for that picture', async () => {
    vi.mocked(decodeImage).mockResolvedValueOnce({
      width: 2048,
      height: 2048,
      originalSize: { width: 3000, height: 3000 },
    } as DecodedImage);
    const file = new File([], 'large.jpg');
    await store.load(file, file.name);
    expect(decodeImage).toHaveBeenLastCalledWith(file, { maxEdge: 2048, resize: true });
    expect(store.getState().image?.originalSize).toEqual({ width: 3000, height: 3000 });
    await open(canal);
    expect(store.getState().image?.originalSize).toBeUndefined();
  });
});
