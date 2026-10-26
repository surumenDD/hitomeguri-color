# 呼び出せるツールと能力（この実行時点）
- Web 検索: 可（web__run / mcp__codex_apps__search_service_web_run）。URL 取得: 可（同ツール、HTTP クライアント）。
- ブラウザ操作: 可（Playwright / cua_repl）。画像の読み取り: 可（view_image / スクリーンショット）。
- 直接公開: `functions.exec`, `functions.wait`, `functions.request_user_input_async`, `clock.sleep`, `collaboration.followup_task`, `collaboration.interrupt_agent`, `collaboration.list_agents`, `collaboration.send_message`, `collaboration.spawn_agent`, `collaboration.wait_agent`, `mcp__cua_repl.js`, `mcp__cua_repl.js_reset`
- 基盤: `apply_patch`, `clock__curr_time`, `create_goal`, `exec_command`, `get_goal`, `image_gen__imagegen`, `list_mcp_resource_templates`, `list_mcp_resources`, `read_mcp_resource`, `update_goal`, `view_image`, `web__run`, `write_stdin`
- ほかに、接続したアプリと MCP のツールが使えた（一覧は公開の前に省いた）。
- 一覧は公開名で記録。権限・実行モードによる制約は別に適用される。今回は Web 検索・外部 URL 取得・Apps への書き込みは未使用。
