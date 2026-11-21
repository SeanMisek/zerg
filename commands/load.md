---
description: Pick a saved agent team from a list and run it on a task
argument-hint: [task...]
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/bin/team.mjs *) Agent AskUserQuestion
---
Task given (may be empty): $ARGUMENTS

1. Run exactly `node ${CLAUDE_PLUGIN_ROOT}/bin/team.mjs list --json` with the Bash tool. If it fails with an unknown-option error, run `node ${CLAUDE_PLUGIN_ROOT}/bin/team.mjs list` instead (tab-separated: name, title, nodes, edges; sort by name, no scope label). Put no user text in any shell command.
2. `--json` rows are already newest first (name, title, description, nodes, edges, scope, modified); keep that order. A project team shadows a global one of the same name, so the list has no duplicates. If there are no teams, say so, offer /teams:edit and /teams:new, and stop.
3. Ask with AskUserQuestion, one question "Which team?". Options are at most 4: the next 3 teams of the ordered list plus, only if more remain, "More teams..." as the 4th. Option label = team name; description = "<scope> · N agents, M edges" with scope project or global (e.g. "project · 4 agents, 3 edges"), then the title after it when it fits. If the user picks "More teams...", ask again with the following 3 teams (plus "More teams..." while any remain). A user's own "Other" answer naming a team is also accepted.
4. If the arguments are empty, ask for the task in one short plain question and wait for the free-text reply.
5. Check the chosen name matches `^[a-z0-9][a-z0-9-]{0,62}$`; otherwise stop and print `COMPILE FAILED: invalid team name`. Run `node ${CLAUDE_PLUGIN_ROOT}/bin/team.mjs compile '<name>'` with the name in single quotes.
6. If it exits non-zero or prints an error, stop, print `COMPILE FAILED: <error text>`, spawn nothing. Otherwise execute the brief exactly as written: spawn every agent in the Roster with the Agent tool, passing its instructions verbatim plus its edge protocols; never spawn a head node (the main session acts as the head agent); respect edge direction, kind, order, parallelism and the review-round limit. The Task is the task text from step 1/4 (the brief's Task section is a placeholder). Report what each agent concluded.
