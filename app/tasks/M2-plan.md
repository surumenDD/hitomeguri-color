# M2 の Task 分割

受け手は次の実装者と、受け入れを判断するメイン。持ち場はこのワークツリーの app/。

| Task                   | 持ち場                                    | 担当         | 受け入れ                                |
| ---------------------- | ----------------------------------------- | ------------ | --------------------------------------- |
| 台本 v4→v4.1 と凍結    | src/script/index.ts、fixtures/v4、v4.test | adviser      | 3プリセット・標準と端で誤差0            |
| 色と位置の島・curation | palette/islands、render                   | adviser      | 非負・総和1、矩形・半平面、元色で再現   |
| 点滅解析の移植         | safety/flash とテスト、fixtures/flash     | dsh DeepSeek | node 合成15条件と全フィールド一致       |
| 帯のデータ             | script/strip とテスト                     | dsh MiMo     | 正本の選択・時刻・CSS割合と一致、11条件 |
| 編集見積もりと書き出し | safety/estimate/client/worker、export     | adviser      | 式の検査→実描画判定→H.264、120条件      |
| 操作の結合・外枠       | state、App、ui、styles                    | adviser      | 指定モック・追記の状態設計と照合        |
| 検査・報告             | test/、reports/、README                   | adviser      | check・本番ビルド・画面写真・測定       |

dsh の仕様は [点滅解析](M2-flash.txt) と [帯](M2-strip.txt)。API・正本・固定入力・完全一致の許容差・ファイルの持ち場を先に決め、親が原文と実装を読み直し、単体テストを再実行してから結合した。結合部分と、途中でメインの設計が動いた部分は adviser が持った。
