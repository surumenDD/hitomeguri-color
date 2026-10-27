import { foregroundLight } from '../foreground';
import type { Decomposition } from '../palette/types';
import { rolePaletteAt } from '../script';
import type { AppStore } from '../state';
import { Renderer } from './index';

/** React owns controls; this object owns GPU resources and requestAnimationFrame. */
export class Player {
  readonly renderer: Renderer;
  private uploaded?: Decomposition;
  private frame?: number;
  private previous?: number;
  private unsubscribe: () => void;
  private media = matchMedia('(prefers-reduced-motion: reduce)');
  private motionChanged = () => this.store.setReducedMotion(this.media.matches);
  private visibilityChanged = () => {
    this.previous = undefined;
  };
  constructor(
    canvas: HTMLCanvasElement,
    private store: AppStore,
  ) {
    this.renderer = new Renderer(canvas);
    store.setReducedMotion(this.media.matches);
    this.unsubscribe = store.subscribe(this.changed);
    this.media.addEventListener('change', this.motionChanged);
    document.addEventListener('visibilitychange', this.visibilityChanged);
    this.changed();
  }
  private changed = () => {
    try {
      this.draw();
      if (this.store.getState().playing && this.frame === undefined)
        this.frame = requestAnimationFrame(this.tick);
      if (!this.store.getState().playing) {
        if (this.frame !== undefined) cancelAnimationFrame(this.frame);
        this.frame = undefined;
        this.previous = undefined;
      }
    } catch (error) {
      this.handleError(error);
    }
  };
  private handleError(error: unknown): void {
    // Unsubscribe before publishing an error so a failed GPU does not recurse through draw.
    this.unsubscribe?.();
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.store.fail(error);
  }
  private tick = (now: number) => {
    // Keep the current RAF token set while publishing, to avoid scheduling two loops.
    try {
      if (!document.hidden && this.previous !== undefined)
        this.store.advance(Math.min(0.1, (now - this.previous) / 1000), now);
      this.previous = document.hidden ? undefined : now;
      this.draw();
      this.frame = this.store.getState().playing ? requestAnimationFrame(this.tick) : undefined;
    } catch (error) {
      this.handleError(error);
    }
  };
  draw(): void {
    const state = this.store.getState(),
      image = state.image;
    if (!image) return;
    if (this.uploaded !== image.data) {
      this.renderer.upload(image.data);
      this.uploaded = image.data;
      this.renderer.size(image.data.metadata.width, image.data.metadata.height);
    }
    this.renderer.uploadForeground(state.foreground?.data);
    const palette = rolePaletteAt(
      image.data.metadata.palette,
      image.roles,
      state.seconds,
      state.preset,
    );
    this.renderer.draw(palette, {
      selected: state.selected,
      splitAt: state.splitPreview?.at,
      splitLower: state.splitPreview?.side === 'lower',
      foreground: state.foreground && {
        ...state.foreground,
        light: foregroundLight(image.data.metadata, image.roles, palette),
      },
    });
  }
  dispose(): void {
    this.unsubscribe();
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.media.removeEventListener('change', this.motionChanged);
    document.removeEventListener('visibilitychange', this.visibilityChanged);
    this.renderer.dispose();
  }
}
