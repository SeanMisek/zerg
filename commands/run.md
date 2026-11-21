---
description: Apply a saved agent team to a task and run it
argument-hint: <team> <task...>
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/bin/team.mjs *) Agent
---
Arguments: $ARGUMENTS

The first word is the team name; everything after it is the task.

1. Check the team name matches the regex `^[a-z0-9][a-z0-9-]{0,62}$`. If it does not, stop and print `COMPILE FAILED: invalid team name`. Never put any other text into a shell command.
2. Run exactly this with the Bash tool, with the name in single quotes: `node ${CLAUDE_PLUGIN_ROOT}/bin/team.mjs compile '<name>'`
3. If it exits non-zero or prints an error, stop. Print `COMPILE FAILED: <the error text>`, do not spawn any agent, and offer `/teams:list`.
4. Otherwise execute the compiled brief exactly as written. Spawn every agent in the Roster (never spawn a head node: the main session acts as the head agent, following its standing instructions) with the Agent tool, passing its instructions verbatim plus its edge protocols. Respect edge direction, kind, execution order, parallelism and the review-round limit. The Task is the text after the team name in the arguments (the brief's Task section is a placeholder). Finish by reporting what each agent concluded.
