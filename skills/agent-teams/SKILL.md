---
name: agent-teams
description: Design, draft, modify and save agent teams (graphs of subagents with described edges) for Agent Team Studio. Use when the user says "make me an agent team for X", "design the agents for Y", "add a reviewer to my team", or asks to edit a saved team in plain language.
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/bin/team.mjs *) Read
---
# Designing agent teams

A team is a JSON graph. The `teams` plugin compiles it into an orchestration brief (`/teams:run`) or into `.claude/agents/*.md` files (`/teams:agents`).

## Schema cheat sheet
Team file `<store>/teams/<slug>.json`:
```json
{"version":1,"name":"review-loop","title":"Implement and review","description":"What it is for",
 "settings":{"maxReviewRounds":2,"parallel":true},
 "nodes":[{"id":"n1","name":"Architect","role":"Plans the change","description":"Markdown system prompt",
   "model":"inherit","tools":["Read","Grep","Glob"],"isLead":true,"profile":"architect","x":120,"y":80}],
 "edges":[{"id":"e1","from":"n1","to":"n2","kind":"delegate","label":"plan","description":"Exact protocol"}]}
```
- `name` is a slug `[a-z0-9][a-z0-9-]{0,62}` and equals the file name. Node ids unique (`n1`, `n2`...), edge ids unique.
- `model`: inherit | opus | sonnet | haiku. `tools`: null (inherit all) or a string array. At most one `isLead: true`; none means the main session leads.
- Edge `kind`: `delegate` (from assigns, waits), `handoff` (pipeline: output becomes input), `review` (from critiques `to`'s work, `to` revises, at most `maxReviewRounds`), `consult` (from may ask `to`), `debate` (two-way, lead breaks ties). `label` max 24 chars. Optional edge `polarity`: "positive" (arrow, default) or "negative" (inhibitor bar). Optional node `isHead: true` (at most one, never together with `isLead`): the head node is the MAIN SESSION, the agent the user talks to. `x`,`y` are layout only; space nodes about 240 px apart.

## Good graph design
- Few nodes: 2 to 6. Add a node only for a distinct role, tool set or context. Prefer one strong agent over three vague ones.
- Exactly one lead. Everyone else is reachable from it.
- Every edge description states the protocol: what is passed, in what form, what the receiver must not do, when it is done.
- Bound every loop: any `review` or `debate` cycle relies on `maxReviewRounds` (1 to 3).
- Least privilege: reviewers and researchers get read-only tools (Read, Grep, Glob, WebSearch); only implementers get Edit, Write, Bash. Use haiku for cheap lookup roles, opus for planning or hard review.
- Node `description` is the agent's system prompt: goal, inputs, output format, boundaries. Write it so it works without the rest of the graph.
- Reuse starter profiles (architect, implementer, reviewer, tester, researcher, pm, critic) via `profile`; list them with `list --profiles`.

## Polarity and the head node
- `polarity` is illustration only. It is drawn in the editor and never affects compiled output or agent behavior. Never rely on it to say how agents interact; put that in the edge `kind` and `description`.
- Add a head node (`isHead: true`) when the user wants to show what they do themselves (e.g. "I approve the plan"). It is not spawned, needs no model or tools, and should have outgoing edges. Spawned agents go in the roster only.

## Save and check
CLI: `node ${CLAUDE_PLUGIN_ROOT}/bin/team.mjs <cmd>` with `list`, `list --profiles`, `show <name>`, `validate <name|file.json>`, `compile <name|file.json> [--prompt "..."] [--format brief|agents]`.
1. Save with `team.mjs save - <<'JSON' ... JSON` (stdin; add `--project` for project scope, `--profile` for a profile). It validates first and refuses invalid teams; fix the reported problems and save again. Do not copy files into the store by hand.
2. `validate <file.json>` checks a draft without saving. If `serve` is running, `PUT /api/teams/<slug>` with header `X-Team-Studio: 1` also works.
3. Confirm with `show <slug>`, then offer `/teams:edit <slug>` and `/teams:run <slug> <task>`.
To modify a team: `show <slug>`, change the JSON, validate, save over the same name.

To apply a saved team without typing its name, the user can run `/teams:load [task]`, which lists teams and runs the chosen one.
