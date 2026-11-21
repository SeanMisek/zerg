import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateTeam, validateProfile } from '../lib/validate.mjs';
import { compileBrief, compileAgents } from '../lib/compile.mjs';
import { startServer } from '../server/server.mjs';
import { createStore } from '../lib/store.mjs';
import { ROOT, tmp, team, example, request } from './helpers.mjs';

const H = { 'X-Team-Studio': '1', 'Content-Type': 'application/json' };
const msgs = (r, l) => r.problems.filter((p) => !l || p.level === l).map((p) => p.message).join('\n');
const names = fs.readdirSync(path.join(ROOT, 'examples', 'teams')).map((f) => f.replace('.json', ''));

function headTeam() {
  const t = example('review-loop');
  t.name = 'head-loop';
  t.nodes[0].isHead = true; // Architect is the main session
  t.nodes[0].description = 'You talk to the user.\n```\nkeep it short\n```\n## Not a heading';
  return t;
}

test('polarity: validated, and flipping it changes no compiled byte', () => {
  const t = team();
  t.edges[0].polarity = 'sideways';
  assert.match(msgs(validateTeam(t), 'error'), /polarity/);
  for (const v of ['positive', 'negative', undefined]) { t.edges[0].polarity = v; assert.ok(validateTeam(t).ok); }
  for (const n of names) {
    const base = example(n);
    const outs = ['positive', 'negative', undefined].map((pol) => {
      const x = JSON.parse(JSON.stringify(base));
      x.edges.forEach((e) => { if (pol) e.polarity = pol; else delete e.polarity; });
      return JSON.stringify([compileBrief(x, { prompt: 'p' }), compileAgents(x)]);
    });
    assert.equal(outs[0], outs[1], n);
    assert.equal(outs[0], outs[2], n);
    assert.ok(!/polarity|inhibit/i.test(outs[0]));
    // mixed flip
    const mixed = JSON.parse(JSON.stringify(base));
    mixed.edges.forEach((e, i) => { e.polarity = i % 2 ? 'negative' : 'positive'; });
    assert.equal(JSON.stringify([compileBrief(mixed, { prompt: 'p' }), compileAgents(mixed)]), outs[0], n);
  }
});

test('head: validation rules', () => {
  const two = team();
  two.nodes.forEach((n) => (n.isHead = true));
  assert.match(msgs(validateTeam(two), 'error'), /one node may be the head/);
  const both = team();
  both.nodes[0].isHead = both.nodes[0].isLead = true;
  assert.match(msgs(validateTeam(both), 'error'), /both the head/);
  const none = team();
  none.nodes[1].isHead = true; // b has no outgoing edges
  const r = validateTeam(none);
  assert.ok(r.ok);
  assert.match(msgs(r, 'warning'), /Head node "B" has no outgoing edges/);
  none.nodes[1].description = '';
  assert.ok(!/empty description/.test(msgs(validateTeam(none))), 'head needs no description');
  const bad = team();
  bad.nodes[0].isHead = 'yes';
  assert.match(msgs(validateTeam(bad), 'error'), /isHead/);
  assert.deepEqual(validateTeam(headTeam()).problems, []);
  assert.match(msgs(validateProfile({ version: 1, slug: 'h', name: 'H', description: 'x', isHead: true }), 'error'), /head node cannot be saved/);
});

test('head: brief and agents', () => {
  const t = headTeam();
  const out = compileBrief(t, { prompt: 'go' });
  assert.match(out, /acts as the head agent \*\*Architect\*\*. It is not spawned/);
  assert.match(out, /\(see Head agent below\)/);
  const real = out.replace(/^(`{3,})[^\n]*\n[\s\S]*?^\1$/gm, '');
  assert.equal(real.split('\n').filter((l) => l === '## Head agent (the main session)').length, 1);
  assert.ok(!/^## Not a heading/m.test(real), 'head description is fenced');
  assert.ok(out.indexOf('## Head agent') < out.indexOf('## Roster'));
  assert.ok(out.includes('```markdown\nYou talk to the user.'));
  const roster = out.split('## Roster')[1].split('## Interactions')[0];
  assert.ok(!/Architect/.test(roster), 'head not in roster');
  assert.match(roster, /### 1\. Implementer/);
  assert.match(out, /- \*\*Architect → Implementer\*\* \(delegate/);
  assert.match(out, /1\. Architect \(you, not spawned\)\n2\. Implementer\n3\. Reviewer, Tester \(in parallel\)/);
  const files = compileAgents(t);
  assert.deepEqual(files.map((f) => f.file), ['head-loop-implementer.md', 'head-loop-reviewer.md', 'head-loop-tester.md']);
  assert.ok(files.every((f) => !/review-loop-architect|head-loop-architect/.test(f.content)));
  assert.match(files[0].content, /\*\*From Architect\*\* \(the main session; delegate, "plan"\)/);
  // head without description: no section
  t.nodes[0].description = '';
  const out2 = compileBrief(t);
  assert.ok(!out2.includes('## Head agent'));
  assert.ok(!out2.includes('see Head agent below'));
  // snapshot
  const snap = path.join(ROOT, 'test', 'snapshots', 'head-loop.brief.md');
  const cur = compileBrief(headTeam(), { prompt: 'Add a --dry-run flag' });
  if (process.env.UPDATE_SNAPSHOTS || !fs.existsSync(snap)) fs.writeFileSync(snap, cur);
  assert.equal(cur, fs.readFileSync(snap, 'utf8'));
});

test('head: server accepts it on PUT and compile', async () => {
  const s = await startServer({ port: 0, store: createStore({ home: tmp(), cwd: tmp() }), editorPath: '/nonexistent' });
  try {
    const t = headTeam();
    assert.equal((await request(s.port, { method: 'PUT', path: '/api/teams/head-loop', headers: H, body: t })).status, 200);
    assert.equal((await request(s.port, { path: '/api/teams/head-loop' })).json.nodes[0].isHead, true);
    const c = await request(s.port, { method: 'POST', path: '/api/compile', headers: H, body: { team: t } });
    assert.match(c.text, /## Head agent \(the main session\)/);
    const two = headTeam();
    two.nodes[1].isHead = true;
    const r = await request(s.port, { method: 'PUT', path: '/api/teams/head-loop', headers: H, body: two });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /head/);
  } finally { s.server.close(); }
});
