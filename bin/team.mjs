#!/usr/bin/env node
// Agent Team Studio CLI. Exit codes: 0 ok, 1 user error, 2 internal error.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createStore, UserError, assertSlug, atomicWrite } from '../lib/store.mjs';
import { validateTeam, validateProfile, formatProblems } from '../lib/validate.mjs';
import { compileBrief, compileAgents } from '../lib/compile.mjs';

const HELP = `Usage: team.mjs <command> [options]
  list [--profiles] [--json]                     one line per team (name, title, nodes, edges)
  show <name> [--profile]                 print the JSON
  compile <name|path.json> [--prompt "text"] [--format brief|agents] [--force]
  validate <name|path.json>               exit 1 on errors
  save <path.json|-> [--profile] [--project]   validate and store a team (or profile) from a file or stdin
  delete <name> [--profile] [--project]
  serve [--port 4317] [--open] [--home DIR]
Global: --home DIR (store root; default $TEAMS_HOME or ~/.claude/agent-teams)`;

const VALUE_FLAGS = new Set(['prompt', 'format', 'port', 'home']);
function parseArgs(argv) {
  const flags = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--') && a.length > 2) {
      const [k, v] = a.slice(2).split(/=(.*)/s);
      if (VALUE_FLAGS.has(k)) {
        if (v !== undefined) flags[k] = v;
        else if (i + 1 < argv.length) flags[k] = argv[++i];
        else throw new UserError(`--${k} needs a value`);
      } else if (['profiles', 'profile', 'json', 'project', 'open', 'help', 'force'].includes(k)) flags[k] = true;
      else throw new UserError(`Unknown option --${k}`);
    } else pos.push(a);
  }
  return { flags, pos };
}

function loadTeam(arg, store) {
  if (!arg) throw new UserError('Missing team name or path');
  if (arg.endsWith('.json')) {
    let text;
    try { text = fs.readFileSync(arg, 'utf8'); } catch (e) { throw new UserError(`Cannot read ${arg}: ${e.code === 'ENOENT' ? 'no such file' : e.message}`); }
    try { return JSON.parse(text); } catch (e) { throw new UserError(`${arg} is not valid JSON: ${e.message}`); }
  }
  assertSlug(arg, 'team name');
  const hit = store.readTeam(arg);
  if (!hit) throw new UserError(`No team named "${arg}". Run "list" to see saved teams.`);
  return hit.data;
}

function requireValid(team, label) {
  const r = validateTeam(team);
  if (!r.ok) throw new UserError(`${label} is invalid:\n${formatProblems(r.problems)}`);
  return r;
}

async function main(argv) {
  const { flags, pos } = parseArgs(argv);
  const [cmd, ...rest] = pos;
  if (!cmd || flags.help || cmd === 'help') {
    (cmd || flags.help ? process.stdout : process.stderr).write(HELP + '\n');
    return cmd || flags.help ? 0 : 1;
  }
  if (flags.home) process.env.TEAMS_HOME = flags.home;
  const store = createStore({ cwd: process.cwd() });
  const out = (s) => process.stdout.write(s.endsWith('\n') ? s : s + '\n');

  switch (cmd) {
    case 'list': {
      if (flags.json) {
        const rows = (flags.profiles ? store.listProfiles() : store.listTeams())
          .sort((a, b) => b.mtimeMs - a.mtimeMs || (a.slug < b.slug ? -1 : 1))
          .map(({ slug, scope, data, mtimeMs }) => flags.profiles
            ? { name: slug, title: data.name ?? '', description: data.role ?? '', scope, modified: new Date(mtimeMs).toISOString() }
            : { name: slug, title: data.title ?? '', description: data.description ?? '',
                nodes: Array.isArray(data.nodes) ? data.nodes.length : 0, edges: Array.isArray(data.edges) ? data.edges.length : 0,
                scope, modified: new Date(mtimeMs).toISOString() });
        out(JSON.stringify(rows, null, 2));
        return 0;
      }
      if (flags.profiles) {
        for (const { slug, data } of store.listProfiles()) out(`${slug}\t${data.name ?? ''}\t${data.role ?? ''}`);
      } else {
        for (const { slug, data } of store.listTeams()) {
          out(`${slug}\t${data.title ?? ''}\t${Array.isArray(data.nodes) ? data.nodes.length : 0}\t${Array.isArray(data.edges) ? data.edges.length : 0}`);
        }
      }
      return 0;
    }
    case 'show': {
      const name = assertSlug(rest[0], flags.profile ? 'profile name' : 'team name');
      const hit = flags.profile ? store.readProfile(name) : store.readTeam(name);
      if (!hit) throw new UserError(`No ${flags.profile ? 'profile' : 'team'} named "${name}"`);
      out(JSON.stringify(hit.data, null, 2));
      return 0;
    }
    case 'validate': {
      const team = loadTeam(rest[0], store);
      const r = validateTeam(team);
      if (r.problems.length) process.stderr.write(formatProblems(r.problems) + '\n');
      if (!r.ok) return 1;
      out('ok');
      return 0;
    }
    case 'compile': {
      const team = loadTeam(rest[0], store);
      requireValid(team, rest[0]);
      const format = flags.format || 'brief';
      if (format === 'brief') {
        process.stdout.write(compileBrief(team, { prompt: flags.prompt }));
        return 0;
      }
      if (format === 'agents') {
        const dir = path.join(process.cwd(), '.claude', 'agents');
        const skipped = [];
        for (const f of compileAgents(team)) {
          const target = path.join(dir, f.file);
          const rel = path.relative(process.cwd(), target);
          if (!flags.force && fs.existsSync(target)) { skipped.push(rel); continue; }
          atomicWrite(target, f.content);
          out(rel);
        }
        if (skipped.length) {
          process.stderr.write(`error: skipped, already exist (use --force to overwrite):\n${skipped.map((x) => `  ${x}`).join('\n')}\n`);
          return 1;
        }
        return 0;
      }
      throw new UserError(`Unknown --format "${format}" (use brief or agents)`);
    }
    case 'save': {
      if (!rest[0]) throw new UserError('Missing file path (or - for stdin)');
      let text;
      try { text = rest[0] === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(rest[0], 'utf8'); } catch (e) { throw new UserError(`Cannot read ${rest[0]}: ${e.message}`); }
      let data;
      try { data = JSON.parse(text); } catch (e) { throw new UserError(`Not valid JSON: ${e.message}`); }
      const r = flags.profile ? validateProfile(data) : validateTeam(data);
      if (!r.ok) throw new UserError(`Not saved, invalid:\n${formatProblems(r.problems)}`);
      const scope = flags.project ? 'project' : 'global';
      const file = flags.profile ? store.writeProfile(data.slug, data, { scope }) : store.writeTeam(data.name, data, { scope });
      for (const p of r.problems) process.stderr.write(`${p.level}: ${p.message}\n`);
      out(file);
      return 0;
    }
    case 'delete': {
      const name = assertSlug(rest[0], flags.profile ? 'profile name' : 'team name');
      const scope = flags.project ? 'project' : 'global';
      const ok = flags.profile ? store.removeProfile(name, { scope }) : store.removeTeam(name, { scope });
      if (!ok) throw new UserError(`No ${flags.profile ? 'profile' : 'team'} named "${name}" in the ${scope} store`);
      out(`deleted ${name}`);
      return 0;
    }
    case 'serve': {
      const port = flags.port === undefined ? 4317 : Number(flags.port);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UserError(`Bad --port ${flags.port}`);
      const { startServer } = await import('../server/server.mjs');
      let s;
      try {
        s = await startServer({ port, store });
      } catch (e) {
        if (e.code === 'EADDRINUSE') throw new UserError(`Ports ${port}-${port + 20} are all in use; pass --port`);
        throw e;
      }
      out(s.url);
      if (flags.open) {
        const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
        const args = process.platform === 'win32' ? ['/c', 'start', '', s.url] : [s.url];
        try { spawn(opener, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* ignore */ }
      }
      process.stderr.write(`Store: ${store.home}\nCtrl+C to stop.\n`);
      return null; // keep running
    }
    default:
      throw new UserError(`Unknown command "${cmd}"\n${HELP}`);
  }
}

main(process.argv.slice(2)).then(
  (code) => { if (code !== null) process.exitCode = code; },
  (e) => {
    if (e instanceof UserError) {
      process.stderr.write(`error: ${e.message}\n`);
      process.exitCode = 1;
    } else {
      process.stderr.write(`internal error: ${e && e.stack ? e.stack : e}\n`);
      process.exitCode = 2;
    }
  },
);
