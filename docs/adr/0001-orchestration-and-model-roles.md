# ADR-0001: オーケストレーションとモデルの役割分担

- 状態: 提案（モデル調査と試走の結果で確定する）
- 日付: 2026-10-27

## 文脈

- 利用者は Claude の使用量を抑えたい。そのため実装は Orca を通して他のモデルに振ってよい、と指示している。使ってよいと名前が挙がったモデルは、Codex の `gpt-6.1-sol`（推論の強さ xhigh か max）と、dsh（Command Code 経由）の `xiaomi/mimo-v2.6-pro` と `deepseek/deepseek-v4.1-flash`。
- 調査（imozuru）は Claude のサブエージェントで行ってよい、と利用者が指示している。
- 設計と品質保証の責任はメイン（Claude）が持つ。
- 手元で確かめた事実（2026-10-27）:
  - Orca 1.4.240。`orchestration worker-start` は `--agent codex --model <id> --effort <level>` を受け付ける。
  - Codex のモデル一覧に `gpt-6.1-sol` があり、推論の強さは low〜ultra を選べる。
  - dsh は Orca から `--model` を渡せない。起動時のモデルは `~/.dsh-tui/model.json` で決まる。そのため、起動の直前に model.json を書き換え、起動後に画面下のモデル名で確かめる。
  - dsh で使う DeepSeek は `deepseek/deepseek-v4.1-flash`（利用者の指定。公式の latest が 1017 版であることを利用者が確認済み）。MiMo は `xiaomi/mimo-v2.6-pro`。
  - Orca から dsh を起動すると、プロンプトが入力欄に入ったまま送信されないことがある（2回とも起きた）。起動後に `orca terminal send --terminal <handle> --enter` で送信する。
  - Codex CLI の更新案内（`agent-update-prompt`）が出ると、Orca からの起動が止まる。`~/.codex/version.json` の `dismissed_version` を最新版にすると出なくなる（案内で「スキップ」を選ぶのと同じ）。
  - dsh-tui の headless 実行（`dsh-tui run`）は手元で失敗した（`TASK_FAILED: DSH exited unsuccessfully (1)`）。Orca の TUI 経由で使う。

## 決定（案）

| 役割 | 担当 | 備考 |
|---|---|---|
| 設計・ADR・タスク分解・レビュー・受け入れ・コミット | メイン（Claude Opus） | 大きな実装は自分でしない |
| 調査（imozuru） | Claude のサブエージェント（親は Sonnet） | 原文は `~/research/<話題>/` |
| 実装 | Orca のワーカー（Codex gpt-6.1-sol / dsh MiMo V2.6 Pro / dsh DeepSeek V4.1 Flash） | どの種類の仕事をどれに振るかは試走で決める |

- タスクは Orca の Run・Task・Dispatch で管理し、仕様には Target・Change・Constraints・Ownership・Observable acceptance を必ず書く。
- ワーカーの `worker_done` を受けたら、メインが差分と実物（スクリーンショット、テスト結果）を見てから受け入れる。報告の文面だけで受け入れない。

## 理由

- 使用量を分散しつつ、判断と品質の責任を1か所に置くため。
- 実装を任せる先は、ベンチマークの数字より、このプロジェクトに近い課題での実際の出来で選ぶほうが確か。そのため `experiments/model-probe/` で同じ課題を解かせて比べる。

## 結果

- 良い点: Claude の使用量が設計とレビューに集中する。モデルごとの得意・不得意が記録に残る。
- 悪い点: 受け渡しの手間と、仕様の書き漏れによる手戻りが増える。メインのレビューが品質のボトルネックになる。
- 見直す条件: 試走の結果が出たとき。あるモデルの差し戻しが続いたとき。

## 検討した他の案

- すべて Claude で実装する: 使用量の制約に反する。
- モデルを固定せず毎回選ぶ: 比べる根拠が残らない。
