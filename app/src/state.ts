import { download, type ExportProgress, exportPng, exportVideo } from './export/video';
import {
  FOREGROUND_DEFAULTS,
  type Foreground,
  type ForegroundSettings,
  loadForeground,
} from './foreground';
import { decodeImage } from './image';
import { preprocessInWorker } from './palette/client';
import { curate, type Island, materializeIslands, splitIsland } from './palette/islands';
import type { Decomposition } from './palette/types';
import { imageName, outputName } from './product';
import { SafetyClient } from './safety/client';
import type { Estimate } from './safety/estimate';
import { SAMPLES } from './samples';
import { DAYLIGHT, type Inference, inferRoles, PRESETS, type Preset, type Role } from './script';

export interface LoadedImage {
  name: string;
  id?: string;
  base: Decomposition;
  data: Decomposition;
  inference: Inference[];
  islands: Island[];
  initial: Island[];
  roles: Role[];
  splits: { parent: Island; upper: string; lower: string }[];
}
export interface AppState {
  image?: LoadedImage;
  foreground?: Foreground & { origin: 'sample' | 'user' };
  foregroundLoading: boolean;
  foregroundError?: string;
  seconds: number;
  playing: boolean;
  loading: boolean;
  reducedMotion: boolean;
  selected: number;
  splitPreview?: { at: number; side: 'upper' | 'lower' };
  preset: Preset;
  status: string;
  error?: string;
  checking: boolean;
  estimate?: Estimate;
  editError?: string;
  exportError?: string;
  progress?: ExportProgress;
  exporting: boolean;
  saved?: string;
  limits: { nightDepth: [number, number]; glow: [number, number]; durationSec: [number, number] };
}
const limits = () => ({
  nightDepth: [0.2, 4] as [number, number],
  glow: [0, 2] as [number, number],
  durationSec: [12, 48] as [number, number],
});
export class AppStore {
  private state: AppState;
  private snapshot: AppState;
  private listeners = new Set<() => void>();
  private lastPublish = 0;
  private pending?: AbortController;
  private safety?: SafetyClient;
  private revision = 0;
  private disposed = false;
  private exportControl?: AbortController;
  private savedTimer?: ReturnType<typeof setTimeout>;
  constructor(reducedMotion = false) {
    this.state = {
      seconds: 0,
      playing: false,
      loading: false,
      foregroundLoading: false,
      reducedMotion,
      selected: -1,
      preset: DAYLIGHT,
      status: '画像を読み込んでください。',
      checking: false,
      exporting: false,
      limits: limits(),
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
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    if (publish) {
      this.snapshot = this.state;
      for (const listener of this.listeners) listener();
    }
  }
  async load(source: string | File, name: string, id?: string): Promise<void> {
    if (this.state.exporting || this.state.foregroundLoading) return;
    this.pending?.abort();
    const controller = new AbortController();
    this.pending = controller;
    const revision = ++this.revision;
    const sample = typeof source === 'string' ? SAMPLES.find((s) => s.url === source) : undefined;
    let safety: SafetyClient | undefined;
    this.update({
      playing: false,
      loading: true,
      error: undefined,
      editError: undefined,
      status: '色を調べています',
    });
    try {
      const [pixels, person] = await Promise.all([
        decodeImage(source),
        sample?.foreground ? loadForeground(sample.foreground.url) : undefined,
      ]);
      if (controller.signal.aborted) return;
      if (Math.max(pixels.width, pixels.height) > 4096)
        throw new Error(
          `画像が大きすぎます（${pixels.width}×${pixels.height}）。長辺4096px以下にしてから開いてください。`,
        );
      const base = await preprocessInWorker(pixels, controller.signal);
      if (controller.signal.aborted || this.disposed) return;
      const sampleId = id ?? sample?.id;
      const inference = inferRoles(base.metadata),
        islands = curate(sampleId ?? '', base.metadata),
        data = materializeIslands(base, islands),
        roles = islands.map((i) => i.role);
      safety = new SafetyClient(data);
      const estimate = await safety.evaluate(roles, this.state.preset);
      if (controller.signal.aborted || this.disposed || revision !== this.revision) return;
      this.safety?.dispose();
      this.safety = safety;
      safety = undefined;
      let foreground = this.state.foreground;
      if (person && sample?.foreground) {
        this.releaseForeground();
        const { url, ...settings } = sample.foreground;
        foreground = { ...settings, data: person, thumbnail: url, origin: 'sample' };
      } else if (foreground?.origin === 'sample') {
        this.releaseForeground();
        foreground = undefined;
      }
      this.update({
        foreground,
        foregroundError: undefined,
        image: {
          name: typeof source === 'string' ? name : imageName(name),
          id: sampleId,
          base,
          data,
          inference,
          islands,
          initial: islands,
          roles,
          splits: [],
        },
        estimate,
        checking: false,
        loading: false,
        seconds: 0,
        selected: -1,
        limits: limits(),
        editError: estimate.pass ? undefined : estimate.reason,
        status: '準備できました。',
      });
    } catch (error) {
      if (!controller.signal.aborted && !this.disposed)
        this.update({
          loading: false,
          checking: false,
          error:
            error instanceof Error
              ? error.message
              : 'この画像は開けませんでした。PNG・JPEG・WebPの画像を選んでください。',
          status: '画像を開けませんでした。',
        });
    } finally {
      safety?.dispose();
      if (this.pending === controller) this.pending = undefined;
    }
  }
  async addForeground(source: string | File, name: string): Promise<void> {
    if (
      this.state.loading ||
      this.state.foregroundLoading ||
      this.state.checking ||
      this.state.exporting
    )
      return;
    this.update({ foregroundLoading: true, playing: false, foregroundError: undefined });
    try {
      const data = await loadForeground(source);
      if (this.disposed) return;
      const thumbnail = typeof source === 'string' ? source : URL.createObjectURL(source);
      const settings = this.state.foreground ?? FOREGROUND_DEFAULTS;
      this.releaseForeground();
      this.update({
        foreground: {
          x: settings.x,
          y: settings.y,
          size: settings.size,
          blend: settings.blend,
          data,
          name: imageName(name),
          thumbnail,
          origin: 'user',
        },
        foregroundLoading: false,
        exportError: undefined,
        saved: undefined,
      });
    } catch (error) {
      this.update({
        foregroundLoading: false,
        foregroundError: error instanceof Error ? error.message : String(error),
      });
    }
  }
  private releaseForeground(): void {
    if (this.state.foreground?.thumbnail.startsWith('blob:'))
      URL.revokeObjectURL(this.state.foreground.thumbnail);
  }
  removeForeground(): void {
    if (
      this.state.loading ||
      this.state.foregroundLoading ||
      this.state.checking ||
      this.state.exporting
    )
      return;
    this.releaseForeground();
    this.update({
      foreground: undefined,
      foregroundError: undefined,
      exportError: undefined,
      saved: undefined,
      playing: false,
    });
  }
  setForeground(patch: Partial<ForegroundSettings>): void {
    if (
      !this.state.foreground ||
      this.state.loading ||
      this.state.foregroundLoading ||
      this.state.checking ||
      this.state.exporting
    )
      return;
    if (Object.values(patch).some((x) => !Number.isFinite(x))) return;
    const foreground = { ...this.state.foreground, ...patch };
    foreground.size = Math.max(0.2, Math.min(1.2, foreground.size));
    foreground.blend = Math.max(0, Math.min(1, foreground.blend));
    foreground.x = Math.max(0, Math.min(1, foreground.x));
    foreground.y = Math.max(0.2, Math.min(1 + foreground.size * 0.5, foreground.y));
    this.update({ foreground, playing: false, exportError: undefined, saved: undefined });
  }
  setPlaying(playing: boolean): void {
    this.update({
      playing:
        playing &&
        !!this.state.image &&
        !this.state.loading &&
        !this.state.foregroundLoading &&
        !this.state.checking &&
        !this.state.exporting &&
        !!this.state.estimate?.pass &&
        !this.state.reducedMotion,
    });
  }
  seek(seconds: number): void {
    if (Number.isFinite(seconds) && !this.state.exporting)
      this.update({
        playing: false,
        seconds: Math.max(0, Math.min(this.state.preset.durationSec, seconds)),
      });
  }
  setReducedMotion(reducedMotion: boolean): void {
    this.update({ reducedMotion, playing: false });
  }
  async setPreset(id: string): Promise<void> {
    const preset = PRESETS[id];
    if (preset) await this.acceptPreset({ ...preset });
  }
  private async acceptPreset(preset: Preset): Promise<boolean> {
    if (this.state.exporting || this.state.loading || this.state.foregroundLoading) return false;
    const revision = ++this.revision;
    this.update({ playing: false, checking: true, editError: undefined });
    try {
      const result = await this.safety?.evaluate(this.state.image?.roles ?? [], preset);
      if (revision !== this.revision) return false;
      if (result && !result.pass) {
        this.update({ checking: false, editError: result.reason });
        return false;
      }
      this.update({
        preset,
        estimate: result,
        seconds: (this.state.seconds / this.state.preset.durationSec) * preset.durationSec,
        checking: false,
        limits: limits(),
        exportError: undefined,
        saved: undefined,
      });
      return true;
    } catch (error) {
      if (revision === this.revision) this.update({ checking: false, editError: String(error) });
      return false;
    }
  }
  async setParameter(key: 'durationSec' | 'nightDepth' | 'glow', value: number): Promise<void> {
    const before = this.state.preset,
      started = this.revision;
    if (!Number.isFinite(value)) return;
    if (await this.acceptPreset({ ...before, [key]: value })) return;
    if (!this.safety || !this.state.image || this.state.exporting || this.revision !== started + 1)
      return;
    // Find the last acceptable setting, rather than applying and then painting an unsafe one.
    const revision = ++this.revision;
    this.update({ checking: true });
    let safe = before[key],
      unsafe = value;
    for (let i = 0; i < 7; i++) {
      const mid = (safe + unsafe) / 2;
      const result = await this.safety.evaluate(this.state.image.roles, { ...before, [key]: mid });
      if (revision !== this.revision) return;
      if (result.pass) safe = mid;
      else unsafe = mid;
    }
    const preset = { ...before, [key]: safe },
      estimate = await this.safety.evaluate(this.state.image.roles, preset);
    if (revision !== this.revision) return;
    const range = [...this.state.limits[key]] as [number, number];
    range[value > before[key] ? 1 : 0] = safe;
    this.update({
      preset,
      estimate,
      checking: false,
      limits: { ...this.state.limits, [key]: range },
      editError: 'これ以上動かすと、点滅または明るさの基準を超えます。',
    });
  }
  async setRole(index: number, role: Role): Promise<void> {
    const image = this.state.image;
    if (!image?.islands[index] || this.state.exporting) return;
    const roles = [...image.roles];
    roles[index] = role;
    this.update({ playing: false, checking: true });
    const revision = ++this.revision;
    const estimate = await this.safety?.evaluate(roles, this.state.preset);
    if (revision !== this.revision) return;
    if (!estimate?.pass) {
      this.update({ checking: false, editError: estimate?.reason });
      return;
    }
    const islands = image.islands.map((island, k) => (k === index ? { ...island, role } : island));
    this.update({
      image: { ...image, islands, roles },
      estimate,
      checking: false,
      editError: undefined,
      exportError: undefined,
    });
  }
  async resetRoles(): Promise<void> {
    const image = this.state.image;
    if (image && this.state.selected >= 0) {
      const selected = image.islands[this.state.selected];
      const initial = image.initial.find((i) => i.base === selected.base);
      if (initial) await this.setRole(this.state.selected, initial.role);
    }
  }
  select(index: number): void {
    if (!this.state.exporting)
      this.update({ playing: false, selected: this.state.selected === index ? -1 : index });
  }
  previewSplit(preview?: { at: number; side: 'upper' | 'lower' }): void {
    this.update({ splitPreview: preview, playing: false });
  }
  private async acceptIslands(islands: Island[], splits: LoadedImage['splits']): Promise<void> {
    const image = this.state.image;
    if (!image || this.state.exporting) return;
    const revision = ++this.revision;
    this.update({ playing: false, checking: true });
    const data = materializeIslands(image.base, islands),
      client = new SafetyClient(data),
      roles = islands.map((i) => i.role);
    let accepted = false;
    try {
      const estimate = await client.evaluate(roles, this.state.preset);
      if (revision !== this.revision || !estimate.pass) {
        if (revision === this.revision)
          this.update({ checking: false, editError: estimate.reason });
        return;
      }
      this.safety?.dispose();
      this.safety = client;
      accepted = true;
      this.update({
        image: { ...image, data, islands, roles, splits },
        estimate,
        selected: -1,
        checking: false,
        editError: undefined,
        exportError: undefined,
      });
    } catch (error) {
      if (revision === this.revision) this.update({ checking: false });
      throw error;
    } finally {
      if (!accepted) client.dispose();
    }
  }
  async split(index: number, at: number, upper: Role, lower: Role): Promise<void> {
    const image = this.state.image;
    if (!image) return;
    try {
      const parent = image.islands[index],
        islands = splitIsland(
          image.islands,
          index,
          {
            kind: 'line',
            bounds: [0, Math.max(0.01, Math.min(0.99, at)), 1, 1],
            invert: false,
            feather: 3,
          },
          lower,
        );
      islands[index] = { ...islands[index], role: upper };
      await this.acceptIslands(islands, [
        ...image.splits,
        { parent, upper: islands[index].id, lower: islands[index + 1].id },
      ]);
    } catch (error) {
      this.update({ editError: error instanceof Error ? error.message : String(error) });
    }
  }
  async undoSplit(index: number): Promise<void> {
    const image = this.state.image;
    if (!image) return;
    const id = image.islands[index]?.id,
      group = image.splits.find((g) => g.upper === id || g.lower === id);
    if (!group) return;
    const first = image.islands.findIndex((i) => i.id === group.upper),
      second = image.islands.findIndex((i) => i.id === group.lower);
    if (first < 0 || second < 0) return;
    const islands = image.islands.filter((i) => i.id !== group.lower);
    islands[first] = group.parent;
    await this.acceptIslands(
      islands,
      image.splits.filter((g) => g !== group),
    );
  }
  advance(delta: number, now: number): void {
    if (!this.state.playing || this.state.reducedMotion) return;
    this.update(
      { seconds: (this.state.seconds + delta) % this.state.preset.durationSec },
      now - this.lastPublish >= 100,
    );
    if (now - this.lastPublish >= 100) this.lastPublish = now;
  }
  async exportVideo(): Promise<void> {
    const { image, preset, foreground } = this.state;
    if (
      !image ||
      this.state.exporting ||
      this.state.loading ||
      this.state.foregroundLoading ||
      !this.state.estimate?.pass
    )
      return;
    this.exportControl = new AbortController();
    this.update({
      playing: false,
      exporting: true,
      exportError: undefined,
      saved: undefined,
      progress: { phase: 'analysis', fraction: 0 },
    });
    try {
      const result = await exportVideo(image.data, image.roles, preset, {
        foreground,
        signal: this.exportControl.signal,
        progress: (progress) => this.update({ progress }),
      });
      const name = outputName(image.name, preset.durationSec, 'mp4');
      download(result.blob, name);
      this.update({
        progress: { phase: 'encoding', fraction: 1 },
        saved: `保存しました（${name}、${(result.blob.size / 1e6).toFixed(1)}MB）`,
      });
      await new Promise<void>((resolve) => {
        this.savedTimer = setTimeout(resolve, 1500);
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError')
        this.update({ saved: '中止しました' });
      else this.update({ exportError: error instanceof Error ? error.message : String(error) });
    } finally {
      this.exportControl = undefined;
      this.update({ exporting: false, progress: undefined });
    }
  }
  cancelExport(): void {
    this.exportControl?.abort();
  }
  async savePng(): Promise<void> {
    const { image, preset, seconds, foreground } = this.state;
    if (!image || this.state.exporting || this.state.loading || this.state.foregroundLoading)
      return;
    try {
      const blob = await exportPng(image.data, image.roles, preset, seconds, foreground);
      const name = outputName(image.name, Number(seconds.toFixed(1)), 'png');
      download(blob, name);
      this.update({ saved: `保存しました（${name}、${(blob.size / 1e6).toFixed(1)}MB）` });
    } catch (error) {
      this.update({ exportError: error instanceof Error ? error.message : String(error) });
    }
  }
  fail(error: unknown): void {
    this.update({
      playing: false,
      loading: false,
      checking: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  dispose(): void {
    this.disposed = true;
    this.pending?.abort();
    this.releaseForeground();
    this.safety?.dispose();
    this.exportControl?.abort();
    if (this.savedTimer) clearTimeout(this.savedTimer);
    this.listeners.clear();
  }
}
