---
description: Open the Zerg agent-team editor (the visual agent pane)
allowed-tools: Bash(node REPO_PATH/bin/team.mjs *) mcp__Claude_Browser__preview_start mcp__ccd_session_mgmt__set_session_title
---
Open the visual agent-team editor.

0. Naming (Claude desktop app only): if this session's title is "/zerg" or starts with "/zerg" (the app named the chat after the command), rename it with `mcp__ccd_session_mgmt__set_session_title` (session_id "self", load it with ToolSearch if deferred). If the user passed arguments (`$ARGUMENTS`), title it from them in under 6 words; otherwise use "Agent team design". Skip this step if the tool is unavailable. Leave any other title alone. When the user later states the real task in this chat, retitle once more to describe it.

1. Every /zerg is a blank slate with its own private editor, even if other Claude sessions are running theirs. Never reuse or attach to an existing editor and do not ping port 4317.
2. Start a new server: run `node REPO_PATH/bin/team.mjs serve --port 0` with the Bash tool using run_in_background: true. Port 0 picks a free port, so each session gets its own address (and so its own browser storage). Read its first output line; it is the URL, for example http://127.0.0.1:53211/.
3. Open that URL with `?new=1` appended (for example http://127.0.0.1:53211/?new=1) in the built-in browser pane with preview_start, passing `url`. The flag makes the editor start empty. Say which URL you opened.
3b. The Browser pane can stay hidden even after preview_start succeeds. If `mcp__ccd_view__show_pane` is available (load it with ToolSearch if deferred), call it with pane "preview" so the editor is actually visible.
4. If preview_start is unavailable or fails (for example in a plain terminal session), say so plainly and print the URL with `?new=1` so the user can open it in any browser.
5. Remind the user: this editor is private to this session; "Save to Claude" stores a team under ~/.claude/agent-teams/ where every session can load it with `/teams:load` or `/teams:run <team> <task>`.
