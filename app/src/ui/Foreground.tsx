import { type CSSProperties, useEffect, useRef } from 'react';
import { FOREGROUND_DEFAULTS, foregroundBounds } from '../foreground';
import type { AppState, AppStore } from '../state';

const normal = FOREGROUND_DEFAULTS.blend;
const blendPosition = (f: number) =>
  f <= normal ? (f / normal) * 50 : 50 + ((f - normal) / (1 - normal)) * 50;
const positionBlend = (p: number) =>
  p <= 50 ? (p / 50) * normal : normal + ((p - 50) / 50) * (1 - normal);
const blendLabel = (f: number) =>
  f === 0 ? 'なし' : f < normal ? '弱め' : f === normal ? 'ふつう' : f < 1 ? '強め' : '最大';

export function ForegroundPanel({
  state,
  store,
  busy,
  notice,
}: {
  state: AppState;
  store: AppStore;
  busy: boolean;
  notice: React.ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null),
    add = useRef<HTMLButtonElement>(null);
  const previous = useRef(!!state.foreground);
  useEffect(() => {
    if (previous.current && !state.foreground) add.current?.focus();
    previous.current = !!state.foreground;
  }, [state.foreground]);
  const fg = state.foreground,
    slidersDisabled = state.loading || state.foregroundLoading || state.exporting || !state.image;
  return (
    <section className="foreground-panel" aria-label="人物" aria-busy={state.foregroundLoading}>
      <h2>人物</h2>
      {fg ? (
        <>
          <div className="foreground-summary">
            <img src={fg.thumbnail} alt="" />
            <span title={fg.name}>{fg.name}</span>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => store.removeForeground()}
            >
              外す
            </button>
          </div>
          <label className="slider">
            <span>大きさ</span>
            <output>{Math.round(fg.size * 100)}%</output>
            <input
              type="range"
              aria-label="大きさ"
              aria-valuetext={`${Math.round(fg.size * 100)}%`}
              min={20}
              max={120}
              step={1}
              value={Math.round(fg.size * 100)}
              disabled={slidersDisabled}
              onChange={(e) => store.setForeground({ size: Number(e.target.value) / 100 })}
            />
          </label>
          <label className="slider">
            <span>光のなじみ</span>
            <output>{blendLabel(fg.blend)}</output>
            <input
              type="range"
              aria-label="光のなじみ"
              aria-valuetext={blendLabel(fg.blend)}
              min={0}
              max={100}
              step={1}
              value={blendPosition(fg.blend)}
              disabled={slidersDisabled}
              onChange={(e) =>
                store.setForeground({ blend: positionBlend(Number(e.target.value)) })
              }
            />
          </label>
        </>
      ) : (
        <p className="foreground-description">
          背景が透けた PNG の人物を重ねられます。人物は色の島に入れず、時刻になじませます。
        </p>
      )}
      <button
        ref={add}
        type="button"
        className="secondary"
        disabled={busy || !state.image}
        onClick={() => input.current?.click()}
      >
        {fg ? '人物の絵を替える' : '人物の絵を重ねる'}
      </button>
      <input
        ref={input}
        className="sr-only"
        aria-label="人物の画像ファイル"
        type="file"
        tabIndex={-1}
        accept="image/png,image/webp"
        disabled={busy || !state.image}
        onChange={(event) => {
          const selected = event.target.files?.[0];
          if (selected) void store.addForeground(selected, selected.name);
          event.target.value = '';
        }}
      />
      {notice}
    </section>
  );
}

export function ForegroundPosition({
  state,
  store,
  busy,
}: {
  state: AppState;
  store: AppStore;
  busy: boolean;
}) {
  const drag = useRef<{
    id: number;
    clientX: number;
    clientY: number;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const fg = state.foreground,
    image = state.image;
  if (!fg || !image || state.loading) return null;
  const bounds = foregroundBounds(
    fg.data,
    image.data.metadata.width / image.data.metadata.height,
    fg,
  );
  return (
    <div className="foreground-placement">
      <button
        type="button"
        className="foreground-position"
        aria-label="人物の位置。矢印キーで動かします"
        disabled={busy}
        style={
          {
            left: `${bounds.x * 100}%`,
            top: `${bounds.y * 100}%`,
            width: `${bounds.width * 100}%`,
            height: `${bounds.height * 100}%`,
          } as CSSProperties
        }
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.1 : 0.01;
          const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
          const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
          if (!dx && !dy) return;
          e.preventDefault();
          store.setForeground({ x: fg.x + dx, y: fg.y + dy });
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const rect = e.currentTarget.parentElement?.getBoundingClientRect();
          if (!rect) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = {
            id: e.pointerId,
            clientX: e.clientX,
            clientY: e.clientY,
            x: fg.x,
            y: fg.y,
            width: rect.width,
            height: rect.height,
          };
        }}
        onPointerMove={(e) => {
          const start = drag.current;
          if (start?.id !== e.pointerId || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
          store.setForeground({
            x: start.x + (e.clientX - start.clientX) / start.width,
            y: start.y + (e.clientY - start.clientY) / start.height,
          });
        }}
        onPointerUp={(e) => {
          e.currentTarget.releasePointerCapture(e.pointerId);
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
      />
    </div>
  );
}
