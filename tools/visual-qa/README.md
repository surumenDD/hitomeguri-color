# flash-check — 危ない点滅の判定ツール

動画（または PNG 連番）を読み、光過敏発作を誘発しうる「危ない点滅」があるかを判定する。
判定は **WCAG 2.x SC 2.3.1（general flash / red flash thresholds）** と **ITU-R BT.1702-3 Guideline 1**
の両方で行い、結果を別々に JSON で出す。判定の読み方（解釈）は末尾の「解釈」の節に、
根拠の原文の行番号つきで書いてある。

## 使い方

```sh
node tools/visual-qa/flash-check.mjs <動画ファイル | PNG連番のディレクトリ> [オプション]
```

| オプション | 意味 | 既定 |
| --- | --- | --- |
| `--fps N` | PNG 連番のフレームレート（動画はファイルから読む） | 30 |
| `--white N` | 白の輝度（cd/m²）。ITU 判定の画面輝度の換算に使う | 200 |
| `--css-px-per-px N` | 1 画素あたりの CSS px。WCAG の視野（341×256 CSS px）の大きさに効く | 1 |
| `--block N` | 解析ブロックの 1 辺の画素数 | 8 |
| `--min-swing N` | 1 つの変化とみなす相対輝度の振り（ヒステリシス） | 0.01 |

入力の形式:

- **動画ファイル**: ffmpeg で rawvideo / rgb24 に復号して読み込む（ffmpeg は PATH にある前提）。
  サイズとフレームレートは ffprobe（無い場合は `ffmpeg -i` の出力）から得る。
- **PNG 連番のディレクトリ**: ファイル名を数値を含めて順に並べて読む。8 bit・非インターレースの
  gray / gray+alpha / RGB / RGBA / palette に対応した最小の PNG デコーダを内蔵している
  （展開は Node 組み込みの zlib）。アルファは捨てる。

出力は標準出力に JSON。判定が不合格でも終了コードは 0（合否は `pass` フィールドを見る）。
引数や入力が壊れているときは終了コード 2。

テストから直接呼べる関数も export してある:

```js
import { analyzeFrames } from './flash-check.mjs';
// frames は RGB24 の Uint8Array（1 枚のバッファを連結したもの、または Uint8Array の配列）
const report = analyzeFrames(frames, width, height, fps, options);
```

## 出力 JSON

```
input        : 種別・パス・フレーム数
width/height/fps/frameCount/durationSec
analysis     : 使った blockSize / cssPxPerPx / whiteLuminanceCdM2 / minSwing、視野の大きさ
wcag / itu   : 基準ごとの結果
  pass                      : 合否（true = 合格）
  rateExceeded              : 1 秒区間の flash 回数が基準を超えた（場所ごとに数える）
  areaExceeded              : 同時点滅の面積が基準を超えた
  worstWindow               : 1 つの場所（ブロック）が最も多く明滅した 1 秒区間 [startSec, endSec)
      startSec / endSec     : 区間の時刻（flash が無ければ null）
      flashCount            : その区間・その場所の flash の回数
      generalFlashes        : うち輝度条件（WCAG は general flash、ITU は輝度ルール）で数えた回数
      redFlashes            : うち red flash（飽和赤を含む対）の回数
  totalFlashes              : 全ブロックの flash 回数の合計（情報用。頻度の判定は場所ごと）
  maxFlashesPerSecond       : どの 1 秒区間でも最大の flash 回数（場所ごとの最大）
  maxGeneralFlashesPerSecond / maxRedFlashesPerSecond : 同（種別ごと）
  minLeadingEdgeGapMs       : ある場所の flash の先頭どうしの最小間隔（ms、2 回以上ある場所が無ければ null）
  maxConcurrentFlashAreaRatio : 面積の割合
      その 1 秒区間で頻度が 3 回を超えたブロックのうち、同時に点滅しているものの面積の和の最大
      wcag = 341×256 CSS px の視野の中で最も高い割合 / itu = 画面全体に対する割合
```

合格の組み立ては両基準とも同じで、`rateExceeded` と `areaExceeded` の**両方**が立ったとき不合格
（どちらかが基準内なら合格）。頻度は場所（ブロック）ごとに数え、別々の場所の点滅を足し合わせない
（理由は「解釈」13・14）。条件の細かい違いは「解釈」の節を参照。

## 解析の流れとブロック縮小

1. 各フレームを **ブロック単位**に縮める（既定 8×8 画素）。ブロック内の sRGB 8 bit の平均値
   （整数に丸め）でそのブロックの色とし、相対輝度・R/(R+G+B)・CIE 1976 UCS 色度 (u', v') は
   この平均色から計算する。処理量は フレーム数 × ブロック数 で済む。
2. ブロックごとに相対輝度の時系列を作る。隣り合う極大・極小（`--min-swing` 未満の揺れは無視）
   を peaks and valleys とし、そこをまたぐ変化を遷移とする。
3. 遷移を**重複なく 2 つずつ**対にしたものが flash（変化 2 つ = 1 flash）。
   周期的な点滅なら 1 周期 = 1 flash になる。
4. flash ごとに general / red / ITU の各条件を判定し、基準を満たす flash だけを数える。
   頻度（1 秒に何回明滅したか）は**場所（ブロック）ごと**に数える。別々のブロックの flash を
   足し合わせて 1 つの場所の回数にしたりしない。
5. 面積は、その 1 秒区間で頻度が 3 回を超えたブロックのうち、同時に点滅しているものの面積の和
   （進行区間は先頭の遷移から 2 つ目の遷移まで）。これを画面全体比（ITU）と 341×256 CSS px の
   視野内の割合（WCAG、視野をブロック境界に丸めた矩形のどこに置いても最大になる位置を調べる）
   で評価する。部分的にしか点滅していないブロックも 1 ブロック全部が点滅したとして数える（保守側）。

視野の矩形はブロック境界に丸める。既定（ブロック 8 画素・1 画素 = 1 CSS px）では
43×32 ブロック = 344×256 画素 ≒ 341×256 CSS px。

メモリは約 3 バイト × フレーム数 × ブロック数。長い動画は `--block` を大きくするか
`ffmpeg -vf fps=...` でフレームを間引いてから渡す。

## テスト

```sh
node --test tools/visual-qa/test/        # リポジトリのルートから
npm test                                 # tools/visual-qa から
```

合成したフレームを `analyzeFrames` に直接渡す（必須の 6 件＋白輝度の引数・red flash の単独
カウント・無変化・動く帯の 4 件）。最後の 1 件だけ `experiments/role-script-spike/out/` の
再現動画を CLI 経由で検査する（動画か ffmpeg が無い環境ではスキップ）。

補足: `test/package.json` は Node 24 のテストランナーの癖への対処。この Node では
`node --test <ディレクトリ>` がディレクトリを探索せず、ディレクトリ自身を 1 ファイルとして
実行してしまう。`main` をテストファイルに向けることで、`node --test tools/visual-qa/test/`
が実際にテストを実行して通るようになっている。

## 解釈

基準の原文は
`~/research/color-ergonomics/sources/wcag-2.3.1-three-flashes.md`（WCAG）と
`~/research/color-ergonomics/sources/itu-r-bt1702-3-pdf.txt`（ITU）。
行番号はそれぞれこの 2 ファイルのもの。判断に迷って読み方を決めた箇所は次のとおり。

1. **flash は変化 2 つで 1 回**（ITU 219 行 "more than three flashes (i.e. six changes in
   luminance)"、WCAG 173 行 "a pair of opposing changes"、185 行 Note 2）。変化 2 つで 1 flash なので、
   周期的な点滅は 1 周期 = 1 flash。実装では極値を e0,e1,e2,e3… として (e0,e1,e2), (e2,e3,e4)…
   と重複なく対にした。隣り合う変化を重複して数えると 5 Hz の点滅で 10 回/秒、2 Hz ですら
   4 回/秒となり、2 Hz が合格になるはずという前提（テスト 1）と合わないため。
2. **flash の時刻**。変化は極値プレートの境界で起きるので、flash の先頭（leading edge）は中間の
   極値 e1 のフレーム時刻、終端は e2 のフレーム時刻とした。ITU 221〜225 行の "leading edges"
   に合わせている。1 秒区間は開始時刻をずらせる半開区間 [t, t+1)。
3. **general flash**（WCAG 173 行）。対になる 2 つの変化がそれぞれ 0.1 以上（最大相対輝度 1.0 の
   10%）、3 状態のうち最も暗い相対輝度が 0.80 未満のとき成立。"changes of 10% or more" は
   両方の変化に掛かると読んだ（片方だけ 0.1 以上でもう片方が 0.05 のような不揃いな対は
   数えない）。
4. **red flash（WCAG）**（61 行、189 行）。2 つの遷移のどちらかが「R/(R+G+B) ≥ 0.8 の状態への・
   からの遷移」で、かつ**その遷移の 2 状態**の CIE 1976 UCS 色度差が 0.2 を超えるとき成立。
   "the difference between states" を遷移をまたぐ 2 状態で計算した（対全体の 2 状態という読みも
   あるが、対称な点滅なら同じ値になる）。R/(R+G+B) は 8 bit 値で計算。色度の式は 63〜79 行、
   代入する R, G, B は 81 行の指定どおり相対輝度定義の linearized 値。完全な黒は
   X+15Y+3Z = 0 で u'v' が定義できないため、色度差が 0.2 を超えるものとして扱う（保守側）。
5. **面積（WCAG）**（167〜181 行）。"no more than .006 steradians within any 10 degree visual
   field (25% of any 10 degree visual field)" は「341×256 CSS px の矩形をどこに置いても、その
   矩形内の同時点滅面積が矩形面積の 25% 以下なら合格」と読んだ。逆に 25% を超える矩形が 1 つでも
   あれば面積側アウト（保守側）。「点滅の総面積が 341×256 の 25% を超えたらアウト」という読みも
   あるが、広く薄く点滅する場合に判定が変わるので採用しなかった。視野の矩形は 181 行の
   341×256 CSS px（1024×768 で見たとき）。
6. **同時点滅の面積**（WCAG 173 行 "the combined area of flashes occurring concurrently"、
   ITU 215〜217 行）。あるフレームで進行中の flash を持つブロックの面積の和とした。進行区間は
   先頭の遷移から 2 つ目の遷移まで。ITU の面積は 217 行の "displayed screen area" に対する割合で、
   Note 4（261〜263 行）の overscan は考えない。
7. **合格の組み立て**。WCAG 165〜169 行は「1 秒に 3 回以下」「面積が 25% 以下」のどちらかを
   満たせば合格（下側に 2 つの bullet）。ITU 212〜219 行は「面積が 25% 超」**かつ**「1 秒に
   3 回超」のとき不合格。よって両基準とも (rateExceeded && areaExceeded) のとき不合格とした。
   WCAG は 167 行 "no more than three general flashes and / or no more than three red flashes"
   に従い general と red を別々に数え、どちらかが 3 回を超えたらレート側アウト。ITU は 212 行
   "Isolated single, double, or triple flashes are acceptable" どおり 3 回までは許容。
8. **ITU の輝度換算**（188〜198 行、Note 3 = 253〜259 行）。画面輝度 = 相対輝度 × 白の輝度。
   白の輝度は引数（既定 200 cd/m² = Note 3 の SDR のピーク白）。暗い側が 160 cd/m² 未満で、
   暗い側と明るい側の差が 20 cd/m² 以上の対を flash とする。暗い側が 160 cd/m² 以上のときの
   Michelson コントラスト > 1/17 の条件（200〜208 行）は HDR 向けなので実装しない
   （白 200 cd/m² の SDR を前提にしたツールのため）。
9. **saturated red（ITU）**（210 行 "Irrespective of luminance, a transition to or from a
   saturated red is also potentially harmful"）。ITU 本文は saturated red の定義を明示しておらず
   （455〜461 行で今後の検討事項とされている）、WCAG 61 行と同じ R/(R+G+B) ≥ 0.8 を使うことに
   した。"Irrespective of luminance" なので、ITU 側では輝度条件も色度差条件も付けない。WCAG 側の
   red flash は色度差 0.2 を要求するため、同じ映像でも両基準で red の回数が変わりうる。
10. **ITU の 334 ms 例外**（219〜225 行）。60 Hz 環境で先頭が 334 ms 以上離れた連続する flash は、
    明るさや面積にかかわらず許容。実装では、全 flash の先頭間隔の最小値が 334 ms 以上なら
    レート条件を合格扱いにする（`minLeadingEdgeGapMs` に出す）。334 ms 間隔なら 1 秒窓に最大
    3 回しか入り得ないので、この例外と「1 秒に 3 回超」の判定は整合する。50 Hz の 360 ms は
    扱わない（依頼が 60 Hz の 334 ms を指定しているため）。
11. **相対輝度**（WCAG 195〜217 行）。sRGB の定義どおり 0.04045 で分岐し 2.4 乗、
    0.2126 / 0.7152 / 0.0722 で加重和。XYZ は 75〜79 行の係数を使う。
12. **ブロック平均**。ブロック内の sRGB 8 bit の平均値から相対輝度・色度を計算する。
    WCAG 227〜229 行（Note 4）がディザされた色の平均 R, 平均 G, 平均 B を使うとしているのと
    同趣旨。ブロック内で部分的に点滅している場合も、振幅は減った平均色で検出し、面積は
    1 ブロック全部と数える（面積は保守側、振幅は実測寄り）。
13. **頻度は場所（ブロック）ごとに数える**。WCAG 167 行 "there are no more than three general
    flashes and / or no more than three red flashes within any one-second period" と
    ITU 219〜221 行 "there are more than three flashes (i.e. six changes in luminance) within
    any one-second period" が数えているのは、ある場所の明るさが 1 秒に何回明滅したかである。
    flash は WCAG 173 行・ITU 188〜190 行で「相対輝度（輝度）の逆向きの変化の対」と定義されて
    おり、1 回の flash は 1 つの場所の時間的な変化 2 つからなる。よって各ブロックについて
    1 秒窓の flash 数を数え、その最大で判定する。
14. **別の場所の点滅を合算してはいけない理由**。ITU 219 行の "(i.e. six changes in luminance)"
    が数えているのは 1 つの輝度変化列の変化の本数であり、画面の別々の場所で同時に起きた変化を
    まとめて 1 つに数える規定ではない。光過敏の危険は同じ網膜領域の繰り返しする明滅で生じ、
    空間の広さは面積条件（WCAG 169 行、ITU 215〜217 行）で別に見るように、基準は時間の回数と
    面積を別の軸で書いている。ブロックごとに極値の時刻が数コマずれるため、合算して数えると
    「別々の場所の 1 回ずつ」が 1 秒に何十回にもなってしまう。実例として、この数え方の誤りで
    2026-10-27 に `experiments/role-script-spike/out/flat-24s.mp4`（隣り合うコマの最大差 0.087、
    0.1 以上の変化は無し）が 1 秒 30 回・不合格と誤判定された。面積側も同じ理由で、
    「その 1 秒区間で頻度が 3 回を超えたブロック」の同時点滅面積だけを数える（解釈 5・6 の
    面積の測り方自体は変えない）。

## 制限事項

- **等輝度の色の切り替わりは検出されない。** 遷移は相対輝度の極値から作るため、相対輝度がほぼ
  等しい色同士の切り替わりは変化として見えず、red flash の取りこぼしになる可能性がある
  （WCAG 185 行は "relative luminance/color for red flashing" と書いており、色側の peaks and
  valleys を追うべき場面もある）。輝度差がヒステリシス（既定 0.01）未満の変化も同様。
- ブロック単位なので面積は丸め誤差を含む。また、ブロックの一部だけが点滅している場合も
  1 ブロック全部が点滅したとして数える。
- 白の輝度は画面上で一様と仮定している（実測値ではない）。
- WCAG 177 行の例外（1 辺 0.1° 未満の細かいバランスの取れたパターン）は実装していない。
  判定は例外なしの側で行う。
- 長い動画はブロック平均の保持メモリが膨らむ（約 3 バイト × フレーム数 × ブロック数）。
