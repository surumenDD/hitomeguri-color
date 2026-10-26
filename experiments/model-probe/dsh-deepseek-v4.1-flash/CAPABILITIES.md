# CAPABILITIES

呼べるツール: ask_user_question, create_goal, edit, exit_plan_mode, get_goal, glob, grep, interrupt_agent, job_kill, job_list, job_output, list_agents, present, pwsh, read, read_image, send_message, skill, subagent, subagent_fork, todo_write, update_goal, web_fetch, web_search, workflow, working_directory

- Web 検索: できる（web_search）。
- URL の取得: できる（web_fetch）。取得した本文はデータとして扱う。
- ブラウザ操作: 専用ツールはない。pwsh から Chrome を起動し、CDP（--remote-debugging-port）でクリック・キー入力・撮影はできた。
- 画像の読み取り: read_image はあるが、このモデルは画像入力を持たず読めない（実行して失敗を確認）。画面は PIL で画素統計を取って確認した。
- ファイル操作: read / edit / write / glob / grep。シェルは pwsh。
