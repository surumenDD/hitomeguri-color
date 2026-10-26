import { decodeImage } from './image';
import { preprocessInWorker } from './palette/client';
import type { Decomposition } from './palette/types';
import { DAYLIGHT, type Inference, inferRoles, type Preset, type Role } from './script';

export interface LoadedImage {
  name: string;
  data: Decomposition;
  inference: Inference[];
  roles: Role[];
}
export interface AppState {
  image?: LoadedImage;
  seconds: number;
  playing: boolean;
  loading: boolean;
  reducedMotion: boolean;
  selected: number;
  preset: Preset;
  status: string;
  error?: string;
}

/** One state owner; the render clock publishes React snapshots at most 10 times per second. */
export class AppStore {
  private state: AppState;
  private snapshot: AppState;
  private listeners = new Set<() => void>();
  private lastPublish = 0;
  private pending?: AbortController;
  private disposed = false;
  constructor(reducedMotion = false) {
    this.state = {
      seconds: 0,
      playing: false,
      loading: false,
      reducedMotion,
      selected: -1,
      preset: DAYLIGHT,
      status: '画像を読み込んでください。',
    };
    this.snapshot = this.state;
  }
  getState = (): AppState => this.state;
  getSnapshot = (): AppState => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(patch: Partial<AppState>, publish = true): void {
    this.state = { ...this.state, ...patch };
    if (publish) {
      this.snapshot = this.state;
      for (const listener of this.listeners) listener();
    }
  }
  async load(source: string | File, name: string): Promise<void> {
    this.pending?.abort();
    const controller = new AbortController();
    this.pending = controller;
    this.update({
      playing: false,
      loading: true,
      error: undefined,
      status: `${name}の色と位置を調べています。`,
    });
    try {
      const pixels = await decodeImage(source);
      if (controller.signal.aborted) return;
      const data = await preprocessInWorker(pixels, controller.signal);
      if (controller.signal.aborted || this.disposed) return;
      const inference = inferRoles(data.metadata);
      this.update({
        image: { name, data, inference, roles: inference.map((info) => info.role) },
        loading: false,
        seconds: 0,
        selected: -1,
        status: '準備できました。再生するか、時刻を動かしてください。',
      });
    } catch (error) {
      if (!controller.signal.aborted && !this.disposed) this.fail(error);
    } finally {
      if (this.pending === controller) this.pending = undefined;
    }
  }
  setPlaying(playing: boolean): void {
    this.update({
      playing:
        playing &&
        !!this.state.image &&
        !this.state.loading &&
        !this.state.error &&
        !this.state.reducedMotion,
    });
  }
  seek(seconds: number): void {
    if (Number.isFinite(seconds))
      this.update({
        playing: false,
        seconds: Math.max(0, Math.min(this.state.preset.durationSec, seconds)),
      });
  }
  setReducedMotion(reducedMotion: boolean): void {
    this.update({ reducedMotion, playing: false });
  }
  setRole(index: number, role: Role): void {
    const image = this.state.image;
    if (!image || index < 0 || index >= image.roles.length) return;
    const roles = [...image.roles];
    roles[index] = role;
    this.update({ playing: false, image: { ...image, roles } });
  }
  resetRoles(): void {
    const image = this.state.image;
    if (image)
      this.update({
        playing: false,
        image: { ...image, roles: image.inference.map((info) => info.role) },
      });
  }
  select(index: number): void {
    this.update({ selected: this.state.selected === index ? -1 : index });
  }
  advance(delta: number, now: number): void {
    if (!this.state.playing || this.state.reducedMotion) return;
    this.update(
      { seconds: (this.state.seconds + delta) % this.state.preset.durationSec },
      now - this.lastPublish >= 100,
    );
    if (now - this.lastPublish >= 100) this.lastPublish = now;
  }
  fail(error: unknown): void {
    this.update({
      playing: false,
      loading: false,
      error: error instanceof Error ? error.message : String(error),
      status: '画像を表示できません。',
    });
  }
  dispose(): void {
    this.disposed = true;
    this.pending?.abort();
    this.listeners.clear();
  }
}
