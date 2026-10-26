import { useEffect, useRef, useSyncExternalStore } from 'react';
import { labHex } from './color';
import { Player } from './render/player';
import { SAMPLES } from './samples';
import { MOMENTS, ROLES, type Role } from './script';
import { AppStore } from './state';

export function App() {
  const storeRef = useRef<AppStore | null>(null);
  if (!storeRef.current) storeRef.current = new AppStore();
  const store = storeRef.current;
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let player: Player | undefined;
    try {
      if (canvasRef.current) player = new Player(canvasRef.current, store);
      void store.load(SAMPLES[0].url, SAMPLES[0].name);
    } catch (error) {
      store.fail(error);
    }
    return () => {
      player?.dispose();
      store.dispose();
    };
  }, [store]);
  const image = state.image;
  const moment = MOMENTS.findLast(([t]) => state.seconds >= t)?.[1] ?? MOMENTS[0][1];
  const loadFile = (file?: File) => {
    if (file) void store.load(file, file.name);
  };
  useEffect(() => {
    const over = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
    };
    const drop = (event: DragEvent) => {
      event.preventDefault();
      const file = event.dataTransfer?.files[0];
      if (file) void store.load(file, file.name);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [store]);
  return (
    <main>
      <h1>色を時間に置く</h1>
      <p>画像をここにドロップするか、ファイルを選んでください。画像はこの端末内で処理します。</p>
      <label>
        見本の画像{' '}
        <select
          value={SAMPLES.find((sample) => sample.name === image?.name)?.id ?? ''}
          disabled={state.loading}
          onChange={(event) => {
            const sample = SAMPLES.find((s) => s.id === event.target.value);
            if (sample) void store.load(sample.url, sample.name);
          }}
        >
          <option value="" disabled>
            {image ? '自分の画像' : '画像を選択'}
          </option>
          {SAMPLES.map((sample) => (
            <option key={sample.id} value={sample.id}>
              {sample.name}
            </option>
          ))}
        </select>
      </label>{' '}
      <label>
        画像ファイル{' '}
        <input
          type="file"
          accept="image/*"
          onChange={(event) => {
            loadFile(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </label>
      <p role="status">{state.status}</p>
      {state.error && <p role="alert">{state.error}</p>}
      <figure>
        <canvas
          ref={canvasRef}
          aria-label={image ? `${image.name}：色の台本の表示` : '画像の表示'}
          role="img"
        />
        <figcaption>{image?.name}</figcaption>
      </figure>
      <p>台本：{state.preset.name}</p>
      <button
        type="button"
        disabled={!image || state.loading || state.reducedMotion || !!state.error}
        onClick={() => store.setPlaying(!state.playing)}
      >
        {state.playing ? '一時停止' : '再生'}
      </button>{' '}
      <label>
        時刻{' '}
        <input
          aria-label="時刻"
          type="range"
          min="0"
          max={state.preset.durationSec}
          step="0.01"
          value={state.seconds}
          disabled={!image || state.loading}
          onChange={(event) => store.seek(Number(event.target.value))}
        />
      </label>{' '}
      <output>
        {state.seconds.toFixed(2)} / {state.preset.durationSec} 秒 · {moment}
      </output>
      {state.reducedMotion && <p>動きを減らす設定が有効です。時刻を手動で選べます。</p>}
      <h2>島と役割</h2>
      <button type="button" disabled={!image || state.loading} onClick={() => store.resetRoles()}>
        自動推定に戻す
      </button>
      <ol>
        {image?.inference.map((info, k) => (
          <li key={info.index}>
            <button
              type="button"
              aria-label={`色 ${k + 1} の場所を確認`}
              aria-pressed={state.selected === k}
              onClick={() => store.select(k)}
            >
              色 {k + 1}
            </button>{' '}
            <span>
              {labHex(image.data.metadata.palette[k])} · {(info.area * 100).toFixed(2)}%
            </span>{' '}
            <label>
              色 {k + 1} の役割{' '}
              <select
                aria-label={`色 ${k + 1} の役割`}
                disabled={state.loading}
                value={image.roles[k]}
                onChange={(event) => store.setRole(k, event.target.value as Role)}
              >
                {Object.entries(ROLES).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>{' '}
            <span>
              自動：{ROLES[info.role]}（{info.reason}）
            </span>
          </li>
        ))}
      </ol>
    </main>
  );
}
