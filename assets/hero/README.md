# 見本の絵（入口に並べる候補）

色だけを巡らせる作品の入口に並べる絵。台本は「元の絵＝夕方」から始まるので、どれも夕方を描く。画風は `assets/samples/raw/flat-dusk-harbor.png`（港町）とそろえた平らなスクリーンプリント。

- 生成: 2026-10-27、利用者の ChatGPT の画像生成（Claude のサブエージェントが Chrome から操作）。直しは頼んでいない。
- アートディレクション: メイン（ADR-0001）。プロンプトの組み立ては `docs/research/synthesis.md` 4c節（用途と種類 → 主役と構図 → 光・素材・配色 → 制約、大きくつながる色面、材質ごとに3段の明暗、黄ばみの抑え）に従った。

共通のプロンプト（各題材の前に付けた）:

> Screen-print travel poster illustration, made as the base image for an animated colour-cycling artwork. The scene is at dusk: a deep blue upper sky and a warm orange horizon band. Composition with clearly separated large colour areas: a wide sky in the upper third, calm water reflecting the sky in the lower third, dark silhouetted foreground forms, and a few small warm light sources. Every material uses only three tones (shadow, base, highlight). Flat colours, crisp edges, large connected colour masses, no gradients except one subtle band in the sky, no paper texture or noise, no yellow tint, no warm filter, no text, no letters, no signature, no border. Landscape 3:2.

| ファイル | 題材 | メインの所見 |
|---|---|---|
| `raw/canal-town.png` | 運河の街、反り橋、提灯、三日月 | 一点透視で役割が全部はっきり分かれる。入口の主役の候補 |
| `raw/snow-village.png` | 雪の山あいの村、凍った湖、満月 | 情報が多い。雪原が空の色を受けて巡る可能性 |
| `raw/lighthouse-cape.png` | 灯台の岬、海、三日月 | 単純で、空と海がくっきり分かれる |
| `raw/desert-oasis.png` | 砂漠のオアシス、テント、ヤシ、隊商 | 砂丘のオレンジが空と近く、一緒に動くか要確認 |
