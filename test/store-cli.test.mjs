import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createStore, assertSlug, UserError } from '../lib/store.mjs';
import { ROOT, tmp, team } from './helpers.mjs';

const CLI = path.join(ROOT, 'bin', 'team.mjs');
function cli(args, { home = tmp(), cwd = tmp(), input } = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { env: { ...process.env, TEAMS_HOME: home }, cwd, input, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr, home, cwd };
}

test('slug validation and traversal attempts', () => {
  const store = createStore({ home: tmp(), cwd: tmp() });
  for (const bad of ['../x', '..', '../../etc/passwd', 'a/b', 'a\\b', '/abs', 'x/../y', '.hidden', 'A', '', 'a.json', 'a\0']) {
    assert.throws(() => assertSlug(bad), UserError, bad);
    assert.throws(() => store.writeTeam(bad, team()), UserError, bad);
    assert.throws(() => store.readTeam(bad), UserError, bad);
    assert.throws(() => store.removeTeam(bad), UserError, bad);
    assert.throws(() => store.writeProfile(bad, {}), UserError, bad);
  }
  assert.equal(assertSlug('good-1'), 'good-1');
});

test('store round trip, scopes, atomic writes and seeding', () => {
  const home = tmp();
  const cwd = tmp();
  const store = createStore({ home, cwd });
  // seeded on first use
  assert.deepEqual(store.listTeams().map((t) => t.slug), ['plan-build-test', 'research-fan-out', 'review-loop']);
  assert.equal(store.listProfiles().length, 8);
  // delete a seeded one: no re-seed
  assert.ok(store.removeTeam('review-loop'));
  assert.ok(!store.removeTeam('review-loop'));
  assert.equal(createStore({ home, cwd }).listTeams().length, 2);
  // round trip
  const t = team({ name: 'mine' });
  const file = store.writeTeam('mine', t);
  assert.equal(file, path.join(home, 'teams', 'mine.json'));
  assert.deepEqual(store.readTeam('mine'), { data: t, scope: 'global' });
  assert.deepEqual(fs.readdirSync(path.join(home, 'teams')).filter((f) => f.endsWith('.tmp')), []);
  // project overrides global on read, global untouched
  const p = team({ name: 'mine', title: 'Project version' });
  store.writeTeam('mine', p, { scope: 'project' });
  assert.equal(fs.existsSync(path.join(cwd, '.claude', 'agent-teams', 'teams', 'mine.json')), true);
  assert.equal(store.readTeam('mine').data.title, 'Project version');
  assert.equal(store.readTeam('mine').scope, 'project');
  assert.equal(store.listTeams().find((x) => x.slug === 'mine').scope, 'project');
  assert.ok(store.removeTeam('mine', { scope: 'project' }));
  assert.equal(store.readTeam('mine').data.title, 'T');
  assert.equal(store.readTeam('nothing'), null);
});

test('CLI: list, show, validate, compile, exit codes', () => {
  const home = tmp();
  const l = cli(['list'], { home });
  assert.equal(l.code, 0);
  assert.match(l.out, /^review-loop\tImplement and review loop\t4\t3$/m);
  assert.match(cli(['list', '--profiles'], { home }).out, /^architect\tArchitect\t/m);
  assert.equal(JSON.parse(cli(['show', 'review-loop'], { home }).out).name, 'review-loop');
  const c = cli(['compile', 'review-loop', '--prompt', 'Fix the bug'], { home });
  assert.equal(c.code, 0);
  assert.ok(c.out.startsWith('# Team: Implement and review loop'));
  assert.ok(c.out.trimEnd().endsWith('Fix the bug'));
  assert.equal(cli(['validate', 'review-loop'], { home }).code, 0);
  // user errors -> 1, message on stderr
  for (const args of [['show', 'nope'], ['show', '../x'], ['compile', 'nope'], ['frobnicate'], ['compile', 'review-loop', '--format', 'xml'], ['compile', '/no/such.json']]) {
    const r = cli(args, { home });
    assert.equal(r.code, 1, args.join(' '));
    assert.match(r.err, /error:/);
    assert.equal(r.out, '');
  }
  // invalid team file -> validate exit 1 with messages; compile refuses
  const bad = team();
  bad.nodes[0].isLead = bad.nodes[1].isLead = true;
  const dir = tmp();
  const f = path.join(dir, 'bad.json');
  fs.writeFileSync(f, JSON.stringify(bad));
  const v = cli(['validate', f], { home });
  assert.equal(v.code, 1);
  assert.match(v.err, /one node may be the lead/);
  assert.equal(cli(['compile', f], { home }).code, 1);
  // warnings alone exit 0
  const warn = team();
  warn.nodes[0].description = '';
  fs.writeFileSync(f, JSON.stringify(warn));
  const w = cli(['validate', f], { home });
  assert.equal(w.code, 0);
  assert.match(w.err, /warning: .*empty description/);
});

test('CLI: compile --format agents writes files into cwd', () => {
  const cwd = tmp();
  const r = cli(['compile', 'review-loop', '--format', 'agents'], { cwd });
  assert.equal(r.code, 0);
  const lines = r.out.trim().split('\n');
  assert.deepEqual(lines, ['.claude/agents/review-loop-architect.md', '.claude/agents/review-loop-implementer.md', '.claude/agents/review-loop-reviewer.md', '.claude/agents/review-loop-tester.md']);
  for (const l of lines) assert.ok(fs.existsSync(path.join(cwd, l)));
  assert.match(fs.readFileSync(path.join(cwd, lines[0]), 'utf8'), /^---\nname: review-loop-architect/);
});

test('CLI: save and delete', () => {
  const home = tmp();
  const s = cli(['save', '-'], { home, input: JSON.stringify(team({ name: 'saved' })) });
  assert.equal(s.code, 0);
  assert.ok(fs.existsSync(path.join(home, 'teams', 'saved.json')));
  assert.equal(cli(['save', '-'], { home, input: '{"version":1}' }).code, 1);
  assert.equal(cli(['delete', 'saved'], { home }).code, 0);
  assert.equal(cli(['delete', 'saved'], { home }).code, 1);
});

test('CLI: list --json shape, ordering, shadowing; plain list unchanged', () => {
  const home = tmp();
  const cwd = tmp();
  const plain = cli(['list'], { home, cwd }).out;
  assert.match(plain, /^review-loop\tImplement and review loop\t4\t3$/m);
  const store = createStore({ home, cwd });
  store.writeTeam('mine', team({ name: 'mine', title: 'Global mine' }));
  store.writeTeam('review-loop', { ...team({ name: 'review-loop', title: 'Project shadow' }) }, { scope: 'project' });
  const old = new Date('2020-01-01T00:00:00Z');
  fs.utimesSync(path.join(home, 'teams', 'plan-build-test.json'), old, old);
  const rows = JSON.parse(cli(['list', '--json'], { home, cwd }).out);
  for (const r of rows) {
    assert.deepEqual(Object.keys(r), ['name', 'title', 'description', 'nodes', 'edges', 'scope', 'modified']);
    assert.ok(['project', 'global'].includes(r.scope));
    assert.equal(new Date(r.modified).toISOString(), r.modified);
  }
  const times = rows.map((r) => r.modified);
  assert.deepEqual(times, [...times].sort().reverse(), 'newest first');
  assert.equal(rows.at(-1).name, 'plan-build-test');
  assert.equal(rows.filter((r) => r.name === 'review-loop').length, 1, 'shadowed once');
  const shadow = rows.find((r) => r.name === 'review-loop');
  assert.equal(shadow.scope, 'project');
  assert.equal(shadow.title, 'Project shadow');
  assert.equal(shadow.nodes, 2);
  const prof = JSON.parse(cli(['list', '--profiles', '--json'], { home, cwd }).out);
  assert.equal(prof.length, 8);
  assert.ok(prof.every((p) => p.name && p.scope === 'global' && p.modified));
});
