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

表示されたループバック URL を開く。運河の街が静止画で出る。見本5枚、自分の画像の選択・ドロップ、台本3種、再生・一時停止、帯での時刻の移動、3本のスライダー、島の役割の付け替えと上下の分割、MP4 と PNG の保存を使える。動きを減らす設定では自走せず、帯で時刻を選べる。終了は Ctrl+C。

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
npm run test:secrets      # 全refのパッチ・コミットメッセージと追跡ファイルの走査
npm run test:captures     # 島の8時点と UI の画面写真
node test/seam.mjs        # test:matrix の1080p動画の継ぎ目を測定
```

Chrome の検査には既存の `../tools/visual-qa/node_modules/playwright-core` と `chromium.launch({ channel: 'chrome' })` を使う。Chrome本体はダウンロードしない。結果の詳細と MP4 は Git 管理外の `test/results/` に出る。行列検査は既にあるファイル名を再開の目印にするため、実装や条件を変えて測り直すときは `test/validate-m2.mjs` の出力ディレクトリを新しい名前にする。各検査は成功・失敗のどちらでもサーバーと Chrome を閉じる。

3ブラウザの検査は `npm run build` の後に行う。Firefox・WebKitを用意する場合は、リポジトリのルートで次を実行する。Windows版WebKitの描画バッファのリサイズの不具合を避けるため、検査用のPlaywrightは修正を含む `1.65.0-alpha-2026-10-26` に固定した。配布するアプリには入らない。

```powershell
Push-Location tools/visual-qa
npm ci --ignore-scripts --no-audit --no-fund
npx --no-install playwright-core install firefox webkit
Pop-Location
```

Viteのbaseは `/hitomeguri-color/`。`npm run dev` と `npx --no-install vite preview --host 127.0.0.1` が示すbase付きURLを使う。Pagesのworkflowは `main` へのpushまたは手動実行で `app/dist` を配る。公開リポジトリの作成・push・Pagesの有効化は、利用者の確認を取ったメインが行う。

見本の本画像は元PNGと画素が完全一致する可逆WebP。初期の5つの小さな絵は96×64の別ファイルで、未選択の本画像は読まない。コード、台本、見本の絵、文書はMIT。見本は画像生成で作ったもので、こちらが持つ権利の範囲で許諾する。第三者のフォントと依存には、それぞれのライセンスが適用される。

## 中核の入口

- `src/color/`: sRGB・線形 sRGB・OKLab・OKLCH と、L・色相を保つ彩度の二分探索。
- `src/palette/`: Worker 内の希少色を残す16色 k-means と固定 Shepard 重み。`islands.ts` は色の重みを位置のゲートで二分する。矩形・半平面は3pxでぼかし、全島の総和を1に保つ。最大32島。
- `src/render/`: `Renderer.upload(data)` と `draw(palette)`。元の OKLab に重み付きのパレット差分を加算する。`diagnostic: true` は丸め前の L 範囲外を赤、色域外を緑で示す。通常の描画では最後の砦として L を [0,1] に収める。島選択・分割プレビューは、色域変換前のOKLabで、非選択のLを0.6倍・彩度を0.25倍にする。保存にはプレビューを入れない。
- `src/script/`: v4.2 の台本と推定規則。`rolePaletteAt` は3つのプリセットと長さ12〜48秒・夜0.2〜4・灯り0〜2を扱う。`strip.ts` は面積最大の空と暖かい空／水から2段の帯を作る。
- `src/safety/estimate.ts`: 描画せずにパレットの運動と元画像の固定重みから編集設定を判定する。L の包絡にかかる画素を60fpsの式で精査し、各フレーム0.5%・逸脱0.08の予算を検査する。パレット色の点滅も視野の全面を占める条件で検査する。`SafetyClient` が Worker で動かす。
- `src/safety/flash.ts`: node 版と全フィールドで一致する WCAG・ITU の解析。書き出し前には長辺384px・30fpsの実描画を検査し、両方に合格したときだけ保存する。
- `src/export/video.ts`: WebCodecs H.264 と mp4-muxer。各フレームの時刻は `i/30`。長辺1920以下・偶数。実装は端末の対応を `isConfigSupported` で調べ、対応しなければ理由を出す。PNG はその時刻の元サイズ。
- `src/state.ts` と `src/render/player.ts`: 単一ストアと React の外の描画ループ。React への時刻通知は最大10回/秒。設定は検査してから反映し、書き出し中は操作を止める。
- `src/product.ts`: 製品名・副題・保存名の元。`src/ui/scales.ts` は標準値を中央にする3本の目盛り。

## 正本・配布物

製品は `experiments/` を読み込まない。v2 の凍結は `test/fixtures/v2/` に、今回の v4.2 は `test/fixtures/v4/` に別々に残す。台本を更新したら、凍結データと行列検査の条件も明示して更新する。

React 19.3.1、TypeScript 5.9.3、Vite 7.3.7、Tailwind CSS 3.4.19、PostCSS 8.5.31、Biome 2.6.3、Vitest 5.0.5。追加は mp4-muxer 5.2.2（MIT）、Phosphor 2.1.10（MIT）、Zen Kaku Gothic New 5.3.1（OFL-1.1）。直接依存は完全な版、間接依存は lock で固定する。配布物には public/THIRD-PARTY-LICENSES.txt の本文を同梱する。`npm run licenses` は他 OS の optional 依存も検査する。

画像・フォント・コードは手元で読み込む。CDN や画像の送信先はない。入口の見本は hero の4枚と港の合計5枚。ほかの3枚は `test/samples.js` から開く検査用で、製品のバンドルには入れない。


## 配布版のフォントと島の強調

配布CSSのフォントはdata URLにせず、同一オリジンのファイルにする。本番CSPは開発用WebSocketを許可しない。`npm run check` は配布物をChromeで開き、コンソール・CSP・和文フォント・選択の画素・PNG/MP4を検査する。

島の強調は非選択のLを0.6倍、彩度を0.25倍に固定し、保存には入れない。[M2最終状態](reports/M2-report.md#m2の最終状態) と [配布版の修正の検査](reports/M2-fix-report.md) を参照。


3本の目盛りは、各プリセットの既定が中央。長さは12〜48秒で、中央の左側・右側をそれぞれ対数で割り当てる。v4.2 の夜・灯りは折れ線。1日の光の既定は24秒/2.1/1.3、長い夕暮れは20秒/1.2/1.3、夜の灯りは32秒/2.3/1.5。切り替え・同じプリセットの再選択で3本とも既定に戻る。
