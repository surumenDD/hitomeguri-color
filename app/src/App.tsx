import { Pause, Play, WarningCircle } from '@phosphor-icons/react';
import {
  type CSSProperties,
  type PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { labHex } from './color';
import { legibleOn } from './color/legible';
import { VIDEO_UNSUPPORTED } from './export/video';
import { PRODUCT } from './product';
import { Player } from './render/player';
import { SAMPLES } from './samples';
import { PRESETS, ROLES, type Role } from './script';
import { buildStrip, horizonAt } from './script/strip';
import { AppStore } from './state';
import { ForegroundPanel, ForegroundPosition } from './ui/Foreground';
import {
  durationPosition,
  glowLabel,
  glowPosition,
  nightLabel,
  nightPosition,
  positionDuration,
  positionGlow,
  positionNight,
} from './ui/scales';
import { Timeline, timeName } from './ui/Timeline';

const ROLE_ORDER: Role[] = ['sky', 'water', 'light', 'celestial', 'shadow', 'middle'];
function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="notice" role="alert">
      <WarningCircle size={16} aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
export function App() {
  const storeRef = useRef<AppStore | null>(null);
  if (!storeRef.current) storeRef.current = new AppStore();
  const store = storeRef.current;
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot),
    image = state.image;
  const presetDefaults = PRESETS[state.preset.id];
  const draftPreset = { ...state.preset, ...state.drafts };
  const canvas = useRef<HTMLCanvasElement>(null),
    file = useRef<HTMLInputElement>(null),
    cancel = useRef<HTMLButtonElement>(null),
    picture = useRef<HTMLElement>(null);
  const [split, setSplit] = useState<{
    at: number;
    upper: Role;
    lower: Role;
    side: 'upper' | 'lower';
  } | null>(null);
  const run = (promise: Promise<unknown>) => {
    void promise.catch((error) => store.fail(error));
  };
  useEffect(() => {
    let player: Player | undefined;
    try {
      if (canvas.current) player = new Player(canvas.current, store);
      void store.load(SAMPLES[0].url, SAMPLES[0].name, SAMPLES[0].id);
    } catch (error) {
      store.fail(error);
    }
    return () => {
      player?.dispose();
      store.dispose();
    };
  }, [store]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Selection and image changes invalidate the local split preview.
  useEffect(() => {
    setSplit(null);
  }, [state.selected, image?.data]);
  useEffect(() => {
    store.previewSplit(split ? { at: split.at, side: split.side } : undefined);
  }, [store, split]);
  useEffect(() => {
    if (state.exporting) cancel.current?.focus();
  }, [state.exporting]);
  useEffect(() => {
    const over = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
    };
    const drop = (event: DragEvent) => {
      event.preventDefault();
      const selected = event.dataTransfer?.files[0];
      if (selected) void store.load(selected, selected.name);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [store]);
  const strip = useMemo(
    () => (image ? buildStrip(image.data.metadata, image.roles, state.preset) : undefined),
    [image, state.preset],
  );
  const accent = image
    ? horizonAt(image.data.metadata, image.roles, state.preset, state.seconds)
    : '#ECECEC';
  const busy = state.loading || state.foregroundLoading || state.checking || state.exporting,
    slidersDisabled = state.loading || state.foregroundLoading || state.exporting || !image,
    selected = image?.islands[state.selected];
  const initial = selected ? image?.initial.find((i) => i.base === selected.base)?.role : undefined;
  const splitGroup = selected
    ? image?.splits.find((g) => g.upper === selected.id || g.lower === selected.id)
    : undefined;
  const roleSelect = (
    label: string,
    value: Role,
    onChange: (r: Role) => void,
    onFocus?: () => void,
  ) => (
    <label>
      {label}
      <select
        aria-label={label}
        disabled={busy}
        value={value}
        onFocus={onFocus}
        onChange={(e) => onChange(e.target.value as Role)}
      >
        {Object.entries(ROLES).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
  const moveLine = (event: PointerEvent<HTMLElement>) => {
    const rect = picture.current?.getBoundingClientRect();
    if (rect && split)
      setSplit({
        ...split,
        at: Math.max(0.01, Math.min(0.99, (event.clientY - rect.top) / rect.height)),
      });
  };
  return (
    <>
      <a className="skip" href="#picture" tabIndex={0}>
        絵へ移る
      </a>
      <header className="top">
        <h1 className="name">
          {PRODUCT.name}
          <small>{PRODUCT.subtitle}</small>
        </h1>
        <nav className="samples" aria-label="見本の絵">
          {SAMPLES.map((sample) => (
            <button
              key={sample.id}
              type="button"
              className="thumb"
              aria-label={sample.name}
              aria-pressed={image?.id === sample.id}
              disabled={state.exporting}
              onClick={() => run(store.load(sample.url, sample.name, sample.id))}
            >
              <img src={sample.thumbnail} alt="" width={96} height={64} />
            </button>
          ))}
        </nav>
        <button
          type="button"
          className="open"
          disabled={state.exporting}
          onClick={() => file.current?.click()}
        >
          自分の絵を開く
        </button>
        <input
          ref={file}
          className="sr-only"
          aria-label="画像ファイル"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          tabIndex={-1}
          onChange={(event) => {
            const selected = event.target.files?.[0];
            if (selected) run(store.load(selected, selected.name));
            event.target.value = '';
          }}
        />
      </header>
      <main className="stage" style={{ '--accent': legibleOn(accent) } as CSSProperties}>
        <section aria-label="絵と時間">
          <figure ref={picture} className="picture" id="picture" tabIndex={-1}>
            <canvas
              ref={canvas}
              role="img"
              aria-label={image ? `${image.name}の色の台本` : '絵の表示'}
              style={{ display: state.loading ? 'none' : 'block' }}
            />
            {state.loading && <div className="skeleton picture-skeleton" aria-hidden="true" />}
            <ForegroundPosition state={state} store={store} busy={busy} />
            {split && !state.loading && (
              <div
                className="split-line"
                style={{ '--split-at': `${split.at * 100}%` } as CSSProperties}
              >
                <span className="upper-label">上: {ROLES[split.upper]}</span>
                <span className="lower-label">下: {ROLES[split.lower]}</span>
                <div
                  className="split-handle"
                  role="slider"
                  tabIndex={0}
                  aria-label="島を分ける線"
                  aria-orientation="vertical"
                  aria-valuemin={1}
                  aria-valuemax={99}
                  aria-valuenow={Math.round(split.at * 100)}
                  aria-valuetext={`上から ${Math.round(split.at * 100)}%`}
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    moveLine(e);
                  }}
                  onPointerMove={(e) => {
                    if (e.currentTarget.hasPointerCapture(e.pointerId)) moveLine(e);
                  }}
                  onPointerUp={(e) => {
                    if (e.currentTarget.hasPointerCapture(e.pointerId))
                      e.currentTarget.releasePointerCapture(e.pointerId);
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
                    e.preventDefault();
                    setSplit({
                      ...split,
                      at: Math.max(
                        0.01,
                        Math.min(
                          0.99,
                          split.at + (e.key === 'ArrowDown' ? 1 : -1) * (e.shiftKey ? 0.1 : 0.01),
                        ),
                      ),
                    });
                  }}
                />
              </div>
            )}
          </figure>
          {state.error && <Notice>{state.error}</Notice>}
          {state.loading ? (
            <>
              <div className="skeleton strip-skeleton" />
              <p className="note" role="status">
                色を調べています
              </p>
            </>
          ) : (
            <div className="script">
              <button
                type="button"
                className="play"
                aria-label={state.playing ? '一時停止' : '再生'}
                disabled={!image || busy || state.reducedMotion || !state.estimate?.pass}
                onClick={() => store.setPlaying(!state.playing)}
              >
                {state.playing ? (
                  <Pause size={20} weight="fill" />
                ) : (
                  <Play size={20} weight="fill" />
                )}
              </button>
              <Timeline
                seconds={state.seconds}
                preset={state.preset}
                upper={strip?.upper ?? 'none'}
                lower={strip?.lower ?? 'none'}
                disabled={!image || state.exporting}
                onSeek={(t) => store.seek(t)}
              />
              <p className="when">
                <b>{timeName(state.seconds, state.preset)}</b>
                <span>
                  {state.seconds.toFixed(1)} / {state.preset.durationSec} 秒
                </span>
              </p>
            </div>
          )}
          {state.reducedMotion && (
            <p className="note">動きを減らす設定が有効です。帯で時刻を選べます。</p>
          )}
          {image?.originalSize && !state.loading && (
            <p className="note">
              長辺 2048 px に縮めて開きました（元の大きさは {image.originalSize.width}×
              {image.originalSize.height}）。
            </p>
          )}
          <span className="sr-only" role="status">
            {state.status}
            {state.checking ? ' 設定を確かめています' : ''}
          </span>
        </section>
        <aside className="panel" aria-label="台本と書き出し">
          <div aria-disabled={state.exporting}>
            <h2>台本</h2>
            <fieldset className="presets" aria-label="台本の種類">
              {Object.values(PRESETS).map((p) => (
                <button
                  type="button"
                  key={p.id}
                  disabled={busy || !image}
                  aria-pressed={state.preset.id === p.id}
                  onClick={() => run(store.setPreset(p.id))}
                >
                  {p.name}
                </button>
              ))}
            </fieldset>
            <label className="slider">
              長さ<output>{Number(draftPreset.durationSec.toFixed(1))} 秒</output>
              <input
                aria-label="長さ"
                aria-valuetext={`${Number(draftPreset.durationSec.toFixed(1))} 秒`}
                type="range"
                min={durationPosition(state.limits.durationSec[0], presetDefaults.durationSec)}
                max={durationPosition(state.limits.durationSec[1], presetDefaults.durationSec)}
                step={1}
                value={durationPosition(draftPreset.durationSec, presetDefaults.durationSec)}
                disabled={slidersDisabled}
                onChange={(e) =>
                  run(
                    store.setParameter(
                      'durationSec',
                      positionDuration(Number(e.target.value), presetDefaults.durationSec),
                    ),
                  )
                }
              />
            </label>
            <label className="slider">
              夜の深さ
              <output>{nightLabel(draftPreset.nightDepth, presetDefaults.nightDepth)}</output>
              <input
                aria-label="夜の深さ"
                aria-valuetext={nightLabel(draftPreset.nightDepth, presetDefaults.nightDepth)}
                type="range"
                min={nightPosition(state.limits.nightDepth[0], presetDefaults.nightDepth)}
                max={nightPosition(state.limits.nightDepth[1], presetDefaults.nightDepth)}
                step={1}
                value={nightPosition(draftPreset.nightDepth, presetDefaults.nightDepth)}
                disabled={slidersDisabled}
                onChange={(e) =>
                  run(
                    store.setParameter(
                      'nightDepth',
                      positionNight(Number(e.target.value), presetDefaults.nightDepth),
                    ),
                  )
                }
              />
            </label>
            <label className="slider">
              灯りの強さ
              <output>{glowLabel(draftPreset.glow, presetDefaults.glow)}</output>
              <input
                aria-label="灯りの強さ"
                aria-valuetext={glowLabel(draftPreset.glow, presetDefaults.glow)}
                type="range"
                min={glowPosition(state.limits.glow[0], presetDefaults.glow)}
                max={glowPosition(state.limits.glow[1], presetDefaults.glow)}
                step={1}
                value={glowPosition(draftPreset.glow, presetDefaults.glow)}
                disabled={slidersDisabled}
                onChange={(e) =>
                  run(
                    store.setParameter(
                      'glow',
                      positionGlow(Number(e.target.value), presetDefaults.glow),
                    ),
                  )
                }
              />
            </label>
            {state.editError && (
              <p className="edit-note" role="alert">
                <WarningCircle size={16} />
                <span>{state.editError}</span>
              </p>
            )}
          </div>
          <div aria-disabled={state.exporting}>
            <h2>色の島</h2>
            <div className="islands">
              {ROLE_ORDER.map((role) => {
                const indexes =
                  image?.islands
                    .map((_, k) => k)
                    .filter((k) => image.roles[k] === role)
                    .sort(
                      (a, b) => image.data.metadata.counts[b] - image.data.metadata.counts[a],
                    ) ?? [];
                return indexes.length > 0 ? (
                  <div className="role-row" key={role}>
                    <span>{ROLES[role]}</span>
                    <div>
                      {indexes.map((k) => {
                        const island = image?.islands[k];
                        if (!image || !island) return null;
                        const group = image.splits.find(
                          (g) => g.upper === island.id || g.lower === island.id,
                        );
                        const side = group ? (group.upper === island.id ? '（上）' : '（下）') : '';
                        return (
                          <button
                            type="button"
                            key={island.id}
                            data-testid={`island-${k}`}
                            className="swatch"
                            aria-label={`${ROLES[role]}${side}、面積 ${Math.round((image.data.metadata.counts[k] / (image.data.metadata.width * image.data.metadata.height)) * 100)}%`}
                            aria-pressed={state.selected === k}
                            disabled={busy}
                            style={{ background: labHex(image.data.metadata.palette[k]) }}
                            onClick={() => store.select(k)}
                          />
                        );
                      })}
                    </div>
                  </div>
                ) : null;
              })}
            </div>
            {selected && (
              <div className="island-editor">
                {split ? (
                  <>
                    {roleSelect(
                      '上の役割',
                      split.upper,
                      (upper) => setSplit({ ...split, upper, side: 'upper' }),
                      () => setSplit({ ...split, side: 'upper' }),
                    )}
                    {roleSelect(
                      '下の役割',
                      split.lower,
                      (lower) => setSplit({ ...split, lower, side: 'lower' }),
                      () => setSplit({ ...split, side: 'lower' }),
                    )}
                    <button
                      className="primary"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        run(store.split(state.selected, split.at, split.upper, split.lower))
                      }
                    >
                      分ける
                    </button>
                    <button
                      className="secondary"
                      type="button"
                      disabled={busy}
                      onClick={() => setSplit(null)}
                    >
                      やめる
                    </button>
                  </>
                ) : (
                  <>
                    {roleSelect('役割', selected.role, (role) =>
                      run(store.setRole(state.selected, role)),
                    )}
                    {initial !== selected.role && (
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        onClick={() => run(store.resetRoles())}
                      >
                        自動に戻す
                      </button>
                    )}
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        setSplit({
                          at: image?.data.metadata.spatial[state.selected].y ?? 0.5,
                          upper: selected.role,
                          lower: selected.role,
                          side: 'upper',
                        })
                      }
                    >
                      上下の線で分ける
                    </button>
                    {splitGroup && (
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        onClick={() => run(store.undoSplit(state.selected))}
                      >
                        分割を戻す
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
          <ForegroundPanel
            state={state}
            store={store}
            busy={busy}
            notice={state.foregroundError && <Notice>{state.foregroundError}</Notice>}
          />
          <div className="actions">
            {state.progress ? (
              <>
                <div
                  className="progress"
                  role="progressbar"
                  aria-label="動画の書き出し"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(state.progress.fraction * 100)}
                  style={{ '--progress': `${state.progress.fraction * 100}%` } as CSSProperties}
                >
                  <div style={{ background: strip?.lower }} />
                </div>
                <p className="progress-label" aria-live="polite">
                  {state.progress.phase === 'analysis'
                    ? '1/2 点滅を確かめています'
                    : '2/2 動画を作っています'}{' '}
                  {Math.round(state.progress.fraction * 100)}%
                </p>
              </>
            ) : (
              <button
                type="button"
                className="primary"
                disabled={
                  busy ||
                  !image ||
                  state.videoSupported !== true ||
                  !state.estimate?.pass ||
                  !!state.exportError
                }
                onClick={() => run(store.exportVideo())}
              >
                動画を書き出す
              </button>
            )}
            {state.exporting ? (
              <button
                ref={cancel}
                type="button"
                className="secondary"
                onClick={() => store.cancelExport()}
              >
                中止
              </button>
            ) : (
              <button
                type="button"
                className="secondary"
                disabled={state.loading || state.foregroundLoading || !image}
                onClick={() => run(store.savePng())}
              >
                この瞬間を画像で保存
              </button>
            )}
            {state.exportError || state.videoSupported === false ? (
              <Notice>{state.exportError ?? VIDEO_UNSUPPORTED}</Notice>
            ) : (
              <p className="note" aria-live="polite">
                {state.saved ?? '点滅の基準に通った動画だけを書き出します。画像は外へ送りません。'}
              </p>
            )}
          </div>
        </aside>
      </main>
      <footer className="footer">
        <p>画像はこの端末の中だけで処理し、外へ送りません。見本の絵は画像生成で作りました。</p>
        <p>
          {PRODUCT.name}は MIT ライセンスで公開しています。ソースコードは{' '}
          <a href="https://github.com/surumenDD/hitomeguri-color" tabIndex={0}>
            GitHub にあります
          </a>
          {'。使っている'}
          <a href="THIRD-PARTY-LICENSES.txt" tabIndex={0}>
            素材のライセンス
          </a>
          も読めます。
        </p>
      </footer>
    </>
  );
}
