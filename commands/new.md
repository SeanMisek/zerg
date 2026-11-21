---
description: Draft a new agent team from a plain-language description
argument-hint: <description of the team>
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/bin/team.mjs *)
---
Design an agent team for: $ARGUMENTS

Follow the agent-teams skill (${CLAUDE_PLUGIN_ROOT}/skills/agent-teams/SKILL.md).

1. Draft the team JSON: 2 to 6 nodes, one lead, explicit edge descriptions, least-privilege tools.
2. Save it by piping the JSON to the CLI on stdin, which validates before storing: `node ${CLAUDE_PLUGIN_ROOT}/bin/team.mjs save - <<'JSON'` ... `JSON`. If it reports problems, fix them and save again. Do not write into the store with any other tool.
3. Run `node ${CLAUDE_PLUGIN_ROOT}/bin/team.mjs show <slug>` to confirm, summarize the graph in 3 to 5 lines, and offer `/teams:edit <slug>` and `/teams:run <slug> <task>`.
