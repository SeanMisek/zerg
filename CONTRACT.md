# Agent Team Studio: shared contract (v1)

Goal: a visual editor where the user places agent nodes, connects them with described edges, saves
agent profiles and whole-team templates, and applies a saved team to a prompt in Claude Code /
Claude desktop with one command.

The whole repo folder is ONE Claude Code plugin named `teams`. Three workstreams own disjoint files.
Do not edit files you do not own; if you need a change in someone else's area, write it to
`NEEDS.md` (append a line: who, what, why) and carry on with a stub.

```
agent_team_studio/
  .claude-plugin/plugin.json        [C]
  commands/*.md                     [C]  slash commands
  skills/agent-teams/SKILL.md       [C]  lets Claude author/modify team JSON from plain language
  .claude/launch.json               [C]  preview_start config "team-studio"
  README.md                         [C]
  bin/team.mjs                      [B]  CLI
  lib/{store,compile,validate}.mjs  [B]  pure ESM, node >= 20, ZERO npm dependencies
  server/server.mjs                 [B]  static + JSON API
  schema/team.schema.json           [B]
  examples/teams/*.json             [B]  starter templates (seeded into the store on first run)
  examples/profiles/*.json          [B]  starter profiles (architect, implementer, reviewer, tester, researcher, pm, critic)
  test/*.test.mjs                   [B]  node:test
  editor/index.html                 [A]  SINGLE self-contained file: inline CSS + JS, no CDN, no build
  NEEDS.md                          shared, append-only
```

## Data model

Team file `<store>/teams/<slug>.json`:
```json
{
  "version": 1,
  "name": "review-loop",                // slug, [a-z0-9][a-z0-9-]{0,62}, equals the file name
  "title": "Implement and review loop",  // free text
  "description": "What this team is for",
  "settings": { "maxReviewRounds": 2, "parallel": true },
  "nodes": [
    { "id": "n1", "name": "Architect", "role": "Plans the change",
      "description": "Markdown instructions: the agent's system prompt.",
      "model": "inherit",               // inherit | opus | sonnet | haiku
      "tools": null,                    // null = inherit all, else string[] e.g. ["Read","Grep","Glob"]
      "isLead": false,                  // at most one true; none = the main session leads
      "profile": "architect",           // optional: slug of origin profile
      "x": 120, "y": 80 }               // canvas position, layout only
  ],
  "edges": [
    { "id": "e1", "from": "n1", "to": "n2",
      "kind": "delegate",               // delegate | handoff | review | consult | debate
      "label": "plan",                  // optional, <= 24 chars, drawn on the canvas
      "description": "Architect gives Implementer a numbered plan; Implementer must not start before it." }
  ]
}
```
Edge semantics (the compiler states these to the model):
- `delegate`: from assigns work to `to`, waits for the result.
- `handoff`: from finishes, then passes its output to `to` as input (pipeline step).
- `review`: from reviews `to`'s output and returns concrete feedback; `to` revises; at most `settings.maxReviewRounds` rounds.
- `consult`: from may ask `to` questions (one-way ask, answer returns).
- `debate`: two-way; both state a position, then reconcile; lead decides ties.

Profile file `<store>/profiles/<slug>.json`: a node object WITHOUT `id`, `x`, `y`, `isLead`, plus
`{"version":1,"slug":"architect"}`. Spawning a profile on the canvas creates a node with a fresh id.

## Store

Root: `$TEAMS_HOME`, default `~/.claude/agent-teams/`, subdirs `teams/` and `profiles/`.
Read order for a team or profile name: `./.claude/agent-teams/` (project) then the global root.
Writes go to the global root unless `--project` / `?scope=project`.
On first run with an empty store, seed from `examples/`. Writes are atomic (temp + rename).

## CLI (`node ${CLAUDE_PLUGIN_ROOT}/bin/team.mjs ...`) [B implements, C calls]

- `list` : one line per team: `name<TAB>title<TAB>nodes<TAB>edges`. `list --profiles` for profiles.
- `show <name>` : the JSON.
- `compile <name|path.json> [--prompt "text"] [--format brief|agents]` :
  - `brief` (default): prints the orchestration brief (Markdown) to stdout. If `--prompt` is given it is
    substituted as the Task section, otherwise the Task section says the user's request follows.
  - `agents`: writes `.claude/agents/<team>-<node-slug>.md` into the cwd (frontmatter `name`,
    `description`, `tools` omitted when null, `model` omitted when inherit; body = instructions plus that
    node's edges) and prints the paths written.
- `validate <name|path.json>` : exit 1 with readable messages on problems.
- `serve [--port 4317] [--open] [--home DIR]` : starts the server; prints `http://127.0.0.1:<port>/` on the
  first line of stdout and nothing else before it.
- Exit codes: 0 ok, 1 user error (bad name, invalid team), 2 internal. Errors go to stderr.

### Brief format (what the model receives)
Sections in this order, all Markdown:
1. `# Team: <title>` + description
2. `## How to run this team`: the main session is the lead (or the node with isLead); spawn each node with
   the Agent tool, passing that node's instructions verbatim plus the relevant edge protocols; follow edge
   direction and kind; run independent nodes in parallel when `settings.parallel`; for `review` and
   `debate` loops stop after `maxReviewRounds`; report back what each agent concluded.
3. `## Roster`: one subsection per node: name, role, model, tools, instructions.
4. `## Interactions`: one bullet per edge, `**From → To** (kind): description`, plus a suggested
   execution order from a topological sort (cycles collapsed and flagged as loops).
5. `## Task`: the prompt.
The brief must be deterministic (same input, same bytes) and stay readable for 12 nodes.

## HTTP API [B implements, A calls]

Server binds 127.0.0.1 only. Every non-GET request must carry header `X-Team-Studio: 1` and a `Host`
of `127.0.0.1:<port>` or `localhost:<port>` (blocks drive-by writes from other websites and DNS
rebinding); otherwise 403. JSON in and out, errors are `{ "error": "message" }`.

- `GET /` : `editor/index.html`
- `GET /api/ping` : `{ "ok": true, "version": 1, "home": "<store root>" }`
- `GET /api/teams` : `[{ name, title, description, nodes, edges, scope }]`
- `GET /api/teams/:name` / `PUT /api/teams/:name` (body = team, validated) / `DELETE /api/teams/:name`
- `GET /api/profiles` : full profile objects. `GET|PUT|DELETE /api/profiles/:slug`
- `POST /api/compile` : body `{ team, prompt? }` returns `text/markdown` (live preview of the brief)
- `POST /api/validate` : body = team, returns `{ ok, problems: [{level, message, nodeId?, edgeId?}] }`

## Editor requirements [A]

Canvas (pan, wheel zoom, drag nodes, snap optional), connect by dragging from a node's output port to another
node, edges drawn as SVG curves with arrowheads and their `label`. Inspector panel for the selected node
(name, role, description textarea, model, tools chips, lead toggle) or edge (kind, label, description).
Left palette: saved profiles (click or drag to spawn), "New blank agent", "Save node as profile".
Top bar: team title, template picker (load/save/delete/duplicate), undo/redo, auto-layout, fit view,
Export JSON / Import JSON, "Copy brief", "Save to Claude" (PUT team). Live brief preview drawer (uses
`POST /api/compile`). Validation badges (disconnected node, two leads, empty description, unknown edge ends).
Keyboard: Delete removes selection, Cmd/Ctrl+Z/Shift+Z, Cmd/Ctrl+S saves, Esc deselects.
Works without the server (profiles and templates in localStorage, JSON export/import, brief preview shows
"start the server for preview") and upgrades silently when `/api/ping` answers. Autosaves a draft to
localStorage. Light and dark mode. Touch-tolerant but desktop-first. Accessible: real buttons, labels,
visible focus, keyboard-reachable inspector.
Palette: accent ultraviolet `#5B2BD1` (dark mode `#A78BFA`), crimson `#B2182B` for warnings, greys.
NO blue and NO orange anywhere in the UI.

## Plugin requirements [C]

- `.claude-plugin/plugin.json` name `teams`.
- Commands (Markdown with frontmatter, using `${CLAUDE_PLUGIN_ROOT}` and `!` bash injection where useful):
  - `/teams:run <team> <task...>` : compiles the brief with the task and instructs the model to execute it
    exactly as written.
  - `/teams:edit [team]` : starts the server in the background, then tells the model to open the printed URL
    in the built-in browser pane (preview_start with `url`), and to say plainly if it could not.
  - `/teams:list`, `/teams:new <description>` (model drafts a team JSON from plain language per the skill,
    validates it, saves it through the CLI/API, offers `/teams:edit`), `/teams:agents <team>` (writes real
    `.claude/agents/*.md` subagent files).
- Skill `agent-teams`: schema cheat sheet, how to design a good graph (few nodes, explicit edge protocols,
  one lead, bounded review loops), how to save through `bin/team.mjs`.
- `.claude/launch.json` with a `team-studio` configuration for `preview_start`.
- README: 60-second quickstart, install from a local folder, where files live, a worked example.

## Definition of done (all)
Runs on macOS with plain `node` >= 20, no installs. Every claim in the README was executed. Say plainly
what was not verified. Files stay in this folder; do not touch `~/.claude` except through the store when
testing, and then only with `TEAMS_HOME` pointed at a temp dir.

## Addendum v1.1 (polarity and head node)

Edge field `polarity`: optional, `"positive"` (arrow) or `"negative"` (inhibitor bar). Absent means positive.
ILLUSTRATION ONLY. It is stored in the team file and drawn in the editor, and nothing else reads it:
validate accepts it (rejects other values), compile (brief and agents) ignores it completely. Flipping the
polarity of every edge must leave every compiled byte identical. Do not mention it in any brief.

Node field `isHead`: optional boolean, at most one per team. The head node represents the MAIN SESSION
(the agent the user talks to), not a spawned subagent.
- compile brief: the head node is never spawned and gets no spawn instructions; "How to run" says the main
  session is the lead and acts as the head node. If the head node has a non-empty description it appears under
  a `## Head agent (the main session)` section as fenced standing instructions for the lead, placed before the
  Roster. The Roster lists only spawned agents. Its edges stay in Interactions (it delegates along them); it
  comes first in the suggested order but is marked "(you)" and not spawned.
- compile agents format: writes no file for the head node.
- validate: more than one head is an error; a head with no outgoing edges is a warning; the head needs no
  description, model or tools (ignored); `isHead` together with `isLead` on the same node is an error.
- A team without a head node compiles byte-identically to before this addendum.
- Profiles: the head node cannot be saved as a profile.
