# M1 の分解

受け手はコーディネーター。全 Task の編集範囲はこの子ワークツリーの `app/`。試作・仕様・素材は変更しない。

| Task                 | Target / Ownership                                        | Change                                                                | Observable acceptance                             | 担当           |
| -------------------- | --------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------- | -------------- |
| 骨組み               | package・ビルド・型・lint 設定                            | 固定版の React / Vite / TypeScript strict / Tailwind / Biome / Vitest | check と build、許可ライセンスだけの lock         | Codex          |
| 色と分解             | src/color/、src/palette/ の実装                           | 行列変換、二分探索、希少色を残す16色抽出、Worker、固定 Shepard        | 基準値、重みの性質、2MP 時間                      | Codex          |
| 色と重みの単体テスト | src/color/color.test.ts、src/palette/weights.test.ts のみ | 指定 API に対する独立した検査                                         | 基準5色・目標2色・重みの3性質・距離比             | dsh / DeepSeek |
| 合成                 | src/render/                                               | WebGL2 の差分、色域変換、診断と明度の最終制限                         | Chrome で元画像の PSNR ∞                          | Codex          |
| 台本                 | src/script/                                               | v2 の数値を名前付き状態とプリセットへ移し、推定と再生を行う           | 全役割・721時点で原版と誤差0、8時点で描画を比較   | Codex          |
| 操作と状態           | src/App.tsx、state.ts、image.ts、samples.ts、Player       | 静止画からの開始、読み込み・ドロップ・役割・時刻、React 外の時計      | Chrome の操作検査、reduced motion で5秒画素差0    | Codex          |
| 統合検査と報告       | test/、reports/、README.md                                | 凍結 v2 との比較、速度、ライセンス、配布物の起動、手順と結果          | npm run check、test:production、報告と8時点の一覧 | Codex          |

色・分解・シェーダ・台本・状態はデータ型と GPU 配置を共有する。小さく切ると型と受け渡しの説明を繰り返すため、adviser が一続きに実装した。基準値と重みの性質は、入力・API・許容差を事前に決められるので dsh に分けた。

dsh の Task は `color-weight-tests.txt`。Orca の Task は `task_e8d8b0f9e4ab`、Dispatch は `ctx_1710b0affc33`。親 Run は `run_b192743c5933`。起動・一次レビュー・解放の結果は検証報告に記載する。
