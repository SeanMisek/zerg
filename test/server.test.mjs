import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { startServer, MAX_BODY } from '../server/server.mjs';
import { createStore } from '../lib/store.mjs';
import { ROOT, tmp, team, request } from './helpers.mjs';

let srv, port, home;
const H = { 'X-Team-Studio': '1', 'Content-Type': 'application/json' };
before(async () => {
  home = tmp();
  srv = await startServer({ port: 0, store: createStore({ home, cwd: tmp() }), editorPath: path.join(tmp(), 'missing.html') });
  port = srv.port;
});
after(() => srv.server.close());

test('binds to 127.0.0.1 only', () => {
  assert.equal(srv.server.address().address, '127.0.0.1');
  assert.equal(srv.url, `http://127.0.0.1:${port}/`);
});

test('ping and placeholder page when editor is missing', async () => {
  const p = await request(port, { path: '/api/ping' });
  assert.deepEqual(p.json, { ok: true, version: 1, home });
  const idx = await request(port);
  assert.equal(idx.status, 200);
  assert.match(idx.headers['content-type'], /text\/html/);
  assert.match(idx.text, /editor\/index\.html.*does not exist yet/s);
  assert.equal((await request(port, { path: '/../server/server.mjs' })).status, 404);
  assert.equal((await request(port, { path: '/server/server.mjs' })).status, 404);
  assert.equal((await request(port, { path: '/%2e%2e/CONTRACT.md' })).status, 404);
});

test('serves the editor file when present (and only that file)', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'index.html'), '<h1>editor</h1>');
  fs.writeFileSync(path.join(dir, 'secret.txt'), 'nope');
  const s = await startServer({ port: 0, store: createStore({ home: tmp(), cwd: tmp() }), editorPath: path.join(dir, 'index.html') });
  try {
    assert.equal((await request(s.port, { path: '/' })).text, '<h1>editor</h1>');
    assert.equal((await request(s.port, { path: '/secret.txt' })).status, 404);
  } finally { s.server.close(); }
});

test('403 paths: bad Host, missing header, wrong header value', async () => {
  for (const host of ['evil.example.com', `evil.example.com:${port}`, '127.0.0.1', `127.0.0.1:${port + 1}`, `localhost.evil.com:${port}`, '']) {
    const r = await request(port, { path: '/api/ping', host });
    assert.equal(r.status, 403, `host ${JSON.stringify(host)}`);
    assert.ok(r.json.error);
  }
  assert.equal((await request(port, { path: '/api/ping', host: `localhost:${port}` })).status, 200);
  const body = team({ name: 'x1' });
  assert.equal((await request(port, { method: 'PUT', path: '/api/teams/x1', body })).status, 403);
  assert.equal((await request(port, { method: 'PUT', path: '/api/teams/x1', body, headers: { 'X-Team-Studio': '0' } })).status, 403);
  assert.equal((await request(port, { method: 'DELETE', path: '/api/teams/x1' })).status, 403);
  assert.equal((await request(port, { method: 'POST', path: '/api/compile', body: { team: body } })).status, 403);
  assert.equal((await request(port, { method: 'PUT', path: '/api/teams/x1', body, headers: H, host: 'evil.com' })).status, 403);
  assert.equal((await request(port, { method: 'OPTIONS', path: '/api/teams', headers: H })).status, 403);
  assert.ok(!fs.existsSync(path.join(home, 'teams', 'x1.json')), 'nothing written by rejected requests');
});

test('teams: PUT / GET / list / DELETE round trip', async () => {
  const t = team({ name: 'rt', title: 'Round trip' });
  const put = await request(port, { method: 'PUT', path: '/api/teams/rt', body: t, headers: H });
  assert.equal(put.status, 200);
  assert.equal(put.json.ok, true);
  assert.deepEqual((await request(port, { path: '/api/teams/rt' })).json, t);
  const list = (await request(port, { path: '/api/teams' })).json;
  assert.deepEqual(list.find((x) => x.name === 'rt'), { name: 'rt', title: 'Round trip', description: 'd', nodes: 2, edges: 1, scope: 'global' });
  assert.ok(list.some((x) => x.name === 'review-loop'), 'seeded');
  assert.equal((await request(port, { method: 'DELETE', path: '/api/teams/rt', headers: H })).status, 200);
  assert.equal((await request(port, { path: '/api/teams/rt' })).status, 404);
  assert.equal((await request(port, { method: 'DELETE', path: '/api/teams/rt', headers: H })).status, 404);
});

test('teams: rejects invalid bodies, name mismatch, bad slugs and traversal', async () => {
  const bad = team({ name: 'bad' });
  bad.nodes[0].isLead = bad.nodes[1].isLead = true;
  const r = await request(port, { method: 'PUT', path: '/api/teams/bad', body: bad, headers: H });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /lead/);
  assert.ok(Array.isArray(r.json.problems));
  assert.equal((await request(port, { method: 'PUT', path: '/api/teams/other', body: team({ name: 'bad' }), headers: H })).status, 400);
  assert.equal((await request(port, { method: 'PUT', path: '/api/teams/bad', body: '{not json', headers: H })).status, 400);
  for (const p of ['/api/teams/..%2F..%2Fetc%2Fpasswd', '/api/teams/%2e%2e', '/api/teams/Bad_Name', '/api/teams/%zz', '/api/profiles/..%2Fteams%2Freview-loop']) {
    const x = await request(port, { path: p });
    // WHATWG URL parsing folds %2e%2e into a dot segment, which then misses the route (404); both are safe
    assert.ok(x.status === 400 || x.status === 404, `${p} -> ${x.status}`);
    assert.ok(x.json && x.json.error);
  }
  assert.equal((await request(port, { method: 'PUT', path: '/api/teams/..%2Fx', body: team({ name: 'x' }), headers: H })).status, 400);
  assert.equal(fs.existsSync(path.join(home, 'x.json')), false);
});

test('profiles round trip', async () => {
  const all = (await request(port, { path: '/api/profiles' })).json;
  assert.equal(all.length, 8);
  assert.ok(all.every((p) => p.version === 1 && p.slug));
  const p = { version: 1, slug: 'mine', name: 'Mine', role: 'r', description: 'x', model: 'haiku', tools: ['Read'] };
  assert.equal((await request(port, { method: 'PUT', path: '/api/profiles/mine', body: p, headers: H })).status, 200);
  assert.deepEqual((await request(port, { path: '/api/profiles/mine' })).json, p);
  assert.equal((await request(port, { method: 'DELETE', path: '/api/profiles/mine', headers: H })).status, 200);
  assert.equal((await request(port, { path: '/api/profiles/mine' })).status, 404);
});

test('compile and validate endpoints', async () => {
  const t = team();
  const c = await request(port, { method: 'POST', path: '/api/compile', headers: H, body: { team: t, prompt: 'Do it' } });
  assert.equal(c.status, 200);
  assert.match(c.headers['content-type'], /text\/markdown/);
  assert.match(c.text, /^# Team: T/);
  assert.match(c.text, /## Task\n\nDo it\n$/);
  assert.equal((await request(port, { method: 'POST', path: '/api/compile', headers: H, body: { nope: 1 } })).status, 400);
  const bad = team();
  bad.edges[0].to = 'ghost';
  const v = await request(port, { method: 'POST', path: '/api/validate', headers: H, body: bad });
  assert.equal(v.json.ok, false);
  assert.ok(v.json.problems.some((p) => p.edgeId === 'e1' && p.level === 'error'));
  assert.equal((await request(port, { method: 'POST', path: '/api/validate', headers: H, body: t })).json.ok, true);
});

test('body size limit is 1 MB', async () => {
  const big = JSON.stringify({ team: team(), pad: 'x'.repeat(MAX_BODY) });
  const r = await request(port, { method: 'POST', path: '/api/compile', headers: H, body: big }).catch((e) => ({ status: 'reset', e }));
  assert.ok(r.status === 413 || r.status === 'reset', String(r.status));
  assert.equal((await request(port, { path: '/api/ping' })).status, 200, 'server still alive');
});

test('scope=project writes to the project store', async () => {
  const cwd = tmp();
  const s = await startServer({ port: 0, store: createStore({ home: tmp(), cwd }), editorPath: '/nonexistent' });
  try {
    const t = team({ name: 'proj' });
    assert.equal((await request(s.port, { method: 'PUT', path: '/api/teams/proj?scope=project', body: t, headers: H })).status, 200);
    assert.ok(fs.existsSync(path.join(cwd, '.claude', 'agent-teams', 'teams', 'proj.json')));
    assert.equal((await request(s.port, { path: '/api/teams' })).json.find((x) => x.name === 'proj').scope, 'project');
  } finally { s.server.close(); }
});

test('port fallback: busy port moves to the next one', async () => {
  const blocker = net.createServer();
  await new Promise((r) => blocker.listen(0, '127.0.0.1', r));
  const busy = blocker.address().port;
  const s = await startServer({ port: busy, store: createStore({ home: tmp(), cwd: tmp() }), editorPath: '/nonexistent' });
  try {
    assert.ok(s.port > busy && s.port <= busy + 20, `${s.port} vs ${busy}`);
    assert.equal((await request(s.port, { path: '/api/ping' })).status, 200);
  } finally { s.server.close(); blocker.close(); }
});

test('CLI serve: URL is the first stdout line and nothing precedes it', async () => {
  const child = spawn(process.execPath, [path.join(ROOT, 'bin', 'team.mjs'), 'serve', '--port', '0'], { env: { ...process.env, TEAMS_HOME: tmp() }, cwd: tmp() });
  try {
    const first = await new Promise((resolve, reject) => {
      let buf = '';
      child.stdout.on('data', (d) => { buf += d; if (buf.includes('\n')) resolve(buf); });
      child.on('error', reject);
      setTimeout(() => reject(new Error('no output')), 5000);
    });
    const m = /^http:\/\/127\.0\.0\.1:(\d+)\/\n$/.exec(first);
    assert.ok(m, JSON.stringify(first));
    assert.equal((await request(Number(m[1]), { path: '/api/ping' })).status, 200);
  } finally { child.kill(); }
});
