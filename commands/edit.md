---
description: Open the Agent Team Studio visual editor
argument-hint: [team]
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/bin/team.mjs *) Bash(curl -s http://127.0.0.1:4317/api/ping) mcp__Claude_Browser__preview_start
---
Open the visual team editor. Optional team: $ARGUMENTS

1. Run `curl -s http://127.0.0.1:4317/api/ping`. Only if the reply is JSON with `"ok":true` and `"version":1` is a studio already running; use http://127.0.0.1:4317/ and say you attached to that existing instance. Anything else (no reply, other JSON, HTML) means start a new one.
2. To start one, run `node ${CLAUDE_PLUGIN_ROOT}/bin/team.mjs serve --port 4317` with the Bash tool using run_in_background: true. Read its first output line; it is the URL. If that fails because the port is taken by something that is not a studio, retry with `--port 4318` and use the URL it prints.
3. Open the URL in the built-in browser pane with preview_start, passing `url`. State which URL you opened and whether it was new or existing.
4. If preview_start is unavailable or fails, say so plainly and print the URL.
5. Tell the user "Save to Claude" writes to ~/.claude/agent-teams/ and /teams:run <name> <task> applies a team.
