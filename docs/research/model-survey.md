# Web 実装を任せるモデルの公開情報比較

調査日: 2026-10-27（日本時間）。読者は、このプロジェクトの実装担当モデルを選ぶ設計・品質保証担当者を想定する。主要候補は GPT-6.1 Sol、MiMo-V2.6-Pro、DeepSeek-V4.1-Flash-1017。Kimi K3、GLM-5.3、Qwen3.8-Max は Command Code での利用を想定した参考候補として扱う。

「公式」は開発元の仕様・発表・自己評価、「第三者」は評価者自身の測定または配信事業者の掲載情報、「利用者報告」は本人が試したと述べる観察を指す。「見つからず」は、リンク先の確認資料と今回の検索範囲で確認できなかったという意味で、未対応・未測定・不存在の断定ではない。料金は USD / 100万トークンで、原則として通常 API のキャッシュ非適用入力と出力を記す。K・M は出典の表記を保ち、文脈長から出力上限を推定しない。

## 主要候補の仕様

| モデル | 公開日・比較する版 | 文脈長 | 出力上限 | 入力 / 出力料金 | 画像入力 |
|---|---|---|---|---|---|
| OpenAI `gpt-6.1-sol` | **2026-09-29**。[公式・API 更新履歴](https://developers.openai.com/api/docs/changelog) | **1,050,000** トークン。[公式・モデル仕様](https://developers.openai.com/api/docs/models/gpt-6.1-sol) | **128,000** トークン。[公式・モデル仕様](https://developers.openai.com/api/docs/models/gpt-6.1-sol) | **$2 / $10**（Standard、入力が **272K 以下**）。[公式・料金](https://developers.openai.com/api/docs/pricing) | **可**（text / image 入力）。[公式・モデル仕様](https://developers.openai.com/api/docs/models/gpt-6.1-sol) |
| Xiaomi `xiaomi/mimo-v2.6-pro` | 公式 API 更新履歴は **2026-09-22**、Design Arena の発売日欄は **2026-09-21**。日付は一致しない。[公式・更新履歴](https://mimo.mi.com/docs/en-US/updates/model)、[第三者・モデル情報](https://www.designarena.ai/models/mimo-v2.6-pro) | **1M** トークン。[公式・モデル仕様](https://mimo.mi.com/models/en-US/mimo-v2.6-pro) | **128K** トークン。[公式・モデル仕様](https://mimo.mi.com/models/en-US/mimo-v2.6-pro) | **$0.435 / $0.87**（海外向け Real-time API）。[公式・料金](https://mimo.mi.com/docs/en-US/price/pay-as-you-go) | **可**（画像・動画・音声・テキスト入力）。[公式・モデル仕様](https://mimo.mi.com/models/en-US/mimo-v2.6-pro) |
| DeepSeek `deepseek/deepseek-v4.1-flash` 系の **1017 版** | 系列初版 **2026-09-10**、比較対象の更新 **2026-10-17**。公式 API の呼出名は `deepseek-flash`、現行版は `DeepSeek-V4.1-Flash-1017`。[公式・更新履歴](https://api-docs.deepseek.com/updates/)、[公式・モデル一覧](https://api-docs.deepseek.com/quick_start/pricing) | **1M** トークン。[公式・仕様と料金](https://api-docs.deepseek.com/quick_start/pricing) | **384K** トークン。[公式・仕様と料金](https://api-docs.deepseek.com/quick_start/pricing) | **$0.30 / $1.20**（ピーク）、**$0.15 / $0.60**（オフピーク）。[公式・料金](https://api-docs.deepseek.com/quick_start/pricing) | **可**（Vision 対応）。[公式・仕様と料金](https://api-docs.deepseek.com/quick_start/pricing) |

GPT-6.1 Sol は Codex で選べるモデルとして公式に記載される。ただし、ここで比較する API 単価と ChatGPT サインインで使う Codex のプラン内利用量は別で、API 単価から含まれるタスク数を換算しない。[公式・Codex のモデル](https://learn.chatgpt.com/docs/models)、[公式・Codex の料金説明](https://learn.chatgpt.com/docs/pricing)

料金条件の補足:

- GPT-6.1 Sol は入力が **272K 超**なら **$4 / $15**、短い入力のキャッシュ読み取りは **$0.10**。Fast・Ultrafast などの別料金は上表に含めていない。[公式・料金](https://developers.openai.com/api/docs/pricing)
- MiMo のキャッシュヒット入力は **$0.0036**。`mimo-v2.6-pro-ultraspeed` は別料金の **$4.35 / $8.70**。標準 Pro と区別する。[公式・料金](https://mimo.mi.com/docs/en-US/price/pay-as-you-go)
- DeepSeek のキャッシュヒット入力はピーク **$0.006**、オフピーク **$0.003**。ピークは中国の祝日を除く平日の **01:00–04:00 / 06:00–10:00 UTC**、その他はオフピーク。[公式・料金](https://api-docs.deepseek.com/quick_start/pricing)
- 配信先の指定には版を残す。たとえば OpenRouter には `deepseek/deepseek-v4.1-flash-1017` という専用 ID がある。上表の料金は DeepSeek 直販の値である。[第三者・OpenRouter 自身の配信モデル情報](https://openrouter.ai/deepseek/deepseek-v4.1-flash-1017)

## コーディング評価

値は掲載された成功率・解決率の百分率。公式自己評価と独立実測を別列にした。SWE-bench Verified の Vals 測定は飽和を理由に新モデルの追加を終了しており、未掲載モデルの値を他モデルから補わない。[第三者・Vals の説明とアーカイブ](https://www.vals.ai/benchmarks/swebench)

| 主要候補 | SWE-bench Verified | SWE-bench Pro | 公式が発表したエージェント評価 | 第三者の同一評価系: Terminal-Bench 4.0 |
|---|---|---|---|---|
| GPT-6.1 Sol | **見つからず**。確認先: [Vals アーカイブ](https://www.vals.ai/benchmarks/swebench) | **V2 Full: 96.11 ± 1.24**、mini-swe-agent、`xhigh`。[第三者・Scale の実測](https://labs.scale.com/leaderboard/swe_bench_pro_public_v2?tab=full) | 本調査で確認した公式資料では SWE / Terminal-Bench の定量値は **見つからず**。確認先: [公式モデル資料](https://developers.openai.com/api/docs/models/gpt-6.1-sol)、[公式更新履歴](https://developers.openai.com/api/docs/changelog) | **55.05%**、Mini-SWE-agent。[第三者・Vals 実測](https://www.vals.ai/benchmarks/terminal-bench-4) |
| MiMo-V2.6-Pro | **見つからず**。公式発表の蒸留モデルの値は Pro に転用しない。[公式発表](https://mimo.mi.com/docs/en-US/news/latest/v2-6)、[Vals アーカイブ](https://www.vals.ai/benchmarks/swebench) | **見つからず**。確認先: [公式モデルカード](https://huggingface.co/XiaomiMiMo/MiMo-V2.6-Pro-RL)、[Scale V2 Full](https://labs.scale.com/leaderboard/swe_bench_pro_public_v2?tab=full) | Terminal Bench **2.1: 89.9**、**4.0: 34.9**、DeepSWE **v1.1: 71.9**。この表のハーネス条件はモデルカード本文では **見つからず**。[公式・Pro-RL カードの Pro 欄](https://huggingface.co/XiaomiMiMo/MiMo-V2.6-Pro-RL) | **31.31%**、Mini-SWE-agent。[第三者・Vals 実測](https://www.vals.ai/benchmarks/terminal-bench-4) |
| DeepSeek-V4.1-Flash-1017 | この版の値は **見つからず**。確認先: [公式モデルカード](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash-1017)、[Vals アーカイブ](https://www.vals.ai/benchmarks/swebench) | この版の値は **見つからず**。確認先: [公式モデルカード](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash-1017)、[Scale V2 Full](https://labs.scale.com/leaderboard/swe_bench_pro_public_v2?tab=full) | Terminal-Bench **4.0: 42.3**（Claude Code）、DeepSWE **v1.1: 77.0**（Mini-SWE-V2）。[公式・1017 更新](https://api-docs.deepseek.com/updates/) | **31.82%**、Mini-SWE-agent。旧 V4.1 Flash の行と区別した。[第三者・Vals 実測の 1017 行](https://www.vals.ai/benchmarks/terminal-bench-4) |

Vals の Terminal-Bench 4.0 の表は **2026-10-24 更新**。ハーネスは mini-swe-agent、各課題の制限時間は **8時間**、採点は pass@1 を全課題について **3回**実施して平均する avg@3。同じページは、旧版と課題集合もハーネスも異なるため版をまたいだ点数比較はできないと説明している。上表の公式値との開きを、モデルだけの性能差や測定の誤りとは解釈しない。[第三者・Vals の方法](https://www.vals.ai/benchmarks/terminal-bench-4)

SWE-bench Pro **V2 Full** は旧公開分割から問題と評価手順を更新したもので、エージェントの通信先をモデル API に限定し、変更差分を新しい環境で再採点する。発表時に「SWE-bench Pro」とだけ記された値と同じ列で順位を決めない。[第三者・Scale の V2 説明](https://labs.scale.com/leaderboard/swe_bench_pro_public_v2?tab=full)

## フロントエンド・Web・ビジュアルデザイン評価

WebDev Arena は、フロントエンドの成果物やエージェントによる複数段階の実装を利用者が評価するランキング。以下はページに記された **2026-10-22** の値で、`±` は原表の区間表記を簡略化したもの。[第三者・Arena の原表](https://arena.ai/leaderboard/code/webdev)

| 主要候補 | WebDev Arena の掲載名とスコア | Design Arena の Website | 公式による視覚・Web 関連の定量評価 |
|---|---|---|---|
| GPT-6.1 Sol | GPT-6.1 Sol **Max: 1749 ± 12**。[第三者・Arena](https://arena.ai/leaderboard/code/webdev) | **1316 Elo、12位**。[第三者・モデル別ページ](https://www.designarena.ai/models/gpt-6.1-sol) | 対象モデルの Web / デザイン専用の定量値は **見つからず**。確認先: [公式モデル資料](https://developers.openai.com/api/docs/models/gpt-6.1-sol) |
| MiMo-V2.6-Pro | MiMo-V2.6-Pro **1625 ± 9**。推論強度の記載は **見つからず**。[第三者・Arena](https://arena.ai/leaderboard/code/webdev) | **1307 Elo、18位**。[第三者・モデル別ページ](https://www.designarena.ai/models/mimo-v2.6-pro) | MiMo VisualCoding **72.3**。同じ公式表の比較対象は GPT-5.6 Sol であり GPT-6.1 Sol ではない。[公式・モデルカード](https://huggingface.co/XiaomiMiMo/MiMo-V2.6-Pro-RL) |
| DeepSeek-V4.1-Flash-1017 | DeepSeek-V4.1-Flash-20261017 **Max: 1665 ± 13、暫定値**。[第三者・Arena](https://arena.ai/leaderboard/code/webdev) | **1300 Elo、22位**。[第三者・1017 モデル別ページ](https://www.designarena.ai/models/deepseek-v4-1-flash-1017) | Web / デザイン専用の定量値は **見つからず**。画像理解の Chartography / BabyVision 等は掲載されるが、Web の美的評価として転用しない。[公式・1017 モデルカード](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash-1017) |

Design Arena の列は調査日に取得できた各モデルの **Website 欄**を記録したもの。サイト全体の順位、Web Apps、画像理解の得点と混ぜていない。区間・推論強度・モデルごとのハーネス詳細は、参照したモデル別ページでは **見つからず**。したがって、Elo の小差から有意な優劣は断定しない。[第三者・Sol のページ](https://www.designarena.ai/models/gpt-6.1-sol)、[MiMo のページ](https://www.designarena.ai/models/mimo-v2.6-pro)、[DeepSeek のページ](https://www.designarena.ai/models/deepseek-v4-1-flash-1017)

## 利用者が実際に試したと述べる得意・不得意

以下は個々の報告の要約であり、一般的な勝率の推定には使わない。モデル名・入口・課題を可能な範囲で残した。

| 主要候補 | 得意だったという報告 | 苦手・失敗の報告 | 読み取れる範囲 |
|---|---|---|---|
| GPT-6.1 Sol | Brownsmith Dynamics は、Codex で短い指示から複数ページのフロントエンド変更を追跡し、既存デザインをそろえて検証まで進めたと報告。[利用者・本人の初日記録](https://brownsmithdynamics.com/blogs/gpt-6-1-sol-review-codex) | 別の投稿者は、ほぼ同じ UX 課題で旧 Sol より装飾・レイアウトが著しく乏しかったと報告。[利用者・Reddit 本人投稿](https://www.reddit.com/r/codex/comments/1xd16fg/gpt61sol_is_absolute_garbage_compared_to_gpt56sol/) | 前者は **2026-09-30** の初日評価。後者は指示全文・推論強度・生成物の再現条件が **見つからず**。異なる課題・条件の観察として扱う。[前者](https://brownsmithdynamics.com/blogs/gpt-6-1-sol-review-codex)、[後者](https://www.reddit.com/r/codex/comments/1xd16fg/gpt61sol_is_absolute_garbage_compared_to_gpt56sol/) |
| MiMo-V2.6-Pro | Goldie Bench の作者は、OpenRouter 経由の単発生成で、ブラックホール、波、群れなどのシミュレーションや視覚作品を高く評価。[利用者兼評価者・自分の生成物の記録](https://goldiebench.com/models/mimo26pro) | 同じ記録で、長いゲーム出力の不正な識別子、未初期化参照、描画不具合を報告。**50 件中18件が5点未満**。[利用者兼評価者・同じ記録](https://goldiebench.com/models/mimo26pro) | 単一 HTML・単発生成、モデル既定の推論強度、視覚判定は Opus 4.8、ゲーム課題にはスキルを利用。修復反復を含む Codex / Command Code の実用性能と同一視しない。[本人の方法](https://goldiebench.com/models/mimo26pro) |
| DeepSeek-V4.1-Flash-1017 | まさお氏は自作課題で、前版が失敗した FPS の戦闘や SVG の歩行アニメーションが改善したと報告。[利用者・本人の実行記録](https://note.com/masa_wunder/n/n0770dbbe6720) | 同じ試行では、前版で動いた図形エディタが新版ではマウス操作と Canvas を結び付けられず、操作不能になったと報告。[利用者・同じ記録](https://note.com/masa_wunder/n/n0770dbbe6720) | **2026-10-17** のブラウザ実行を伴う自作ベンチ。詳細な全実行設定は本文では **見つからず**。改善と退行の両方がある、という観察に留める。[本人の記録](https://note.com/masa_wunder/n/n0770dbbe6720) |

## 参考候補

ここでは各モデルの公開 API 仕様を短く並べる。Command Code の契約料金・利用枠・実際に配信される量子化版や推論設定は、この表からは確定しない。

| 参考モデル | 公開日 | 文脈長 / 出力上限 | 入力 / 出力料金 | 画像入力 |
|---|---|---|---|---|
| `moonshotai/kimi-k3` | **2026-07-16** は OpenRouter の掲載日付。公式資料では API 公開は **2026年7月**まで確認でき、日単位の記載は **見つからず**。[第三者・配信モデル情報](https://openrouter.ai/moonshotai/kimi-k3)、[公式・更新履歴](https://platform.kimi.ai/docs/platform-changelog) | **1,048,576** / 既定 **131,072**、指定可能上限 **1,048,576**。入力と生成上限の合計が文脈長を超えると生成上限を自動調整。[公式・文脈長](https://platform.kimi.ai/docs/pricing/chat)、[公式・生成パラメータ](https://platform.kimi.ai/docs/api/chat) | **$3 / $15**、キャッシュヒット入力 **$0.30**。[公式・発表の API 料金](https://www.kimi.ai/blog/kimi-k3) | **可**。[公式・モデルカード](https://huggingface.co/moonshotai/Kimi-K3) |
| `zai-org/glm-5.3` | **2026-08-14**。[公式・発表](https://z.ai/blog/glm-5.3) | **1M / 128K**。[公式・仕様](https://docs.z.ai/guides/llm/glm-5.3) | **$1.40 / $4.40**、キャッシュ入力 **$0.26**。[公式・料金](https://docs.z.ai/guides/overview/pricing) | **不可**（text-only）。Flash 版とは異なる。[公式・仕様](https://docs.z.ai/guides/llm/glm-5.3) |
| `qwen/qwen3.8-max` | 正式発表 **2026-08-03**。更新スナップショット **0902 / 2026-09-02** は別記。[公式・発表](https://qwen.ai/blog?id=qwen3.8)、[公式・スナップショット一覧](https://www.alibabacloud.com/help/en/model-studio/qwen3-8-max) | **1,000,000 / 131,072**。[公式・仕様](https://www.alibabacloud.com/help/en/model-studio/qwen3-8-max) | **$2 / $6**（Singapore / International）、暗黙キャッシュ入力 **$0.25**。リージョン・Scope で価格が異なる。[公式・料金](https://www.alibabacloud.com/help/en/model-studio/qwen3-8-max) | **可**（公開 API の仕様）。[公式・仕様](https://www.alibabacloud.com/help/en/model-studio/qwen3-8-max) |

| 参考モデル | SWE-bench Verified / Pro | Terminal-Bench | WebDev Arena / 利用者の観察 |
|---|---|---|---|
| Kimi K3 | Verified **93.40%**（Vals、mini-swe-agent）。Pro **V2 Full 97.70 ± 0.90**（Scale、mini-swe-agent、max）。[第三者・Vals](https://www.vals.ai/benchmarks/swebench)、[第三者・Scale](https://labs.scale.com/leaderboard/swe_bench_pro_public_v2?tab=full) | **2.1: 88.3**（公式、Kimi Code、max）、**4.0: 17.17%**（第三者、Mini-SWE-agent）。[公式・カードと脚注](https://huggingface.co/moonshotai/Kimi-K3)、[第三者・Vals](https://www.vals.ai/benchmarks/terminal-bench-4) | **Max 1655 ± 6**。[第三者・WebDev Arena](https://arena.ai/leaderboard/code/webdev) 利用者の単一 HTML 試行では、大きな文字と編集的な構成・雰囲気を評価する一方、完成した商用サイトよりブランドの作品集に近いと評する。[利用者・fomoxx の Kimi K3 Web Max 試行](https://fomoxx.com/en/posts/ai-frontend-design-experiments/) |
| GLM-5.3 | Verified **95.40%**（Vals、mini-swe-agent）。Pro **V2 Full 95.60 ± 1.30**（Scale、mini-swe-agent、max）。[第三者・Vals](https://www.vals.ai/benchmarks/swebench)、[第三者・Scale](https://labs.scale.com/leaderboard/swe_bench_pro_public_v2?tab=full) | **2.1: 88.2**（公式、Claude Code、max）、**4.0: 38.89%**（第三者、Mini-SWE-agent）。[公式・発表と脚注](https://z.ai/blog/glm-5.3)、[第三者・Vals](https://www.vals.ai/benchmarks/terminal-bench-4) | **Max 1623 ± 7**。[第三者・WebDev Arena](https://arena.ai/leaderboard/code/webdev) 同じ利用者の ZCode Max 試行では、文字組み・店舗のイラスト・仕上がりを評価するが、固有のデザイン上の個性は弱いとする。[利用者・fomoxx の GLM-5.3 行](https://fomoxx.com/en/posts/ai-frontend-design-experiments/) |
| Qwen3.8-Max | Verified **85.60%**（Vals、Mini-SWE-agent）。公式発表の Pro は **67.7**、版の記載は **見つからず**。**V2 Full の掲載は見つからず**。[第三者・Vals](https://www.vals.ai/benchmarks/swebench)、[公式・発表](https://qwen.ai/blog?id=qwen3.8)、[第三者・Scale V2 Full](https://labs.scale.com/leaderboard/swe_bench_pro_public_v2?tab=full) | **2.1: 86.6**（公式、ハーネス条件は今回確認できた本文では **見つからず**）。**4.0: 34.34%**、**0902: 38.89%**（第三者、Mini-SWE-agent）。[公式・発表](https://qwen.ai/blog?id=qwen3.8)、[第三者・Vals](https://www.vals.ai/benchmarks/terminal-bench-4) | 初期版 **1672 ± 12**、**0902: 1673 ± 7**、いずれも **暫定値**。[第三者・WebDev Arena](https://arena.ai/leaderboard/code/webdev) 正式版を日常作業に使った本人は、指示追従・長文脈を好意的に報告しつつ、比較モデルとの差は短期利用では分からなかったとする。再現可能な Web デザインの得意・不得意の本人報告は **見つからず**。[利用者・アライ氏の記録](https://note.com/ai_arai_ally/n/nd2d754ffa214) |

Kimi と GLM の利用者比較は、同一の題材を用いた単一 HTML の試行だが、ハーネスをそろえたモデル単体の比較ではないと作者自身が明記する。Qwen の初期プレビューを試したレビューを正式版・0902 の実測として扱わない。[利用者・fomoxx の方法と限界](https://fomoxx.com/en/posts/ai-frontend-design-experiments/)、[利用者・プレビューであると明記した Wiegold 氏のレビュー](https://thomas-wiegold.com/blog/qwen-3-8-max-review/)

Kimi K3 については公式も、過去の推論履歴を返さないハーネスや会話途中のモデル切替で品質が不安定になること、曖昧な指示に対して利用者の代わりに過度な判断をすることを限界として挙げる。入口の対応状況は採用前に確認する必要がある、という示唆になる。[公式・Limitations](https://www.kimi.com/en/blog/kimi-k3)

## 旧 DeepSeek V4 Pro の参考情報

旧候補の V4 Pro は、プレビュー **2026-04-24**、正式 API 版 **2026-08-13 / 0813**。現行直販仕様は **1M 文脈・384K 出力・画像入力不可**、ピーク **$1.32 / $3.96**、オフピーク **$0.66 / $1.98**。V4.1 Flash 1017 の仕様・評価と入れ替えない。[公式・更新履歴](https://api-docs.deepseek.com/updates/)、[公式・現行料金と仕様](https://api-docs.deepseek.com/quick_start/pricing)

## このプロジェクト（色を主役にした、ビジュアル・アート寄りの Web 実装）への示唆

- **推論:** 公開 WebDev 評価では主要候補中 Sol の値が高く、実装の比較基準に置く根拠がある。ただし推論強度と入口を記録する。[第三者・原表](https://arena.ai/leaderboard/code/webdev)
- **推論:** MiMo は視覚作品の案出しと試作の候補になる。利用者が描画失敗も報告しているため、生成された画面と操作を実行して採否を決める。[利用者・生成物の記録](https://goldiebench.com/models/mimo26pro)
- **推論:** DeepSeek 1017 は画像入力に対応し、直販単価も低いので、画面を見せて修正を繰り返す候補になる。利用者が報告する操作不能の退行も受け入れ課題に含める。[公式仕様](https://api-docs.deepseek.com/quick_start/pricing)、[利用者報告](https://note.com/masa_wunder/n/n0770dbbe6720)
- **推論:** 参考候補では Kimi / Qwen の画像入力を試せる一方、GLM-5.3 単体には画像入力を前提にした役割を割り当てられない。[Kimi 公式](https://huggingface.co/moonshotai/Kimi-K3)、[Qwen 公式](https://www.alibabacloud.com/help/en/model-studio/qwen3-8-max)、[GLM 公式](https://docs.z.ai/guides/llm/glm-5.3)
- **推論:** 色の魅力・独自性・操作感の最終判断には、このプロジェクトと同じ課題で成果物を比較する必要がある。一般コーディングの解決率と、条件付きのデザイン観察は別の証拠だからである。[Vals の評価方法](https://www.vals.ai/benchmarks/terminal-bench-4)、[利用者のデザイン比較と限界](https://fomoxx.com/en/posts/ai-frontend-design-experiments/)
