---
description: Write a team's agents as real .claude/agents subagent files
argument-hint: <team>
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/bin/team.mjs *)
---
Team: $ARGUMENTS

1. Check the name matches `^[a-z0-9][a-z0-9-]{0,62}$`. If not, stop and print `FAILED: invalid team name`. Never put any other text into a shell command.
2. Run with the Bash tool: `node ${CLAUDE_PLUGIN_ROOT}/bin/team.mjs compile '<name>' --format agents`
3. A head node (the main session) must get no agent file; if one was written for it, tell the user it is a CLI bug and delete nothing yourself.
4. On a non-zero exit, print `FAILED: <error text>` and stop. Otherwise list the files written and tell the user to run /agents or restart the session to pick them up.
