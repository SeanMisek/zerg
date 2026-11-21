# Agent Team Studio

Agent Team Studio is a Claude Code plugin named `teams`. You design a team of agents on a visual canvas (nodes are agents, edges are described hand-offs), save it as a template, and apply it to any prompt with one command: `/teams:run <team> <task>`. Zero npm dependencies; plain `node` >= 20.

## 60-second quickstart

Install from GitHub (inside Claude Code):
```
/plugin marketplace add SeanMisek/claude-agent-team-studio
/plugin install teams@team-studio
```
Or try it straight from a cloned folder:
```sh
claude --plugin-dir <path to this folder>
```
Then, inside Claude Code:
```
/teams:list
/teams:run review-loop add a --version flag to the CLI
/teams:edit            # opens the canvas editor in the browser pane
/teams:new a team that drafts a grant section and has a skeptical reviewer
/teams:agents review-loop   # writes .claude/agents/review-loop-*.md
```
Run `/reload-plugins` after editing plugin files.

## Install from a local folder

- Per session: `claude --plugin-dir <this folder>` (above).
- Permanent: this repository is its own marketplace (`.claude-plugin/marketplace.json` lists the plugin with `source: "./"`), so `/plugin marketplace add <owner>/<repo>` then `/plugin install teams@team-studio` (or the same two steps with `claude plugin marketplace add` and `claude plugin install`). The marketplace install path has not been run end to end yet.
- Check the manifest: `claude plugin validate <this folder>`.

## Commands

| Command | What it does |
|---|---|
| `/teams:run <team> <task...>` | Compiles the team into a brief and tells Claude to execute it exactly, spawning each roster agent with the Agent tool |
| `/teams:edit [team]` | Starts the editor server in the background and opens its URL in the built-in browser pane (prints the URL if it cannot) |
| `/teams:load [task...]` | Shows a pick-list of saved teams (3 per page plus "More teams..."), asks for the task if you gave none, then runs the team like `/teams:run` |
| `/teams:list` | Lists teams and profiles |
| `/teams:new <description>` | Claude drafts a team from plain language (skill `agent-teams`), validates and saves it |
| `/teams:agents <team>` | Writes real subagent files into `./.claude/agents/` |

## Polarity and head node

- Edge `polarity` (`"negative"` draws an inhibitor bar instead of an arrow) is illustration only: it never changes the compiled brief or agents. Example edge: `{"id":"e2","from":"n2","to":"n1","kind":"review","polarity":"negative","description":"Editor blocks weak drafts."}`
- Node `isHead: true` marks the main session (you); it is never spawned, and the brief lists it under "Head agent" instead of the Roster. Example node: `{"id":"n0","name":"Me","isHead":true,"description":"I approve the plan."}`

## Where files live

- Store: `$TEAMS_HOME`, default `~/.claude/agent-teams/`, with `teams/<slug>.json` and `profiles/<slug>.json`. The first run seeds starter teams and profiles from `examples/`.
- Read order: `./.claude/agent-teams/` (project) first, then the global store. Writes go to the global store unless `--project`.
- Editor server: `http://127.0.0.1:4317/`, local only. `.claude/launch.json` defines a `team-studio` config for `preview_start`.

## CLI (what the commands call)

```sh
node bin/team.mjs list [--profiles]
node bin/team.mjs show <team>
node bin/team.mjs validate <team|file.json>
node bin/team.mjs compile <team|file.json> [--prompt "text"] [--format brief|agents]
node bin/team.mjs serve [--port 4317]
```

## Worked example

```sh
export TEAMS_HOME=$(mktemp -d)                  # keep ~/.claude untouched while trying it
node bin/team.mjs list                          # three starter teams
node bin/team.mjs compile review-loop --prompt "Add a --version flag" | head -20
cd $(mktemp -d) && node /path/to/agent_team_studio/bin/team.mjs compile plan-build-test --format agents
ls .claude/agents                               # plan-build-test-architect.md, ...
```
Saving a custom team over the API (server running): validate the JSON with `node bin/team.mjs validate file.json`, then
`curl -X PUT -H 'X-Team-Studio: 1' -H 'Content-Type: application/json' --data @file.json http://127.0.0.1:4317/api/teams/<slug>`.
Non-GET requests without the `X-Team-Studio: 1` header get 403.

## Verified, and not

Run by the author: `claude plugin validate` (passes), every `bin/team.mjs` command above (list, list --profiles, show, compile, compile --format agents, validate, error exit code 1, serve, ping, PUT/403) against a temp `TEAMS_HOME`, and the `!` injection lines by hand.
Not run: any slash command inside a live Claude session (the CLI was not authenticated in the build environment), whether `${CLAUDE_PLUGIN_ROOT}` expands inside `!` injections (docs imply yes, unconfirmed), `preview_start` opening the editor, the marketplace install path, and the editor UI itself.
