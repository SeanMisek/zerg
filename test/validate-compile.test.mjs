import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateTeam, validateProfile, isSlug } from '../lib/validate.mjs';
import { compileBrief, compileAgents, executionPlan, normalize } from '../lib/compile.mjs';
import { ROOT, team, example } from './helpers.mjs';

const msgs = (r, level) => r.problems.filter((p) => !level || p.level === level).map((p) => p.message).join('\n');

test('slug rules', () => {
  for (const ok of ['a', 'review-loop', '0abc', 'a'.repeat(63)]) assert.ok(isSlug(ok), ok);
  for (const bad of ['', '-a', 'A', 'a_b', 'a b', 'a.b', 'a/b', '../x', 'a'.repeat(64), '..', 'a\0b', null, 5]) assert.ok(!isSlug(bad), String(bad));
});

test('examples validate cleanly (no errors, no warnings)', () => {
  for (const f of fs.readdirSync(path.join(ROOT, 'examples', 'teams'))) {
    const r = validateTeam(JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'teams', f), 'utf8')));
    assert.deepEqual(r.problems, [], f);
  }
  for (const f of fs.readdirSync(path.join(ROOT, 'examples', 'profiles'))) {
    const p = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'profiles', f), 'utf8'));
    assert.deepEqual(validateProfile(p).problems, [], f);
    const lines = p.description.split('\n').length;
    assert.ok(lines >= 3 && lines <= 6, `${f} has ${lines} instruction lines`);
  }
  assert.equal(fs.readdirSync(path.join(ROOT, 'examples', 'profiles')).length, 8);
});

test('validate: each problem class', () => {
  assert.ok(validateTeam(team()).ok);
  assert.match(msgs(validateTeam(null)), /JSON object/);
  assert.match(msgs(validateTeam(team({ version: 2 }))), /version/);
  assert.match(msgs(validateTeam(team({ name: 'Bad Name' }))), /slug/);
  assert.match(msgs(validateTeam(team({ nodes: 'x' }))), /nodes/);
  // schema errors in nodes and edges
  const t = team();
  t.nodes[0].model = 'gpt';
  t.nodes[1].tools = 'Read';
  t.edges[0].kind = 'shout';
  t.edges[0].label = 'x'.repeat(25);
  const r = validateTeam(t);
  assert.match(msgs(r, 'error'), /model/);
  assert.match(msgs(r, 'error'), /tools/);
  assert.match(msgs(r, 'error'), /kind/);
  assert.match(msgs(r, 'error'), /label/);
  // unknown ends
  const u = team();
  u.edges.push({ id: 'e2', from: 'a', to: 'zzz', kind: 'handoff', description: 'x' });
  const ur = validateTeam(u);
  assert.ok(!ur.ok);
  assert.equal(ur.problems.find((p) => /unknown/.test(p.message)).edgeId, 'e2');
  // self loop
  const s = team();
  s.edges.push({ id: 'e3', from: 'a', to: 'a', kind: 'consult', description: 'x' });
  assert.match(msgs(validateTeam(s), 'error'), /itself/);
  // two leads
  const l = team();
  l.nodes[0].isLead = true;
  l.nodes[1].isLead = true;
  assert.match(msgs(validateTeam(l), 'error'), /one node may be the lead/);
  // duplicate ids
  const d = team();
  d.nodes[1].id = 'a';
  d.edges.push({ ...d.edges[0] });
  const dr = validateTeam(d);
  assert.match(msgs(dr, 'error'), /Duplicate node id "a"/);
  assert.match(msgs(dr, 'error'), /Duplicate edge id "e1"/);
  // warnings: empty descriptions, disconnected
  const w = team();
  w.nodes[0].description = '  ';
  w.edges[0].description = '';
  w.nodes.push({ id: 'c', name: 'C', description: 'lonely' });
  const wr = validateTeam(w);
  assert.ok(wr.ok, 'warnings do not fail');
  assert.match(msgs(wr, 'warning'), /Node "A" has an empty description/);
  assert.match(msgs(wr, 'warning'), /Edge e1 has an empty description/);
  assert.match(msgs(wr, 'warning'), /Node "C" is not connected/);
  assert.equal(wr.problems.find((p) => /not connected/.test(p.message)).nodeId, 'c');
});

test('compile is deterministic and the brief matches its snapshot', () => {
  const t = example('review-loop');
  const a = compileBrief(t, { prompt: 'Add a --dry-run flag' });
  assert.equal(a, compileBrief(JSON.parse(JSON.stringify(t)), { prompt: 'Add a --dry-run flag' }));
  const snap = path.join(ROOT, 'test', 'snapshots', 'review-loop.brief.md');
  if (process.env.UPDATE_SNAPSHOTS || !fs.existsSync(snap)) fs.writeFileSync(snap, a);
  assert.equal(a, fs.readFileSync(snap, 'utf8'));
  // section order
  const heads = [...a.matchAll(/^(# |## )(.+)$/gm)].map((m) => m[2]);
  assert.deepEqual(heads.filter((h) => !/^\d\. /.test(h)), ['Team: Implement and review loop', 'How to run this team', 'Roster', 'Interactions', 'Task']);
  // no prompt
  assert.match(compileBrief(t), /The user's request follows this brief/);
});

test('brief stays readable for 12 nodes and honors the lead', () => {
  const nodes = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, name: `Agent ${i}`, description: 'Do the thing.', isLead: i === 0 }));
  const edges = nodes.slice(1).map((n, i) => ({ id: `e${i}`, from: 'n0', to: n.id, kind: 'delegate', description: 'work' }));
  const out = compileBrief(team({ nodes, edges }), { prompt: 'go' });
  assert.ok(out.length < 12000, `brief is ${out.length} chars`);
  assert.match(out, /takes on the role of \*\*Agent 0\*\*/);
  assert.match(out, /2\. Agent 1, Agent 2.*\(in parallel\)/);
});

test('instructions containing code fences cannot break the brief structure', () => {
  const t = team();
  t.nodes[0].description = 'Use:\n```js\nx()\n```\n## Not a heading of the brief';
  const out = compileBrief(t);
  assert.match(out, /````markdown\nUse:/);
});

test('cycles are collapsed and flagged as loops; order is topological', () => {
  const t = team();
  t.nodes.push({ id: 'c', name: 'C', description: 'x' }, { id: 'd', name: 'D', description: 'x' });
  t.edges = [
    { id: 'e1', from: 'a', to: 'b', kind: 'handoff', description: 'x' },
    { id: 'e2', from: 'b', to: 'c', kind: 'handoff', description: 'x' },
    { id: 'e3', from: 'c', to: 'b', kind: 'handoff', description: 'x' }, // b <-> c cycle
    { id: 'e4', from: 'c', to: 'd', kind: 'delegate', description: 'x' },
  ];
  const plan = executionPlan(normalize(t).nodes, normalize(t).edges);
  assert.deepEqual(plan.map((l) => l.map((c) => c.ids.join('+'))), [['a'], ['b+c'], ['d']]);
  assert.ok(plan[1][0].loop);
  const out = compileBrief(t);
  assert.match(out, /2\. \[loop: B ⇄ C; iterate at most 2 rounds, then stop\]/);
  assert.match(out, /3\. D/);
  // review edges order the reviewed node first; debate is a loop; consult imposes nothing
  const r = team();
  r.edges = [{ id: 'e1', from: 'a', to: 'b', kind: 'review', description: 'x' }];
  assert.deepEqual(executionPlan(normalize(r).nodes, normalize(r).edges).map((l) => l[0].ids[0]), ['b', 'a']);
  r.edges[0].kind = 'debate';
  assert.ok(executionPlan(normalize(r).nodes, normalize(r).edges)[0][0].loop);
  r.edges[0].kind = 'consult';
  assert.equal(executionPlan(normalize(r).nodes, normalize(r).edges).length, 1);
});

test('compile tolerates drafts: dangling edges and self loops are skipped', () => {
  const t = team();
  t.edges.push({ id: 'x', from: 'a', to: 'nope', kind: 'delegate', description: 'q' }, { id: 'y', from: 'a', to: 'a', kind: 'delegate', description: 'q' });
  const out = compileBrief(t);
  assert.ok(!out.includes('nope'));
  assert.equal([...out.split('## Interactions')[1].matchAll(/^- \*\*/gm)].length, 1, 'only the valid edge is listed');
});

test('agents format', () => {
  const t = example('review-loop');
  const files = compileAgents(t);
  assert.deepEqual(files.map((f) => f.file), ['review-loop-architect.md', 'review-loop-implementer.md', 'review-loop-reviewer.md', 'review-loop-tester.md']);
  const arch = files[0].content;
  assert.match(arch, /^---\nname: review-loop-architect\ndescription: "Turns a goal into a concrete, ordered plan"\ntools: Read, Grep, Glob\nmodel: opus\n---\n/);
  assert.match(arch, /Interactions in team "Implement and review loop"/);
  assert.match(arch, /\*\*To Implementer\*\* \(agent `review-loop-implementer`; delegate, "plan"\)/);
  const impl = files[1].content;
  assert.ok(!/^tools:/m.test(impl), 'tools omitted when null');
  assert.ok(!/^model:/m.test(impl), 'model omitted when inherit');
  assert.deepEqual(compileAgents(t), files, 'deterministic');
  // duplicate names get distinct files
  const t2 = team();
  t2.nodes[1].name = 'A';
  assert.deepEqual(compileAgents(t2).map((f) => f.file), ['t-a.md', 't-a-2.md']);
});
