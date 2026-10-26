# export-spike — ブラウザの中だけでループ動画と GIF を書き出す

8秒でちょうど1周するアニメーションを WebGL2 で描き、実時間の録画ではなく「時刻を1コマずつ
進めて描いたフレーム」を WebCodecs で符号化して MP4（H.264）・WebM（VP9）・GIF に書き出した。
書き出しは全部ページの中で完結し、node は Chrome を起動してファイルを受け取るだけ。

## 結論

- **できる。** Chrome 155（headless、実 GPU）で、8秒 1920×1080 の H.264 を 0.61 秒、VP9 を
  0.91 秒で書き出せた。どちらも PSNR 42 dB 台で、ループの継ぎ目は隣のコマとの差と同程度。
- **GIF は重い。** 960×540・20fps の GIF が 3.69 MB で、画素もコマ数も多い 1280×720・30fps の
  MP4（3.60 MB）より大きい。
- **勧めは MP4（H.264）を主、WebM（VP9）を軽さ重視の代替、GIF は最後の手段。** 理由は
  「推奨」の節に書いた。

## 動かし方

```sh
cd experiments/export-spike
npm install                 # mp4-muxer / webm-muxer / gifenc（版は固定）
node run-export.mjs         # 参照フレームを作って 6 本書き出す（out/ へ）
node measure.mjs            # ffprobe / ffmpeg で測り、この NOTES の表を更新する
node probe-webcodecs.mjs    # この環境でどのコーデックが使えるかだけを見る（引数に msedge も可）
node serve.mjs              # プレビュー用の静的サーバ（http://127.0.0.1:8123/）
```

`run-export.mjs` は 127.0.0.1 に静的サーバを立て、`tools/visual-qa/node_modules` の
playwright-core で `chromium.launch({ channel: 'chrome' })` する。書き出したファイルは
ページから `POST /upload/...` で送られ、node が `out/` に書く。終了時にブラウザとサーバは閉じる。

`node serve.mjs` で開くとプレビューが動く（`?preview=0` で停止、`?w=1920&h=1080` で大きさ指定）。
`index.html` をファイルとして直接開いても動かない。ES modules と WebCodecs が `file://` を
拒むため、http のオリジンが要る。

## ループの作り方と、決定性の確かめ方

`src/loop-scene.js` の `renderAt(t)` は **t だけの純関数**。`requestAnimationFrame` も
`Date.now()` も乱数も使わない。時刻は 8 秒で折り返し、色相は OKLCH でちょうど1周する。
6枚の角丸の面が楕円上を回り、背景のグラデーションも同じ周期で回る。頂点色は OKLab で
補間しているので、グラデーションはガンマ空間ではなく知覚的な等間隔になる。

決定性は3か所で確かめた。

1. 同じ t を2回描いてバックバッファの FNV-1a ハッシュを比較 → 6 サンプルすべて一致。
   書き出しを全部終えたあとにもう一度測っても一致（長時間動かして状態が変わらない）。
2. t=0 と t=8 を PNG に落として比較 → 3サイズとも**バイト単位で同一**。ループが閉じている。
3. 同じ条件で2回書き出したら、6ファイルともバイト数まで一致した（3,779,330 / 6,914,720 /
   2,943,051 / 5,517,196 / 3,868,658 / 2,703,925 バイト）。エンコーダまで含めて再現する。

## 書き出しの作り

- **映像**: `new VideoFrame(canvas, {timestamp})` → `VideoEncoder.encode()` → muxer の
  `addVideoChunk()`。`renderAt(i / 30)` の時刻をそのまま PTS にしているので、実時間とは無関係。
  キーフレームは 1 秒ごと。エンコーダのキューが詰まったら `encodeQueueSize` を見て待つ。
- **GIF**: 960×540 に描き、2D canvas に `drawImage` して `getImageData`（WebGL の上下反転も
  ここで吸収される）。gifenc の `quantize` で 256 色パレットを作り、`applyPalette` で索引に落として
  `writeFrame`。ディレイ 50 ms、`repeat: 0` で無限ループ。
- 参照フレーム（PSNR の元）は同じ `renderAt(t)` から PNG で書き出す。符号化に渡したのと同じ絵を
  別経路で保存しているので、比較の基準になる。

### ページと node の受け渡し

WebCodecs は `[SecureContext]` なので、`about:blank` では `VideoEncoder` が **undefined** になる
（実測）。`http://127.0.0.1` は安全なコンテキスト扱いなので、静的サーバ経由で開いている。
数 MB の動画は CDP 越しに返さず、ページから HTTP で POST して node が書く方式にした。

## 測定条件

| 項目 | 値 |
| --- | --- |
| ブラウザ | Chrome 155.0.8059.86（headless、`channel: 'chrome'`） |
| GPU | ANGLE / NVIDIA GeForce RTX 5070 Ti (D3D11) |
| 映像 | 30 fps、8 秒 = 240 コマ、音声なし |
| ビットレート | 1280×720 = 4 Mb/s、1920×1080 = 8 Mb/s（H.264 と VP9 で同じ） |
| H.264 | `avc1.640033` を要求（実際に書かれたレベルは 720p が 4.1、1080p が 5.0） |
| VP9 | `vp09.00.31.08`（720p）/ `vp09.00.40.08`（1080p） |
| GIF | 960×540、20 fps、8 秒 = 160 コマ、256 色 |
| 計測 | ffmpeg N-122319（winget の yt-dlp 同梱ビルド） |

<!-- metrics:start -->
<!-- この節は measure.mjs が out/metrics.json から自動生成する。手で編集しない。 -->

### 時間とサイズ

| 形式 | 大きさ | コマ数 | 描画 + 取り込み | 符号化 | 多重化 | 合計 | 実時間比 | ファイル |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MP4 / H.264 | 1280×720 | 240 | 13 ms | 426 ms | 2.8 ms | 442 ms | 18.1× | 3.60 MB |
| MP4 / H.264 | 1920×1080 | 240 | 13 ms | 595 ms | 3.3 ms | 612 ms | 13.1× | 6.59 MB |
| WebM / VP9 | 1280×720 | 240 | 8 ms | 614 ms | 0.5 ms | 622 ms | 12.9× | 2.81 MB |
| WebM / VP9 | 1920×1080 | 240 | 9 ms | 901 ms | 1.0 ms | 911 ms | 8.8× | 5.26 MB |
| GIF / ローカルパレット | 960×540 | 160 | 174 ms | 1776 ms | — | 1951 ms | 4.1× | 3.69 MB |
| GIF / 全体パレット | 960×540 | 160 | 165 ms | 816 ms | — | 988 ms | 8.1× | 2.58 MB |

「符号化」は `VideoEncoder` に投げてから `flush()` が返るまで。「多重化」は muxer の
`finalize()`。GIF には符号化の段が無いので、同じ列にパレット作成・量子化・ストリーム書き出しの
合計を入れてある。「実時間比」は 8 秒ぶんを何倍速で書き出せたか。

### 品質

| 形式 | 大きさ | PSNR (RGB) 平均 | PSNR 最小 | SSIM (RGB) | 継ぎ目 PSNR | 隣接フレーム PSNR (中央値) |
| --- | --- | --- | --- | --- | --- | --- |
| MP4 / H.264 | 1280×720 | 42.08 dB | 41.18 dB | 0.981 | 27.62 dB | 27.75 dB |
| MP4 / H.264 | 1920×1080 | 42.83 dB | 42.08 dB | 0.983 | 27.51 dB | 27.63 dB |
| WebM / VP9 | 1280×720 | 41.77 dB | 38.95 dB | 0.981 | 27.63 dB | 27.76 dB |
| WebM / VP9 | 1920×1080 | 42.62 dB | 39.44 dB | 0.983 | 27.52 dB | 27.64 dB |
| GIF / ローカルパレット | 960×540 | 38.74 dB | 36.13 dB | 0.967 | 23.54 dB | 23.37 dB |
| GIF / 全体パレット | 960×540 | 34.69 dB | 32.34 dB | 0.948 | 23.47 dB | 23.25 dB |

PSNR/SSIM は元のフレーム（PNG、RGB24）と復号結果を RGB で比べたもの。色変換は各ファイルが
宣言している BT.709 に従わせている。PSNR は全フレームの平均と最小。
「継ぎ目 PSNR」は復号した先頭フレームと最終フレームの比較、「隣接フレーム PSNR」は同じ
ファイルの全フレーム間 PSNR の中央値。両者が同程度なら、1周して戻る瞬間の見た目の差は
ふつうのコマ送り1回分と同じで、継ぎ目は目立たない。

ソースのループの閉じ方（同じ時刻を再レンダリングした結果の比較）:

- 1280×720: t=0 と t=8 の PNG が**完全一致**（バイト単位で同じ）
- 1920×1080: t=0 と t=8 の PNG が**完全一致**（バイト単位で同じ）
- 960×540: t=0 と t=8 の PNG が**完全一致**（バイト単位で同じ）

### ffprobe の要点

| ファイル | コンテナ | コーデック | 解像度 | fps | 長さ | フレーム数 | ビットレート |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `loop-1280x720-h264.mp4` | mov,mp4,m4a,3gp,3g2,mj2 | h264 (High, level 4.1) | 1280×720 | 30 | 8.000 s | 240 | 3.78 Mb/s |
| `loop-1920x1080-h264.mp4` | mov,mp4,m4a,3gp,3g2,mj2 | h264 (High, level 5.0) | 1920×1080 | 30 | 8.000 s | 240 | 6.91 Mb/s |
| `loop-1280x720-vp9.webm` | matroska,webm | vp9 (Profile 0) | 1280×720 | 30 | 7.966 s | — | 2.96 Mb/s |
| `loop-1920x1080-vp9.webm` | matroska,webm | vp9 (Profile 0) | 1920×1080 | 30 | 7.966 s | — | 5.54 Mb/s |
| `loop-960x540-20fps.gif` | gif | gif | 960×540 | 20 | 8.000 s | 160 | — |
| `loop-960x540-20fps-global-palette.gif` | gif | gif | 960×540 | 20 | 8.000 s | 160 | — |

**loop-1280x720-h264.mp4**

```
format_name      mov,mp4,m4a,3gp,3g2,mj2
codec_name       h264 (High, level 4.1)
width x height   1280 x 720
pix_fmt          yuv420p / bt709 / tv
nb_frames        240
avg_frame_rate   30/1 (30 fps)
duration         8.000 s
bit_rate         3.78 Mb/s
size             3779330 bytes
```

**loop-1920x1080-h264.mp4**

```
format_name      mov,mp4,m4a,3gp,3g2,mj2
codec_name       h264 (High, level 5.0)
width x height   1920 x 1080
pix_fmt          yuv420p / bt709 / tv
nb_frames        240
avg_frame_rate   30/1 (30 fps)
duration         8.000 s
bit_rate         6.91 Mb/s
size             6914720 bytes
```

**loop-1280x720-vp9.webm**

```
format_name      matroska,webm
codec_name       vp9 (Profile 0)
width x height   1280 x 720
pix_fmt          yuv420p / bt709 / tv
nb_frames        (未記録)
avg_frame_rate   30/1 (30 fps)
duration         7.966 s
bit_rate         2.96 Mb/s
size             2943051 bytes
```

**loop-1920x1080-vp9.webm**

```
format_name      matroska,webm
codec_name       vp9 (Profile 0)
width x height   1920 x 1080
pix_fmt          yuv420p / bt709 / tv
nb_frames        (未記録)
avg_frame_rate   30/1 (30 fps)
duration         7.966 s
bit_rate         5.54 Mb/s
size             5517196 bytes
```

**loop-960x540-20fps.gif**

```
format_name      gif
codec_name       gif
width x height   960 x 540
pix_fmt          bgra
nb_frames        160
avg_frame_rate   20/1 (20 fps)
duration         8.000 s
bit_rate         3.87 Mb/s
size             3868658 bytes
```

**loop-960x540-20fps-global-palette.gif**

```
format_name      gif
codec_name       gif
width x height   960 x 540
pix_fmt          bgra
nb_frames        160
avg_frame_rate   20/1 (20 fps)
duration         8.000 s
bit_rate         2.70 Mb/s
size             2703925 bytes
```

<!-- metrics:end -->

## 読み取れること

**H.264 と VP9 はほぼ互角、VP9 が 2 割小さい。** 同じビットレートを指定して、実際のファイルは
VP9 が H.264 の 78%（720p: 2.81 対 3.60 MB）と 80%（1080p: 5.26 対 6.59 MB）。画質は PSNR で
0.2〜0.3 dB 低いが、SSIM は同じ 0.981 / 0.983。**VP9 のほうが同じ容量でより良い**というより、
**同じ画質なら VP9 のほうが小さい**という読み方が近い。速度は H.264 が速い（720p で 426 ms 対
614 ms）。

**1080p のほうが PSNR が高い。** ビットレートを画素数に比例させているので、1080p のほうが
1画素あたりの符号量が多く、平坦な面の多い絵ではそのぶん有利に出る。解像度を上げると画質が
上がる、というより「同じ設定なら解像度が高いほど余裕がある」ということ。

**継ぎ目は目立たない。** 復号した先頭コマと最終コマの PSNR は、同じファイルの隣り合うコマ同士の
PSNR の中央値とほぼ同じ（例: 27.62 dB 対 27.75 dB）。つまり1周して戻る瞬間の見た目の変化は、
ふつうのコマ送り1回分と変わらない。仮にループが閉じていなければ、ここの値だけが極端に低くなる。

**GIF は容量で負けている。** 960×540（0.52 メガ画素）・20 fps・160 コマで 3.69 MB は、
1280×720（0.92 メガ画素）・30 fps・240 コマの MP4 の 3.60 MB より大きい。GIF が描いている画素は
MP4 の 38%（0.83 億 対 2.2 億画素）しかないのに、容量は上回る。GIF はコマごとに可逆圧縮（LZW）
するだけで、コマ間の予測をしないため。

### 時間の内訳について

映像の「描画 + 取り込み」が 10 ms 前後と小さいのは、CPU 側の時間しか測っていないため。
GPU の描画と `VideoFrame` のコピーは非同期に進み、その待ちは「符号化」の列に含まれる。
GIF は `getImageData` で GPU から読み戻すので、この列に実時間が出る。

## GIF のパレット: ローカルか、全体か

gifenc は2通りの使い方ができるので、両方書き出して比べた。

| 方式 | パレット | ファイル | PSNR | SSIM | 書き出し時間 |
| --- | --- | --- | --- | --- | --- |
| ローカル（コマごと） | コマごとに 256 色 | 3.69 MB | 38.74 dB | 0.967 | 1951 ms |
| 全体（1周ぶんから1枚） | 全コマ共通で 256 色 | 2.58 MB | 34.69 dB | 0.948 | 988 ms |

色相が1周する絵なので、全体パレットは 360 度ぶんの色を 256 色に押し込むことになり、どうしても
階調が荒れる（PSNR で 4 dB 落ちる）。**コマごとのパレットを勧める**。代償は色テーブル 768 バイト×
159 コマ ≒ 122 KB で、ファイル全体の 3% 程度。速度も 2 倍かかるが、8 秒で 2 秒なら許容範囲。

なお gifenc はディザを持たない。滑らかなグラデーションではバンディングが出るので、GIF を選ぶなら
平坦な配色の絵に向く。

## ブラウザの対応

「API がある」と「そのコーデックのエンコードが動く」は別なので、分けて書く。H.264 / VP9 の列は
仕様ではなく実装の話で、OS とハードウェアにも左右される。

| ブラウザ | `VideoEncoder` | H.264 エンコード | VP9 エンコード | 備考 |
| --- | --- | --- | --- | --- |
| Chrome | 94 から（既定で有効） | 可 | 可 | この環境（155 / Windows / RTX 5070 Ti）で実測。H.264・VP9 とも符号化できた |
| Edge | 94 から（Chromium 追随） | 可 | 可 | Chromium と同じ実装。手元の Edge 156 でも `probe-webcodecs.mjs msedge` で H.264・VP9 とも実際に符号化できた |
| Firefox | 130 から（デスクトップのみ。Android は Nightly のみ） | 条件付きで可 | 条件付きで可 | 自前のエンコーダを持たず、プラットフォームの実装に委ねる。Windows は Media Foundation 経由（`WMFEncoderModule`）。Linux の H.264 はシステム ffmpeg のハードウェアのみで、同梱の ffvpx には H.264 エンコーダが無い |
| Safari | 16.4 から（映像のみ。音声は 26.0） | 可 | **未確認** | H.264 は `avc1.` を受け付け、**偶数サイズ必須**（奇数だと TypeError）。VP9 は `vp09` として許可リストに入っているが、実際に VP9 エンコーダを積んでいるかは一次情報で確認できなかった。`isConfigSupported()` は実際にエンコーダを作って可否を返す実装なので、対応していない環境では false になる |

補足:

- caniuse の Safari は 16.4〜18.x が "partial: Video-only support"、26.0 から full。音声側の
  `AudioEncoder` が Safari 26.0 からのためで、H.264 の映像エンコードとは関係ない。
- Firefox の VP9 は ffvpx（同梱の libvpx）でソフトウェア符号化できる。H.264 はプロプライエタリ
  なので ffvpx では扱えず、Windows は OS のエンコーダ、Linux はハードウェアのみ。
- この試作は Chrome 系でしか動かしていない。Firefox / Safari の列は出典ベースで、実機では
  確かめていない。

### 出典

- MDN browser-compat-data `VideoEncoder`: Chrome 94 / Edge 94 / Firefox 130 / Safari 16.4、
  Firefox Android は false — https://github.com/mdn/browser-compat-data/blob/main/api/VideoEncoder.json
- caniuse WebCodecs（Safari 16.4〜18.x は "partial: Video-only support"、26.0 で full）—
  https://caniuse.com/webcodecs
- Chrome Platform Status: WebCodecs（milestone 94、Enabled by default）—
  https://chromestatus.com/feature/5669293909868544
- MDN: Firefox 130 リリースノート（デスクトップで Web Codecs API、Android は Nightly）—
  https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/130
- WebKit Blog: Safari 16.4 の Web Codecs（"the video portion of Web Codecs API"）—
  https://webkit.org/blog/13966/webkit-features-in-safari-16-4/
- WebKit ソース `WebCodecsVideoEncoder.cpp`（`avc1.` / `vp09.` / `vp8` の許可リスト、
  "H264 only supports even sized frames"、`isConfigSupported` が実際にエンコーダを作る）—
  https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/webcodecs/WebCodecsVideoEncoder.cpp
- Gecko `WMFEncoderModule.cpp`（Windows の Media Foundation 経由）—
  https://github.com/mozilla/gecko-dev/blob/master/dom/media/platforms/wmf/WMFEncoderModule.cpp
- Gecko `FFmpegEncoderModule.cpp`（VP8/VP9/AV1 は ffvpx でも符号化可、H.264/HEVC は
  "can only be encoded via hardware by using the system ffmpeg, not supported by ffvpx"）—
  https://github.com/mozilla/gecko-dev/blob/master/dom/media/platforms/ffmpeg/FFmpegEncoderModule.cpp

## 推奨

1. **MP4（H.264）を主にする。** どのブラウザでも再生でき、この試作では 720p が実時間の 18 倍速、
   1080p が 13 倍速で書き出せた。WebCodecs の H.264 は Chrome / Edge / Firefox / Safari の
   デスクトップすべてで使える見込みが立ち、いちばん移植性が高い。
2. **軽さが要るなら WebM（VP9）を並べる。** 同じビットレートで 2 割小さい。ただし Safari の
   エンコード対応が未確認なので、Safari で書き出させるなら H.264 にフォールバックする。
   `isConfigSupported()` の結果で分岐すればよい。
3. **GIF は最後の手段。** 容量あたりの効率が桁で悪い。使うなら 960 幅・20fps 程度に落とし、
   パレットはコマごとに作る。滑らかなグラデーションには向かない。
4. **muxer は Mediabunny に移す。** 今回使った mp4-muxer 5.2.2 と webm-muxer 5.1.4 はどちらも
   作者によって deprecated 扱いで、後継は Mediabunny。API はこの試作とほぼ同じ形で置き換えられる。
   試作としては十分動くが、製品に持ち込むなら移したほうがよい。

## 制約と、まだ確かめていないこと

- 音声は無し。`AudioEncoder` と音声トラックの多重化は試していない。
- 出力は `ArrayBufferTarget` で丸ごとメモリに持ってから送っている。8 秒 1080p で 7 MB 程度だが、
  長い尺なら `StreamTarget`（mp4-muxer / webm-muxer どちらにもある）で逐次書き出すべき。
- 符号化はメインスレッドで回している。UI を止めたくないなら Worker + `OffscreenCanvas` に移せる
  （gifenc も Worker 前提の使い方が README に載っている）。
- OKLCH の色域外は線形 RGB で clamp しているだけで、gamut mapping はしていない。今回は彩度を
  低めに抑えて回避した。
- WebM の Duration が 7.966 秒になる（8.000 ではない）。webm-muxer が最後のブロックの
  タイムスタンプまでしか書かないため。プレイヤーは `DefaultDuration`（1/30 秒）で補うので実害は
  小さいが、ループ再生の最後の1コマがわずかに短く扱われる可能性がある。
- この環境の Chrome はハードウェアエンコーダを使っている可能性が高い（実時間の十数倍で、
  1080p の VP9 も 1 秒弱）。ただし WebCodecs からは HW / SW の別を取得できないので、断定はしない。
- Safari の VP9 エンコード、Firefox / Safari での実機動作は未確認。

## 使ったライブラリ

`mp4-muxer` / `webm-muxer` / `gifenc` は `experiments/export-spike/package.json` で版を固定している。
3つとも MIT。

| 名前 | 版 | ライセンス | 用途 |
| --- | --- | --- | --- |
| mp4-muxer | 5.2.2 | MIT | H.264 のチャンクを MP4 に多重化（deprecated、後継は Mediabunny） |
| webm-muxer | 5.1.4 | MIT | VP9 のチャンクを WebM に多重化（同上） |
| gifenc | 1.0.3 | MIT | GIF のパレット量子化と符号化 |
| playwright-core | 1.61.1 | Apache-2.0 | `tools/visual-qa` のものを読むだけ（このフォルダには入れていない） |

ページからは `./node_modules/...` の相対パスで読み、CDN は使っていない。

## 作業ツリーについて

`experiments/export-spike/` の外は触っていないし、commit もしていない。`out/` は `.gitignore` で
除外されている（`experiments/export-spike/out/`）。
