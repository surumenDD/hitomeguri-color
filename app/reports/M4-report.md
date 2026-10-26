# M4「公開前の確認」報告

受け手は受け入れと公開判断を担当するメイン。開始時の早送りは `61e6790` → `0d65512`、追加の設計・ブランド素材は `6bf0e60` と `5e07a9a` まで取り込んだ。台本はv4.2のまま。GitHubのリポジトリ作成・push・実際のPages配信は行っていない。

## 受け入れの結果

| 項目          | 結果                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| check / build | 成功。13ファイル63テスト、型・Biome・Chromeの開発版と配布版・依存のライセンスを検査                   |
| ブラウザ      | Chrome、Firefox、Windows版WebKitで読み込み・再生・帯・島・分割・PNG・reduced motion・キーボードを確認 |
| axe           | 初期、島の選択、分割中、深夜、書き出し中または非対応、読み込みエラーの全状態で違反0                   |
| 画像          | 可逆WebPを正として、元PNGとの画素比較、元のパレットの再現、台本の3プリセットの始端・終端がPSNR ∞      |
| 点滅・L       | 新しい画像とH.264 Baselineで端点120本＋既定15本が全合格。見積もりの見逃し0                            |
| Pagesのbase   | `/hitomeguri-color/` でWorker・フォント・本画像・サムネイル・ブランド素材が動く                       |
| 既知の限界    | 低速CPUでの2MP前処理の代理測定は中央値1.95秒。v0.1では最適化しないというメインの判断                  |

## ブラウザとアクセシビリティ

| 環境（Windows、Playwright） | 読込・再生・帯・島・分割 | PNG  | MP4                                                                   | reduced motion | コンソール / axe |
| --------------------------- | ------------------------ | ---- | --------------------------------------------------------------------- | -------------- | ---------------- |
| Chrome 155.0.8059.86        | 合格                     | 合格 | H.264、12秒・360フレーム                                              | 5秒の画素差0   | 0 / 0            |
| Firefox 158.0               | 合格                     | 合格 | H.264、12秒・360フレーム                                              | 5秒の画素差0   | 0 / 0            |
| WebKit 27.2                 | 合格                     | 合格 | VideoEncoderが無い。指定の非対応の文を表示し、その後もPNG保存が使える | 5秒の画素差0   | 0 / 0            |

WebKitはWindowsの検査用ポートであり、実機のmacOS Safariを動かした結果ではない。デコード元の5枚、WebGLの再現、役割と分割の操作まで同じ検査を実行した。Tab / Shift+Tabで操作へ移り、Enter、矢印、Home / End、Shift＋矢印で操作した。ファイル選択は「自分の絵を開く」からEnterで開く。全操作の焦点が `:focus-visible` と2px以上の輪で見えること、スキップリンク、フッターのリンク、スマホの横はみ出しがないことも確認した。完全な結果は `test/results/m4-browsers/report.json`、集計は [M4-browsers.json](M4-browsers.json)。

分割中の「上・下」のラベルだけは、背景がcanvasのため各ブラウザでコントラストが自動判定不可（incomplete）だった。違反としての検出は0だが、この2箇所は指定の文字影を維持し、メインの目視確認の対象として残す。集計JSONにも判定不可の対象を記録した。

見つけて直した点は次のとおり。

- FirefoxのHigh Profile出力が0以外から始まり、Bフレームの順序を含んでいたため、muxerが失敗して保存が止まった。16フレームだけの素のVideoEncoderでも再現した。Baseline Profileでは0から順に出るので、`avc1.420033` に統一し、実MP4をffprobeで検査した。muxerの例外も出力コールバック内で捕まえ、ページの未処理例外や終わらない進捗にしない。
- Windows版WebKitの描画バッファをリサイズした後の画面採取が空になる不具合は、赤一色のWebGLでも再現した。製品へ回避処理を足さず、修正の入った検査用Playwright `1.65.0-alpha-2026-10-26` に固定した。[上流の不具合と修正](https://github.com/microsoft/playwright/issues/42885) と一致する。新しいWebKitでは画面上の画素の検査も合格。
- 深夜の時刻名のコントラストが1.25:1だった。メインの `ui.md` の追記に従い、`legibleOn` でOKLabのLだけを0.005刻みで上げ、8ビットの表示色で4.5:1を満たす。色相と彩度を保ち、必要なら既存の色域変換を使う。4色の単体検査と、深夜・書き出し中のaxe違反0を確認。帯と進捗の帯の色は元の地平のまま。
- Windows版WebKitは標準のTab移動でリンクを飛ばした。スキップとフッターのリンクに `tabIndex={0}` を明示し、3ブラウザともTabで移ってEnterで使えることと焦点の輪を検査した。

フッターは指定の2段落・12/16px・控えめな色・下線リンク。既存mainの末尾の余白と合わせ、最後の内容から本文まで48px、下32pxにした。日本語の文間の余分な空白を除いた。ファイルを開くときに拡張子を外した名前を作り、絵のaria-labelと保存名に共通で使う。`a.b.jpg` → `a.b`、`island-regression.png` → `ひとめぐり-island-regression-12秒.mp4` を単体とブラウザで検査した。

画面写真: [Chrome横長](M4-chrome-1440.png)、[Chrome縦長](M4-chrome-390.png)、[Firefox横長](M4-firefox-1440.png)、[Firefox縦長](M4-firefox-390.png)、[WebKit横長](M4-webkit-1440.png)、[WebKit縦長](M4-webkit-390.png)。

## 容量・画素・点滅

本画像は合計8,832,714 bytesのPNGから、6,395,554 bytesの可逆WebPへ変更した（約27.6%減）。元PNGと復号したWebPのRGBは全バイト一致し、3ブラウザのcanvasでもPSNR ∞。本画像とは別に96×64のサムネイル5枚（合計12,158 bytes）を置いた。圧縮の一覧と復号画素のSHA-256は [M4-images.json](M4-images.json)。元PNGは変更していない。

初期画面のcold cacheで、ナビゲーションとResource Timingの `transferSize` の合計はChrome 1,875,429 bytes、Firefox 1,882,442 bytes、WebKit 1,865,494 bytes（約1.88MB、ヘッダーの推計を含む）。選ばれた運河の本画像1枚と小さな絵5枚だけを読み、未選択4枚の本体は0件。リソースの内訳は [M4-browsers.json](M4-browsers.json)。画像・フォントを含め、外部への通信は0件だった。

可逆WebPを正として、5枚×3プリセット×長さ12/48秒×夜0.2/4.0×灯り0/2.0の120本と、3プリセットの既定15本をH.264 Baselineで作った。384×256・30fps、node版には `--css-px-per-px 4` を指定し、アプリとnode版のWCAG・ITUの全てに合格。編集見積もりの見逃しは0件。

Lは元画像1536×1024の固定重みで、描画せずに60fpsの式を精査した値。許容差1e-7で、全ネイティブ画素をGPUから読み戻した実測とは区別する。最大27画素（0.0017166%）、最大逸脱0.0524351で、0.5%・0.08の予算内。3プリセットの固定参照との誤差も0。[M4-matrix.json](M4-matrix.json) と、Git管理外の `test/results/m4-v42-videos/` に記録した。

1080p・12秒もH.264、1920×1080、360フレーム、12.000000秒。継ぎ目の復号RGBのMAEは0.4658/255で、通常の隣接差の中央値0.5128、95%点1.0896、最大1.3480の範囲内だった。[M4-loop.json](M4-loop.json)。

## v0.1の既知の限界: 低速CPU

ChromeのCDPでページにCPU4倍の遅延を設定した。校正用の同じ計算はmainで約7.9ms→32.3ms、Workerでは約8.3ms→7.9ms。Workerへ直接 `Emulation.setCPUThrottlingRate` を送っても「pages専用」のエラーとなる。Workerの前処理約0.44秒を、そのまま「4倍遅いCPUでも合格」とは扱わない。

| 測定                                       | 結果                                                   |
| ------------------------------------------ | ------------------------------------------------------ |
| ページCPU4倍、1920×1080の描画              | GPU中央値0.1586ms、同期読出し込み中央値0.8ms           |
| 同じ条件のRAF間隔                          | 中央値16.7ms、95%点16.8ms、最大16.8ms                  |
| 通常速度のWorker、2,000,460画素            | 424.2 / 438.5 / 434.6ms（CDPはWorkerを遅くしていない） |
| 同じ前処理関数をmainでCPU4倍にした代理測定 | 2951.3 / 1949.6 / 1908.7ms。中央値1.95秒               |

代理測定では、sRGB→OKLabの変換が約0.69秒、全画素×16色の重みの計算が約0.72秒を占めた。GPUは実機のRTX 5070 Tiであり、低性能GPUを再現した結果ではない。[M4-performance.json](M4-performance.json) に校正・全測定・制限を記録した。

メインの判断は「通常速度では目標内で、重い計算はWorkerなのでv0.1では最適化しない」。将来の候補は重みの計算をGPUへ移すことと、持ち込む絵を小さくすること。見本の分解結果の事前計算は配る容量が増えるので候補から外した。今回はこれらを実装していない。

応答の検査では、CPU4倍のページに加え、検査時だけパレットWorker内で2秒のCPU負荷を足した。見本3回・2MPファイル3回・読み込み中の別の見本への切り替え1回で、骨組み表示は5.3〜16.4ms、Tabの応答は2.8〜79.5ms。操作を始めたボタンの焦点を保持し、処理中にキーボードでファイル選択を開き、別の見本へ切り替えられた。台本と目盛りは設計どおりdisabledで、支援技術にも無効と伝わる。再生・帯は骨組み表示に替わるため、読み込み中に操作する対象にはしないというメインの確認を得た。

読み込み全体のRAFの最大の空きは383.3msだった。画像のデコード、データの受け渡し、GPU転送や状態の切り替えまで含み、「全ての読み込み段階が60fps」とは主張しない。2秒の負荷を入れたWorkerを含む読み込み全体は約2.8〜3.2秒で、表示開始・操作・焦点の検査は合格。[M4-loading.json](M4-loading.json)。

## Pages・ブランド素材・ライセンス

Viteのbaseは `/hitomeguri-color/`。配布物をその下で開く検査で、Worker・フォント・画像・PNG/MP4が動き、コンソールとCSP違反は0件。`THIRD-PARTY-LICENSES.txt` の6つの実行時依存・フォントの版と本文が、インストール済みの固定パッケージと一致することをcheckに加えた。新しいaxe-coreは検査専用のMPL-2.0で、配る成果物には入らない。

`favicon.svg`、`favicon-32.png`、`favicon-180.png`、`share-1200x630.jpg` はメインの素材をそのままpublicへコピーした。512pxのアイコンと1280×640のGitHub用画像はコピーしていない。distのicon / apple-touch-iconはbase付きで、4ファイルが200。OGの画像とページは指定の絶対URL、文言も指定どおり。素材のバイトを保つため、外部ファイルのfavicon.svgはBiomeのインラインSVG向けのtitle検査からだけ除外した。アプリのaxe検査は除外していない。

rootのLICENSEはMIT、Copyright (c) 2026 surumenDD。[workflow](../../.github/workflows/pages.yml) は公式のActionsを全て完全なコミットSHAに固定し、Node 24.22.1でappをビルドしてPages用のartifactを配る。公開後にPagesのSourceをGitHub Actionsにする。[公式の配置手順](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) に沿ってpermissionsとenvironmentを分けた。リモート未作成のため、GitHub上でのworkflow実行は未検証で、ローカルのbase付き配信までを検査した。

## 履歴の走査と展示用ループ

`git log -p --all` の追加・削除、全refのコミットメッセージ、追跡テキストを走査した。現時点・履歴とも厳密な鍵候補0件、広い候補2件で、2件はworkflowの `id-token` の権限指定と検出器の自己検査用の3文字の例だった。コミットメッセージの候補は0件。候補は報告から消さず、場所を残した。手元パスは現時点10回・8ファイル、履歴10回（追加10・削除0）・8ファイルで、そのうち3回は今回のTask仕様に書いたパターンの例。全ファイル、検出条件、対象外のバイナリなどは [M4-secrets.md](M4-secrets.md) と [JSON](M4-secrets.json)。値は出さず、場所だけを残している。見つかったパスは消していない。公開時の扱いはメインと利用者が決める。合成した小さな別リポジトリでも、ファイル・履歴・コミットメッセージで候補を拾い、報告へ値を漏らさないことを親が確認した。

展示用は運河の街・1日の光・24秒・夜2.1・灯り1.3。アプリの書き出しから作った `reports/showcase/hitomeguri-canal-day.mp4` は1280×854、720フレーム、31,151,179 bytes。GIFは中央を1.6:1に切り抜き、800×500、各コマ256色のパレットで20fpsが111,111,751 bytes、12fpsでも66,443,379 bytesとなった。5MB目安を超えたため12fpsを残し、これ以上の容量調整は不要というメインの指示を受けた。

媒体はメインの追加指示でGit管理外にした。MP4と12fps GIFは `reports/showcase/`、20fpsの試行は `test/results/` にある。設定・ffprobe・コマンドは [showcase/metrics.json](showcase/metrics.json) と `test/showcase.mjs`。原本のMP4はFirefox対応前のHigh Profileで生成したものを保持しており、現在のアプリで再生成するとBaselineになる。READMEに載せる版と見た目はメインが選ぶ。

原本MP4の720フレームと12fps GIFの288フレームも、元サイズでnode版のWCAG・ITUに合格した。どちらも24秒。GIFへの量子化後も別途確認した結果をmetrics.jsonに入れた。

## 検査と引き継ぎ

```text
Test Files 13 passed (13), Tests 63 passed (63)
8画像: shader identity + 3 preset endpoints PSNR Infinity
Production: console errors 0, CSP violations 0, fonts true
3 browsers: all operations passed; axe 0
matrix: 120 endpoints + 15 defaults, all app/node WCAG/ITU passed
licenses: packages 174, invalid []
Bundled runtime/font license versions and full texts match the installed packages.
```

再現は [README](../README.md)。checkのログは `test/results/m4-final-check.log`、全ブラウザは `m4-browsers-final.log`、行列は `m4-matrix-final.log`。行列の最初の試行では検査器自身のfavicon参照による404が1件あった。HTMLに空のfaviconを指定して直し、既に合格した135本を全行再確認して、1080pを書き直した最終試行はエラー0。途中で出力前の失敗を再開した場合も、最終段階で全行の合否を必ず検査する。

dshへは [履歴の走査](../tasks/M4-secret-scan.txt) をDeepSeek v4.1 Flashに委譲した。UTC21:06:47→21:26:41、19分55秒。検出器の自己検査22件は親でも合格し、一次レビューでコミットメッセージの走査を追加、対象ユーザーをTaskどおり固定した。追加の依存はなく、3ファイルの範囲に収まった。端末はworker_done後に解放済み。ブラウザ・画像・安全の結合と見た目の判断が動く部分は親が担当し、設計判断はメインへ返した。

ブラウザの取得で `%LOCALAPPDATA%/ms-playwright/` に旧版と修正版のFirefox・WebKitが残る。許可された取得であり、削除していない。合成の走査用リポジトリと検査の動画・ログはapp/test/results内でGit管理外。メインの作業ツリーは変更していない。4173番の既存配信には触れていない。検査用サーバー・ブラウザ・ffmpegは終了させてから報告する。
