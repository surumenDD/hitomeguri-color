# ひとめぐり — v0.1

次の実装者向けの起動・検査手順。公開前のブラウザ・アクセシビリティ・容量・配置の確認は [M4報告](reports/M4-report.md)。確定した操作は [M2最終状態](reports/M2-report.md#m2の最終状態)、台本・安全の詳細は [v4.2 報告](reports/M2-v42-report.md)、外枠の照合は [design-qa.md](design-qa.md) に記録する。M1 の記録は [M1 報告](reports/M1-report.md) に残している。

Node.js 24 以降とインストール済みの Google Chrome が必要。開発者の `npm run check` は保存動画の先頭フレームの検査に ffmpeg も使う。

```powershell
# リポジトリのルートで実行
npm ci --prefix tools/visual-qa --ignore-scripts --no-audit --no-fund
Set-Location app
npm ci --ignore-scripts --no-audit --no-fund
npm run dev
```

表示されたループバック URL を開く。お祭りと浴衣の女の子が静止画で出る。見本7枚、自分の画像の選択・ドロップ、台本3種、再生・一時停止、帯での時刻の移動、3本のスライダー、島の役割の付け替えと上下の分割、MP4 と PNG の保存を使える。人物の重ねは「色の島」の下の「人物」から開く。背景が透けた PNG・WebP を1枚置き、大きさ・光のなじみ・位置を変えられる。位置はドラッグか、人物へ Tab で移って矢印キー（1%、Shift と一緒で10%）で動かす。「人物の絵を替える」では置き方となじみを保って画像を替える。動きを減らす設定では自走せず、帯で時刻を選べる。終了は Ctrl+C。

見本は、お祭り、海辺、運河の街、雪の村、灯台の岬、オアシス、港町の順。先頭の2枚は、その見本の人物と設定を読み直す。「外す」で外したあとも、同じ見本を開き直すと人物が付く。人物のない見本や自分の絵へ移ると、見本の人物は外れる。自分で選んだ人物と設定は保たれる。人物つきの見本を開くと、自分の人物もその見本の人物に替わる。

```powershell
npm run check             # strict 型検査、Biome、Vitest、開発・配布版Chrome、依存ライセンス
npm run build             # dist/ に配布物を生成
npm run test:production   # build とサブパスでの配布物・Worker・フォントの起動検査
npm run test:compat       # 配布版のChrome・Firefox・WebKit、axe、キーボード、画像とMP4/PNG
npm run test:loading      # CPU4倍のページと、Worker内に2秒の負荷を足した読み込みの応答
npm run test:matrix       # MP4 120端点 + 15既定 + 1080p/12秒。ffmpeg・ffprobe が必要
npm run test:performance  # 1080p 描画と約2MP の前処理の測定
npm run test:performance:throttled # CDP CPU4倍、Worker適用の校正、同じ前処理の代理測定
npm run test:showcase     # 運河・24秒の展示用MP4/GIF。媒体はGit管理外
node test/showcase-render.mjs <出力先> 名前=<見本のid か画像のパス>:<台本>  # README のループの素材。作り方は ../experiments/brand/reel.sh
npm run test:secrets      # 全refのパッチ・コミットメッセージと追跡ファイルの走査
npm run test:captures     # 島の8時点と UI の画面写真
node test/seam.mjs        # test:matrix の1080p動画の継ぎ目を測定
node test/v02-foreground.mjs # 人物の線形合成・元に戻る・人物なしの画素一致、PNG、2048px縮小、1080p
node test/v02-browser.mjs # 配布版3ブラウザの人物の操作だけを検査（先に build）
node test/v02-captures.mjs # 配布版・実素材2枚の人物あり/なし、夕方・深夜・昼、スマホ
node test/v02-touch.mjs   # 390pxのChromeで実際のタッチ入力を送り、人物をドラッグ
node test/v02-flash.mjs   # 下の6本を出力した後、保存したMP4を復号してWCAG/ITUを検査
node test/v02s-assets.mjs # 新しい2枚のWebPと合成した96×64の見本を再生成（Python/Pillowが必要）
node test/v02s-render.mjs # 配るWebPの端点、CPUとの合成一致、既存5枚の画素一致、1080pの60fps
node test/v02s-browser.mjs # build後の3ブラウザ。人物の4つの決まり、替える操作、axe、初期3.0MB以下
node test/v02s-flash.mjs  # お祭りと海辺×3台本を実際の設定で出力し、保存MP4のWCAG/ITUを検査
```

### 人物つきの README のループ

既存の `名前=背景:台本@島番号=役割,...` に、任意で `#foreground=人物のパス&x=0.68&y=1&size=0.7&blend=0.8` を続ける。`@` の役割指定と併用でき、次のジョブへ前の人物を引き継がない。見本のid `festival` と `seaside` には、サイトと同じ人物と配置が付く。明示した `#foreground=...` はそれを置き換える。大きさ `size` は絵の高さの割合（0.2〜1.2）、`blend` は光のなじみ（0〜1）。`x,y` は下端の中心で、`x` は0〜1、`y` は0.2〜`1 + size/2`。明示した人物の省いた値は画面と同じ標準値になる。`#` 以降は URLSearchParams の形式なので、パス中の `&`、`#`、`+` などはパーセント符号化する。PowerShell では指定全体を引用符で囲む。

```powershell
node test/showcase-render.mjs test/results/v02/videos `
  'seaside-day=../assets/showcase/layer/seaside.png:day#foreground=../assets/showcase/layer/girl.png' `
  'seaside-longDusk=../assets/showcase/layer/seaside.png:longDusk#foreground=../assets/showcase/layer/girl.png' `
  'seaside-nightLights=../assets/showcase/layer/seaside.png:nightLights#foreground=../assets/showcase/layer/girl.png' `
  'riverbank-day=../assets/showcase/layer/riverbank.png:day#foreground=../assets/showcase/layer/girl.png&x=0.25' `
  'riverbank-longDusk=../assets/showcase/layer/riverbank.png:longDusk#foreground=../assets/showcase/layer/girl.png&x=0.25' `
  'riverbank-nightLights=../assets/showcase/layer/riverbank.png:nightLights#foreground=../assets/showcase/layer/girl.png&x=0.25'
```

人物の式・範囲・試作の判定は [V02報告](reports/V02-foreground-report.md)。人物の絵も端末の外へ送らない。

Chrome の検査には既存の `../tools/visual-qa/node_modules/playwright-core` と `chromium.launch({ channel: 'chrome' })` を使う。Chrome本体はダウンロードしない。結果の詳細と MP4 は Git 管理外の `test/results/` に出る。行列検査は既にあるファイル名を再開の目印にするため、実装や条件を変えて測り直すときは `test/validate-m2.mjs` の出力ディレクトリを新しい名前にする。各検査は成功・失敗のどちらでもサーバーと Chrome を閉じる。

3ブラウザの検査は `npm run build` の後に行う。Firefox・WebKitを用意する場合は、リポジトリのルートで次を実行する。Windows版WebKitの描画バッファのリサイズの不具合を避けるため、検査用のPlaywrightは修正を含む `1.65.0-alpha-2026-10-26` に固定した。配布するアプリには入らない。

```powershell
Push-Location tools/visual-qa
npm ci --ignore-scripts --no-audit --no-fund
npx --no-install playwright-core install firefox webkit
Pop-Location
```

Viteのbaseは `/hitomeguri-color/`。`npm run dev` と `npx --no-install vite preview --host 127.0.0.1` が示すbase付きURLを使う。Pagesのworkflowは `main` へのpushまたは手動実行で `app/dist` を配る。公開リポジトリの作成・push・Pagesの有効化は、利用者の確認を取ったメインが行う。

既存5枚の本画像は元PNGと画素が完全一致する可逆WebP。お祭りと海辺の背景は非可逆WebP（画質90）、人物は透過を含めて元PNGとRGBAが一致する可逆WebP。元に戻る約束は配ったWebPの復号画素に対して検査する。小さな絵は96×64の別ファイルで、新しい2枚はアプリの描画で始まりの光を受けた人物を合成してある。未選択の本画像と人物は読まない。変換は `test/v02s-convert.py`、描画と縮小は `test/v02s-assets.mjs`。素材は `../assets/showcase/layer/` から読み、元ファイルは変えない。受け入れの基準と読み込み量は [見本の追加の報告](reports/V02S-samples-report.md)。コード、台本、見本の絵、文書はMIT。見本は画像生成で作ったもので、こちらが持つ権利の範囲で許諾する。第三者のフォントと依存には、それぞれのライセンスが適用される。

## 中核の入口

- `src/color/`: sRGB・線形 sRGB・OKLab・OKLCH と、L・色相を保つ彩度の二分探索。
- `src/palette/`: Worker 内の希少色を残す16色 k-means と固定 Shepard 重み。`islands.ts` は色の重みを位置のゲートで二分する。矩形・半平面は3pxでぼかし、全島の総和を1に保つ。最大32島。
- `src/render/`: `Renderer.upload(data)` と `draw(palette)`。元の OKLab に重み付きのパレット差分を加算する。`diagnostic: true` は丸め前の L 範囲外を赤、色域外を緑で示す。通常の描画では最後の砦として L を [0,1] に収める。島選択・分割プレビューは、色域変換前のOKLabで、非選択のLを0.6倍・彩度を0.25倍にする。保存にはプレビューを入れない。
- `src/foreground.ts` と `src/ui/Foreground.tsx`: 人物の1枚のOKLab+透明度の画像、空の基準、置き方と操作。長辺2048pxへ縮小し、透過の割合を調べる。`Renderer.uploadForeground(data)` は1枚だけ転送し、`draw` の人物の指定にはコマごとの `foregroundLight` を渡す。背景と同じ描画の最後に線形の光で合成する。保存前の実コマ判定も同じ人物の指定を受け取る。
- `src/script/`: v4.2 の台本と推定規則。`rolePaletteAt` は3つのプリセットと長さ12〜48秒・夜0.2〜4・灯り0〜2を扱う。`strip.ts` は面積最大の空と暖かい空／水から2段の帯を作る。
- `src/safety/estimate.ts`: 描画せずにパレットの運動と元画像の固定重みから編集設定を判定する。L の包絡にかかる画素を60fpsの式で精査し、各フレーム0.5%・逸脱0.08の予算を検査する。パレット色の点滅も視野の全面を占める条件で検査する。`SafetyClient` が Worker で動かす。
- `src/safety/flash.ts`: node 版と全フィールドで一致する WCAG・ITU の解析。書き出し前には長辺384px・30fpsの実描画を検査し、両方に合格したときだけ保存する。
- `src/export/video.ts`: WebCodecs H.264 と mp4-muxer。各フレームの時刻は `i/30`。長辺1920以下・偶数。実装は端末の対応を `isConfigSupported` で調べ、対応しなければ理由を出す。PNG はその時刻の元サイズ。
- `src/state.ts` と `src/render/player.ts`: 単一ストアと React の外の描画ループ。React への時刻通知は最大10回/秒。設定は検査してから反映し、書き出し中は操作を止める。
- `src/product.ts`: 製品名・副題・保存名の元。`src/ui/scales.ts` は標準値を中央にする3本の目盛り。

## 正本・配布物

製品は `experiments/` を読み込まない。v2 の凍結は `test/fixtures/v2/` に、今回の v4.2 は `test/fixtures/v4/` に別々に残す。台本を更新したら、凍結データと行列検査の条件も明示して更新する。

React 19.3.1、TypeScript 5.9.3、Vite 7.3.7、Tailwind CSS 3.4.19、PostCSS 8.5.31、Biome 2.6.3、Vitest 5.0.5。追加は mp4-muxer 5.2.2（MIT）、Phosphor 2.1.10（MIT）、Zen Kaku Gothic New 5.3.1（OFL-1.1）。直接依存は完全な版、間接依存は lock で固定する。配布物には public/THIRD-PARTY-LICENSES.txt の本文を同梱する。`npm run licenses` は他 OS の optional 依存も検査する。

画像・フォント・コードは手元で読み込む。CDN や画像の送信先はない。入口の見本は人物つき2枚と、既存のheroの4枚と港の合計7枚。ほかの3枚は `test/samples.js` から開く検査用で、製品のバンドルには入れない。


## 配布版のフォントと島の強調

配布CSSのフォントはdata URLにせず、同一オリジンのファイルにする。本番CSPは開発用WebSocketを許可しない。`npm run check` は配布物をChromeで開き、コンソール・CSP・和文フォント・選択の画素・PNG/MP4を検査する。

島の強調は非選択のLを0.6倍、彩度を0.25倍に固定し、保存には入れない。[M2最終状態](reports/M2-report.md#m2の最終状態) と [配布版の修正の検査](reports/M2-fix-report.md) を参照。


3本の目盛りは、各プリセットの既定が中央。長さは12〜48秒で、中央の左側・右側をそれぞれ対数で割り当てる。v4.2 の夜・灯りは折れ線。1日の光の既定は24秒/2.1/1.3、長い夕暮れは20秒/1.2/1.3、夜の灯りは32秒/2.3/1.5。切り替え・同じプリセットの再選択で3本とも既定に戻る。
