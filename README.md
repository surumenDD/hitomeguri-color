# ひとめぐり

絵の色が、1日をひとめぐりする。

![海辺、雪の村、運河の街、お祭りの4枚の絵の色が、そろって夕方から夜、朝、昼へと移っていくループ](docs/showcase/hitomeguri-grid-960x600.webp)

左上の海辺と右下のお祭りは、女の子のいない背景に、透過の女の子を「人物の絵を重ねる」で重ねて動かしたものです。雪の村と運河の街は見本の絵です。

サイト: https://surumendd.github.io/hitomeguri-color/

1枚の絵の色を、朝から夜まで動かして見る Web の道具です。絵の形はそのままで、空、灯り、水、影の色だけが時刻に合わせて移ります。人物を重ねると、人物もその時刻の光を受けて場面になじみます。

## できること

- **見る**: 見本の絵が7枚あります（お祭り、海辺、運河の街、雪の村、灯台の岬、オアシス、港町）。お祭りと海辺には女の子がいます。再生を押すと、色が1日をめぐります。
- **試す**: 「自分の絵を開く」で好きな絵を読み込むと、絵を16色の島（色のかたまり）に分け、それぞれの役割（空、灯り、天体、水、影、中間）を推します。役割は島ごとに付け替えられます。同じ色の空と海は、線を1本引いて分けられます。台本は「1日の光」「長い夕暮れ」「夜の灯り」の3つで、「長さ」「夜の深さ」「灯りの強さ」の3本の目盛りで調整します。
- **人物を重ねる**: 背景が透けた PNG の人物を「人物の絵を重ねる」で重ねられます。人物は色の島に分けず、その時刻の空の明るさと光の色を受けて照らされます。大きさ、位置、「光のなじみ」を変えられます。
- **書き出す**: ループする MP4 の動画と、好きな時刻の PNG を保存できます。

画像は端末の外へ送りません。読み込みから書き出しまで、すべてブラウザの中で処理します。

動画の書き出しは、Windows の Chrome と Firefox で確かめています。動画の書き出し（WebCodecs の `VideoEncoder`）に対応していないブラウザでは、PNG の保存だけが使えます。Mac の Safari では、まだ確かめていません。

## 光の点滅への配慮

動画を書き出す前に、光過敏発作の基準（WCAG 2.3.1 と ITU-R BT.1702）で点滅を数え、基準に通った動画だけを書き出します。OS で動きを減らす設定（`prefers-reduced-motion`）をしていると、絵はひとりでには動きません。

## 仕組み

- 色は OKLab で扱います。絵から16色の代表色を取り、各画素に代表色との近さで重み（Shepard の重み）を付け、代表色の移り変わりを画素へ配ります。台本の始まりと終わりでは、元の絵とぴったり同じになります。
- 台本は、役割ごとの色の筋書きです。空は夕方に赤らみ、夜は藍に沈みます。灯りは夜にだけともります。
- 重ねた人物は、空の上空と地平の色から求めた明るさと光の色で、どの時刻でも照らします（[ADR-0009](docs/adr/0009-foreground-layer.md)）。
- 描画は WebGL2、色の解析は Web Worker、動画の書き出しは WebCodecs（H.264）で行います。

## 手元で動かす

Node.js 24 以上が要ります。

```sh
cd app
npm ci
npm run dev
```

検査の回し方は [`app/README.md`](app/README.md) にあります。

## 作り方の記録

設計の判断は [`docs/adr/`](docs/adr/)、調べたことは [`docs/research/`](docs/research/)、見た目の設計は [`docs/design/`](docs/design/) にあります。Claude（Anthropic）が設計と見た目と品質の確認を受け持ち、実装の多くは Orca で束ねた別のモデルのエージェントに任せて作りました（[ADR-0001](docs/adr/0001-orchestration-and-model-roles.md)）。

## 見本の絵について

`assets/` の絵（見本の絵、女の子と背景、検証用の絵）は、すべて ChatGPT の画像生成で作りました。生成した画像の著作権の扱いは国や地域によって定まっていないため、下の MIT ライセンスでの許諾は、作者が持つ権利の範囲に限ります。

## ライセンス

[MIT](LICENSE)。コード、見本の絵、台本の数値、文書のすべてが対象です。

第三者のものは、それぞれのライセンスに従います。

- フォント Zen Kaku Gothic New（SIL Open Font License 1.1）
- npm の依存パッケージ（[`app/public/THIRD-PARTY-LICENSES.txt`](app/public/THIRD-PARTY-LICENSES.txt)）
- `.claude/skills/` の2つのスキル（MIT、elayadesign）

## English

**Hitomeguri** ("one full turn") moves the colours of a picture through a whole day. The shapes stay; only the sky, the lights, the water and the shadows change with the hour.

- **Watch**: seven sample pictures cycle from evening through night, morning and day; two of them have a girl in them.
- **Try**: open your own picture. It is split into 16 colour islands, each given a role (sky, light, celestial, water, shadow, middle) that you can change. Pick one of three scripts and adjust length, night depth and lamp strength.
- **Add a person**: lay a cut-out PNG over the picture. The person is not split into colour islands but lit by the light of the hour (from the sky and the horizon), so they belong to the scene from evening to night.
- **Export**: save a looping MP4 or a PNG of any moment. Videos are checked against the photosensitive-seizure guidelines (WCAG 2.3.1, ITU-R BT.1702) before they are written.

Your picture never leaves your device; everything runs in the browser. Video export needs WebCodecs `VideoEncoder` and has been tested in Chrome and Firefox on Windows; elsewhere you can still save PNGs. The UI is in Japanese. All pictures in this repository, including the girls and their backgrounds, were made with ChatGPT image generation. Everything in this repository is MIT-licensed, to the extent of the author's rights.
