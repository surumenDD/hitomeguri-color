# 検証用の画像

色の差し替えの手法が、絵の種類ごとに細部を壊さないかを試すための画像。製品の見本の絵ではない（見本の絵は別に作り込む）。

- 生成: 2026-10-27、利用者の ChatGPT の画像生成（Chrome から操作）。直しは頼んでいない。
- 置き場: `raw/` に生成されたままの PNG。

| ファイル | 大きさ | 種類 | プロンプト | メインの所見 |
|---|---|---|---|---|
| `raw/flat-dusk-harbor.png` | 1536×1024 | 平らな色面 | A serene Japanese coastal town at dusk, flat-color screen-print poster style with large clean shapes: layered mountains, a calm sea, a small harbor with boats, a few paper lanterns, a crescent moon. A limited palette of about 8 flat colors, crisp edges, no gradients, no text, no signature, no border. Landscape 3:2. | 紺とオレンジの補色の対。空に少しグラデーションがあり、色数は8より多い。見本の候補にもなる |
| `raw/painterly-blue-hour-lake.png` | 1536×1024 | 絵画調 | A painterly digital illustration of a quiet lakeside at the blue hour: soft gradients in the sky, reflections on the water, reeds in the foreground, distant hills, a single cabin with a warm window light. Gouache texture, gentle brush strokes, a calm composition with large color masses. No text, no signature. Landscape 3:2. | 筆致と連続した階調。分解の手法を厳しく試す材料 |
| `raw/pixel-rain-street.png` | 1672×941 | にせのドット絵 | 16-bit pixel art scene of a small city street at night in the rain: glowing shop signs without any letters, wet pavement reflections, a tram, layered buildings, about 32 colors, crisp pixels, no anti-aliasing, no text, no signature. Landscape 16:9. | 画素が格子にそろわず、色数も32を大きく超える。本物のドット絵の例ではない |
| `raw/photo-sunset-shore.png` | 1536×1024 | 写真調 | A realistic photograph of a rocky seashore at sunset, long-exposure smooth water, a lighthouse in the distance, clouds catching the light, wide angle, natural colors, high detail. No text, no watermark. Landscape 3:2. | 彩度の強いストックフォト調。階調の検証用 |
