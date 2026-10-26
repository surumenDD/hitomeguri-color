# ADR-0001: オーケストレーションとモデルの役割分担

- 状態: 承認（モデル調査と試走の結果を受けて確定。試走は各モデル1回なので、本番タスクの結果で見直す）
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
  - Orca から dsh を起動すると、プロンプトが入力欄に入ったまま送信されないことがある（2回とも起きた）。起動後に `orca terminal send --terminal <handle> --enter` で送信する。読み込み中（画面下に「Checking…」が出ている間）の Enter は効かないので、モデル名の行に `Full access` が出てから送り、画面で送信されたことを確かめる。
  - Codex CLI の更新案内（`agent-update-prompt`）が出ると、Orca からの起動が止まる。`~/.codex/version.json` の `dismissed_version` を最新版にすると出なくなる（案内で「スキップ」を選ぶのと同じ）。
  - dsh-tui の headless 実行（`dsh-tui run`）は手元で失敗した（`TASK_FAILED: DSH exited unsuccessfully (1)`）。Orca の TUI 経由で使う。
- 試走（`experiments/model-probe/RESULTS.md`）:
  - 3モデルとも、色の計算の正しさ・60fps・reduced motion・点滅なしの要件を満たした。
  - 見た目の仕上がりは Codex が明らかに上。MiMo は灰色がかった低彩度、DeepSeek は塊の境目が灰色に濁った。
  - 自分で画面を見て直せたのは Codex だけ。dsh の2モデルは、公式には画像入力に対応している（`docs/research/model-survey.md`）が、dsh 経由では画像を読めなかった。
- モデル調査（`docs/research/model-survey.md`）: 100万トークンあたりの料金（入力/出力）は Sol が $2/$10、MiMo が $0.435/$0.87、DeepSeek が $0.30/$1.20（いずれも公式）。

## 決定

| 役割 | 担当 | 備考 |
|---|---|---|
| 設計・ADR・タスク分解・レビュー・受け入れ・コミット | メイン（Claude Opus） | 大きな実装は自分でしない。見た目の最終判断もメイン |
| 調査（imozuru） | Claude のサブエージェント（親は Sonnet） | 原文は `~/research/<話題>/` |
| 見た目の質が問われる実装（作品の画面、シェーダー、色と動きの設計の実装） | Codex `gpt-6.1-sol`、推論は xhigh | 自分でスクリーンショットを見て直せる |
| 見た目の判断を伴わない実装（色の計算のライブラリ、テスト、データ処理、ツール、リファクタリング） | dsh `xiaomi/mimo-v2.6-pro` か `deepseek/deepseek-v4.1-flash` | 安い。見た目の確認はメインが `tools/visual-qa` で引き受ける |
| 案出しの発散 | 3モデルを並べる | 好みの違いをそのまま材料にする |

- タスクは Orca の Run・Task・Dispatch で管理し、仕様には Target・Change・Constraints・Ownership・Observable acceptance を必ず書く。
- 仕様には次の2点も入れる。「起動したサーバーやバックグラウンドの処理は止めてから完了報告する」「作業ツリーに範囲外のファイルができたら消さずに報告する」。
- ワーカーの `worker_done` を受けたら、メインが差分と実物（`tools/visual-qa` の結果、スクリーンショット、テスト結果）を見てから受け入れる。報告の文面だけで受け入れない。
- 1つの Task が見た目と見た目以外の両方を含むときは、Task を分ける。

## 理由

- 使用量を分散しつつ、判断と品質の責任を1か所に置くため。
- 実装を任せる先は、ベンチマークの数字より、このプロジェクトに近い課題での実際の出来で選ぶほうが確か。試走で差が大きかったのは見た目と自己確認の能力で、計算の正しさには差が無かった。そこで、見た目の仕事だけを高い Codex に寄せ、それ以外を安い dsh に回す。

## 結果

- 良い点: Claude の使用量が設計とレビューに集中する。モデルごとの得意・不得意が記録に残る。
- 悪い点: 受け渡しの手間と、仕様の書き漏れによる手戻りが増える。メインのレビューが品質のボトルネックになる。
- 見直す条件: あるモデルの差し戻しが続いたとき。dsh で画像入力が使えるようになったとき（MiMo の見た目の仕事を再試験する）。Codex の使用量が上限に近づいたとき。

## 検討した他の案

- すべて Claude で実装する: 使用量の制約に反する。
- モデルを固定せず毎回選ぶ: 比べる根拠が残らない。
