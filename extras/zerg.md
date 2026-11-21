---
description: Open the Zerg agent-team editor (the visual agent pane)
allowed-tools: Bash(node REPO_PATH/bin/team.mjs *) Bash(curl -s http://127.0.0.1:4317/api/ping) mcp__Claude_Browser__preview_start
---
Open the visual agent-team editor.

1. Run `curl -s http://127.0.0.1:4317/api/ping`. Only if the reply is JSON with `"ok":true` and `"version":1` is an editor already running: use http://127.0.0.1:4317/ and say you attached to the existing one. Anything else (no reply, other JSON, HTML) means start a new one.
2. To start one, run `node REPO_PATH/bin/team.mjs serve --port 4317` with the Bash tool using run_in_background: true. Read its first output line; it is the URL. If that fails because the port is held by something that is not the editor, retry with `--port 4318` and use the URL it prints.
3. Open the URL in the built-in browser pane with preview_start, passing `url`. Say which URL you opened and whether it was new or existing.
4. If preview_start is unavailable or fails (for example in a plain terminal session), say so plainly and print the URL so the user can open it in any browser.
5. Remind the user: "Save to Claude" stores the team under ~/.claude/agent-teams/, and `/teams:run <team> <task>` or `/teams:load` applies one.
