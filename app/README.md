# 色を時間に置く — M1

次の実装者向けの起動・検査手順。M1 の作業結果と残る課題は [検証報告](reports/M1-report.md) に分けている。

Node.js 24 以降と、インストール済みの Google Chrome が必要。

```powershell
# リポジトリのルートで、既存のブラウザ検査用依存を用意する
npm ci --prefix tools/visual-qa --ignore-scripts --no-audit --no-fund
Set-Location app
npm ci --ignore-scripts --no-audit --no-fund
npm run dev
```

表示されたループバック URL を開く。港の画像が静止画で出る。見本の選択、画像ファイルの選択・ドロップ、再生・一時停止、時刻、島の場所の確認、役割の付け替えを使える。動きを減らす設定では再生を無効にし、時刻を手動で選べる。終了は Ctrl+C。

```powershell
npm run check            # strict 型検査、Biome、Vitest、Chrome、依存ライセンス
npm run build            # dist/ に静的な配布物を生成
npm run test:production  # build と、サブパスでの配布物・Worker の起動検査
npx vitest run           # 単体テストだけ
```

ブラウザ検査は `../tools/visual-qa/node_modules/playwright-core` 1.61.1 と `chromium.launch({ channel: 'chrome' })` を使う。ブラウザの自動ダウンロードはしない。`test/results/` に全測定値・16枚の PNG・8時点の一覧・操作画面を出し、成功時も失敗時も Chrome と検査用サーバーを閉じる。

## 中核の入口

- `src/color/`: sRGB バイト値、線形 sRGB、OKLab、OKLCH の変換と、L・色相を保つ彩度の二分探索。
- `src/palette/client.ts`: Worker を起動し、RGBA を転送して分解を受け取る。AbortSignal で中止できる。
- `src/palette/preprocess.ts`: 32768 標本、最遠点の初期化、希少色の重み付け、最大20回の k-means。16色を面積順に並べ、Shepard の固定重みを作る。
- `src/render/`: `Renderer.upload(data)` と `Renderer.draw(palette)`。元の OKLab と4枚の重みテクスチャから差分を合成する。`diagnostic: true` は丸め前の L 範囲外を赤、色域外を緑で出す。通常の描画は L を [0,1] に収めてから彩度を下げる。
- `src/script/`: v2 の推定規則、名前付き状態、`Preset` と `rolePaletteAt`。`DAYLIGHT` が「1日の光」。`nightDepth` と `glow` は1だけに対応し、ほかの値は未実装のエラーを返す。
- `src/state.ts` と `src/render/player.ts`: 単一のストアと、React の外の描画ループ。画像変更は前の Worker を中止する。React への時刻通知は最大10回/秒。

製品コードは試作を読み込まない。回帰検査は `test/fixtures/v2/` に凍結した参照を使う。台本を更新するときは、参照と比較条件をどう扱うかも決める。

## 構成と依存

React 19.3.1、TypeScript 5.9.3、Vite 7.3.7、Tailwind CSS 3.4.19、PostCSS 8.5.31、Biome 2.6.3、Vitest 5.0.5。直接依存は完全な版、間接依存は lock の版と integrity で固定する。`npm run licenses` は他 OS 向けの optional 依存も含めて検査する。

Vite 8 と Tailwind 4 の構成には、許可されたライセンスに含まれない Lightning CSS（MPL-2.0）が入ったため、この版を選んだ。Autoprefixer の追加は CC-BY-4.0 の依存を入れるため見送った。Tailwind のリセットは無効で、外枠はブラウザの既定表示を使う。M3 が見た目を設計する。

画像はブラウザ内でデコードし、Worker と GPU へ渡す。CDN、Web フォント、画像のアップロード先はない。見本は `assets/samples/raw/` をビルド時に取り込む。
