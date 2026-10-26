# 調査のまとめ（設計に効く知見）

4つの imozuru の調査から、作るものを決めるのに効く知見を拾った。原文の場所は `<話題>/sources/<ファイル>:<行>` で書く（置き場は `~/research/`）。各行の引用は imozuru の `report.py` で原文との一致を照合済み。ここに書いたのはメインが原文の抜き書きを読んで選んだもので、解釈は「→」の後ろに分けて書く。

## 1. 使い手は何に払い、何を嫌うか（color-products-market）

- 広告への不満が繰り返し出る。「毎回のプレイの後に長い広告」（`appstore-reviews-ilhtoo-us.md:91`）、「美しいゲームでもう二度と聞かないために払いたい」（`appstore-reviews-ilh-us.md:2`）、作業中に画面いっぱいの広告（`appstore-reviews-ibispaint-jp.md:13`）。
- 買い切りからサブスクへの移行と、既存機能の有料化に強い反発がある（`appstore-reviews-coolors-us.md:6,7`）。逆に、サブスクでないことが感謝されている（`appstore-reviews-procreate-us.md:20`）。
- 値付けの例: Sip は $10 の買い切り（`tidbits-2019-sip.md:5`）、Coolors は年 $36（`toolradar-coolors-pricing.md:47`）、Pantone Connect は月 $15 で、プラグインの評価は 1.6/5（`appleinsider-2022-pantone-plugin.md:17,21`）。
- 価値として挙がるのは「急がされずにじっくり考えられる」（`appstore-reviews-ilh-jp.md:3`）、時間制限も点数も無い落ち着き（`mechanicsofmagic-2024-color-zen.md:15`）、瞑想的な体験と音（`coronalabs-2017-featured-i-love-hue.md:11`）。
- 作り手の知見:
  - Hue の作者は、色が背景と一致すると物が消える知覚の現象をゲームの中心にした（`mcv-2016-hue-hoffman-interview.md:27,57`）。その効果のため背景は平らな1色にした（同 `:65`）。
  - 同じ作者は、色を混ぜる仕組みに2か月を費やしたが、例外が多く遊び手を混乱させたので捨てた（同 `:43`）。
  - Specimen の作者は「もう一度初心者になって成長を感じたかった」と書く（`motionographer-2015-specimen-process.md:1`）。
- 色のパズルは色覚の多様な人に遊べないことがあり、作り手も認めている（`wikipedia-blendoku.md:18`）。続編では最初から色覚の選択肢を入れた（`toucharcade-blendoku2-review.md:13`）。

→ 売り方は買い切り・広告なしが筋。体験は「急がせない・採点しない」が評価される。色を混ぜることを遊びの規則にすると難しくなる、という作り手本人の失敗がある。

## 2. 色の計算の基準（color-perception-science）

- Ottosson は、既存の知覚均等な色空間はどれも画像処理に使うと重大な欠点があるとし（`ottosson-2020-oklab.md:13`）、CIELAB は青の色相の予測が悪く、CAM16-UCS は彩度の圧縮のためブレンドの振る舞いが良くない、と書く（同 `:97`）。
- 色域に収めるとき、色相の変化は特に目立って不快で、彩度の変化はまだ許容される。MINDE は各次元を等しく重みづけるので最適でない（`css-color4-gamut-mapping.md:2613`）。
- 調和と好みは別物。ペアの好みと調和はどちらも色相が近いほど上がるが、好みは構成色それぞれの好みと明度対比により強く依存する（`schloss-palmer-2011-aesthetic-response.md:10`）。ペアの好み・色相の近さ・低彩度で調和の評定の分散の 82.4% を説明する（同 `:107`）。
- データ駆動の調和モデルの改善は控えめ。O'Donovan ら 2011 の LASSO は、MTurk のデータで平均を出すだけの基準より MAE を 32% 下げた（`odonovan-2011-color-compatibility.txt:443`）。Kuler のデータでは 0.572 → 0.521 にとどまる（同 `:467`）。
- 補間やグラデーションを人に見せて色空間を比べた研究は、探した範囲では無かった。カラーマップでは、均等色空間に基づく方法でも特徴の検出の均等さは達成できないかもしれない、という結果がある（`eurorv-2017-colormap-uniformity.txt:18`）。
- 絵の具の混色: Mixbox は内部で Kubelka–Munk を使い RGB を入れて RGB を出す（`mixbox-github.md:3`）。ただし CC BY-NC 4.0 で、商用は別にライセンスが要る（同 `:383`）。Spectral.js は Kubelka–Munk の混色を行う MIT のライブラリで、OKLab/OKLCh も使う（`spectraljs-readme.md:15,288`）。
- 色と感情の結びつきは、30か国のデータで普遍的なパターン（r = .88）と地域差の両方がある（`jonauskaite-2020-eprints.md:7`）。

→ 色の計算は OKLab/OKLCH。色域に収めるときは色相と明度を保って彩度を下げる（試走の要件 R2 と同じ）。調和を自動で採点して売り物にするのは根拠が弱い。採点より、作り手や使い手の手で選ぶ仕組みのほうが確か。絵の具の混色を使うなら Spectral.js か自前の実装にする。

## 3. 芸術性: 上手い作り手の規則（generative-color-craft）

- **並べ方はパレット選びより大事**（Hobbs、`hobbs-careless.md:55`）。要素ごとに乱数の色はひどい結果になる（`hobbs-2021-color-arrangement.md:13`）。同じか近い色の塊を作り（同 `:63`）、親の色を子が高い確率で継ぐ（同 `:139`）。目を細めて構造が残るかで確かめる（同 `:169`）。
- パレットの作り方は立場が分かれる。Golid は作品ごとに手で色相を試し（`brightmoments-golid.md:21`）、形が決まってから色を選ぶ（同 `:33`）。DesLauriers は既成の人気パレットを使った（`deslauriers-2018-color.md:73`）。Hobbs は他人のパレットを使い続けると成長を妨げると書く（`hobbs-2021-color-arrangement.md:19`）。
- 和田三造の配色辞典の 348 配色は、DesLauriers が誤りと変換を直した JSON（MIT）で手に入る（`deslauriers-dictionary-of-colour-combinations.md:3,9,101`）。
- **時間の中の色**は、ジェネラティブアートの外に知恵がある。
  - Mark Ferrari のカラーサイクリング: ピクセルは静止し、色だけがループする（`ferrari-2010-qa-effectgames.md:23`）。1枚の絵でパレットを差し替え、24時間の光の循環をなめらかに通す（同 `:33`）。絵とパレットの両方を作り込まないと効果は出ない（同 `:27`）。同じ長さ・同じ速さの循環だけでは非常に硬く見える（同 `:107`）。
  - Huckaby は、色を隣へ溶かしながら回す BlendShift Cycling を作った（`huckaby-canvas-cycle.md:25`）。絵を一度描き、動かす色を選んで回しただけでは、たいていひどく見えた（同 `:9`）。
  - Pixar のカラースクリプトは、映画全体の色の移り変わりを先に描く（`romano-thunderchunky.md:55`）。「半分は着想で、半分は連続性」（同 `:61`）。
  - Turrell は薄暮を最良の時刻とする（`turrell-alcalde-2013.md:19`）。
- 色を RGB で補間すると中間が灰色にくすむ。HSL の 0° と 360° を RGB に直してから補間すると遷移しない（`comeau-color-shifting.md:128,182`）。

→ 「どの色か」より「どう置き、どう時間の中で動かすか」に芸術性の差が出る。時間の中の色の設計（カラースクリプト、カラーサイクリング）は作り手の知恵がある。一方、1. で見た有料品の中には、これを中心にしたものは見つからなかった（探した範囲で）。

## 4. 身体と多様性への配慮（color-ergonomics）

- 光過敏の基準（ITU-R BT.1702-3、`itu-r-bt1702-3-pdf.txt:194,210,215,219`）: 暗い側が 160 cd/m² 未満で明暗差が 20 cd/m² 以上の変化を点滅とみなす。飽和した赤の点滅も対象。画面の 25% を超え、1秒に3回を超えるものを避ける。WCAG は飽和した赤を R/(R+G+B) ≥ 0.8 で定める（`wcag-2.3.1-three-flashes.md:61`）。ITU は絶対輝度の差、NHK の指針は輝度の変化の割合で、物差しが違う（`report.html` の食い違いの欄）。
- カラーピッカーの比較: HSV は色の組あたり 41.3 秒、HCI は 46.7 秒で、正確さの差は有意でない（`canham-2023-color-selection-gi.txt:15`）。Douglas & Kirkpatrick（CHI '96）は RGB と HSV で速さにも正確さにも差が無く、フィードバックを増やすと正確さが上がったと報告した（`douglas-kirkpatrick-1996-chi.md:9`）。同じ論文が紹介する Schwarz ら 1987 は RGB を最速だが最も不正確としており、先行研究どうしは食い違う（同 `:31`）。
- CVD のシミュレーション: Machado 2009（`machado-2009-cvd-simulation.md:19`）。Machado の実装のひとつに、彩度の高い色で不正確になるバグがあり修正された（`colorspace-cvd-fix-2023.md:5`）。
- 代わりの手段: Xbox の指針は、赤と緑の組は失敗しやすいので形や文字も併用するよう求める（`xag-102-contrast.md:51`）。Hue の開発元は、色覚の当事者コミュニティの助言を受けて記号の仕組みを作った（`playstation-blog-hue-2016.md:27`）。記号・模様・色名ラベルの効果を評価した研究は、検索の上限で届いていない。
- 画面の輝度が高いと視覚疲労が増える（`benedetto-2014-luminance-blink.txt:28`）。青色光を遮るレンズの利益は確実性が低い（`lawrenson-2023-blue-light-review.txt:1053`）。
- reduced motion の根拠は前庭障害（`webkit-2019-responsive-design-for-motion.md:45`）。穏やかな技術の原典は Weiser & Brown 1996（`weiser-brown-1996-coming-age.md`）。

→ 光過敏の数値は品質の基準として `tools/visual-qa` に入れる（いまの「明るさの急な変化」の判定を、ITU の物差しに合わせて直す）。reduced motion は最初から設計に入れる。色の選び方の UI は、方式（RGB・HSV など）より、選んだ結果をどれだけ見せるかが効く可能性がある。色覚への配慮は、当事者に確かめながら記号や形を重ねる。

## 4b. 方向 B の直接の競合（color-animation-tools、ADR-0003 の後に追加）

- 写真を動かすアプリは、保存と書き出しを有料の壁にしている。「何を保存・書き出すにも払わされる」（`appstore-reviews-motionleap-us.md:3`）、「年 $60」（同 `:13`）。Plotaverse もサブスク化への不満がある（`appstore-reviews-plotaverse-us.md:12`）。
- ドット絵の作り手は、Aseprite にカラーサイクリングを 2019 年から求め続けている。作者は「予定したが実装していない」と答えた（`aseprite-forum-color-cycling-effect.md`）。Pro Motion NG では「手間をかければできる」（同 `:2`）。
- 小さな専用の道具がある。投げ銭制のもの（`kerimsafa-color-cycling.md:17`）と、$3.99 からのもの（`heos-colorshift.md:17`）。

→ 書き出しを有料の壁にしない買い切りは、それだけで差になる。ドット絵の作り手には、満たされていない需要がある。この調査は WebSearch の上限で1周目までで区切っている（Web のループ GIF の道具、VJ の発言は未検索）。

## 5. 設計の原則（案を評価する物差し）

| | 原則 | 根拠 |
|---|---|---|
| P1 | 急がせない。時間制限と点数で縛らない | 1. の使い手の声 |
| P2 | 買い切り、広告なし | 1. の不満と称賛 |
| P3 | 色の計算は OKLab/OKLCH。色域変換は色相と明度を保ち彩度を下げる | 2. |
| P4 | 色の選び方より、置き方と時間の中の動かし方を設計の中心にする | 3. |
| P5 | 循環の長さと速さをそろえない。全体の色の移り変わりを先に設計する | 3. の Ferrari、カラースクリプト |
| P6 | 自動の「調和スコア」を売り物にしない | 2. の予測モデルの精度 |
| P7 | 光過敏の基準を数値で守り、機械で確かめる | 4. |
| P8 | 色覚の多様な人の代わりの手段を最初から入れる | 1. の Blendoku、4. |
| P9 | 色を混ぜることを遊びの規則にするなら、例外で混乱させない設計を先に試す | 1. の Hue の作者の失敗 |

## 6. 分かっていないこと

- Albers『Interaction of Color』、Itten、Moon–Spencer、Ou & Luo の原典は有料で届いていない。
- 補間の色空間を人の評価で比べた研究は見つかっていない。必要なら自分たちで小さく比べる。
- 色を主役にした有料品の、作り手本人のポストモーテムは少ない（Hue と Specimen のみ）。
- 日本語の作り手の配色の発信は、ほとんど見つからなかった。
