// Local JSON API + static editor. Binds 127.0.0.1 only. Zero dependencies.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, UserError } from '../lib/store.mjs';
import { validateTeam, validateProfile, isSlug, checkLimits } from '../lib/validate.mjs';
import { compileBrief } from '../lib/compile.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const EDITOR = path.join(ROOT, 'editor', 'index.html');
export const MAX_BODY = 1024 * 1024;

const PLACEHOLDER = `<!doctype html><meta charset="utf-8"><title>Agent Team Studio</title>
<body style="font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem">
<h1 style="font-size:1.4rem">Agent Team Studio</h1>
<p>The server is running, but <code>editor/index.html</code> does not exist yet. The API is available at
<a href="/api/ping">/api/ping</a>.</p></body>`;

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const buf = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(buf);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', (c) => {
      if (failed) return;
      size += c.length;
      if (size > MAX_BODY) {
        failed = true;
        reject(new HttpError(413, 'Request body is larger than 1 MB'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (failed) return;
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(text === '' ? undefined : JSON.parse(text));
      } catch {
        reject(new HttpError(400, 'Body is not valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function slugParam(raw, what) {
  let s;
  try { s = decodeURIComponent(raw); } catch { throw new HttpError(400, `Bad ${what}`); }
  if (!isSlug(s)) throw new HttpError(400, `Bad ${what} ${JSON.stringify(s)}: use lowercase letters, digits and hyphens`);
  return s;
}

export function createHandler({ store, getPort, editorPath = EDITOR }) {
  return async function handler(req, res) {
    try {
      const port = getPort();
      const host = String(req.headers.host || '').toLowerCase();
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) throw new HttpError(403, 'Forbidden: bad Host header');
      const method = req.method;
      if (method !== 'GET' && method !== 'HEAD' && req.headers['x-team-studio'] !== '1') {
        throw new HttpError(403, 'Forbidden: missing X-Team-Studio header');
      }
      const url = new URL(req.url, 'http://local');
      const parts = url.pathname.split('/').filter(Boolean);
      const scope = url.searchParams.get('scope') === 'project' ? 'project' : 'global';

      if (method === 'OPTIONS') throw new HttpError(403, 'Forbidden');

      if ((method === 'GET' || method === 'HEAD') && (url.pathname === '/' || url.pathname === '/index.html')) {
        let html;
        try { html = fs.readFileSync(editorPath, 'utf8'); } catch { html = PLACEHOLDER; }
        return send(res, 200, method === 'HEAD' ? '' : html, 'text/html; charset=utf-8');
      }
      if (parts[0] !== 'api') throw new HttpError(404, 'Not found');
      const [, resource, rawName] = parts;
      if (parts.length > 3) throw new HttpError(404, 'Not found');

      if (resource === 'ping' && method === 'GET' && !rawName) {
        return send(res, 200, { ok: true, version: 1, home: store.home });
      }
      if (resource === 'compile' && method === 'POST' && !rawName) {
        const body = await readBody(req);
        const team = body && body.team;
        if (!team || typeof team !== 'object' || !Array.isArray(team.nodes) || !Array.isArray(team.edges)) {
          throw new HttpError(400, 'Body must be { "team": {nodes: [], edges: []}, "prompt"?: string }');
        }
        const over = checkLimits(team);
        if (over.length) throw new HttpError(400, `Team exceeds limits: ${over[0]}`);
        return send(res, 200, compileBrief(team, { prompt: body.prompt }), 'text/markdown; charset=utf-8');
      }
      if (resource === 'validate' && method === 'POST' && !rawName) {
        const body = await readBody(req);
        return send(res, 200, validateTeam(body));
      }

      if (resource === 'teams' || resource === 'profiles') {
        const isTeam = resource === 'teams';
        const what = isTeam ? 'team name' : 'profile name';
        if (!rawName) {
          if (method !== 'GET') throw new HttpError(405, 'Method not allowed');
          if (isTeam) {
            return send(res, 200, store.listTeams().map(({ slug, scope: sc, data }) => ({
              name: slug,
              title: data.title ?? '',
              description: data.description ?? '',
              nodes: Array.isArray(data.nodes) ? data.nodes.length : 0,
              edges: Array.isArray(data.edges) ? data.edges.length : 0,
              scope: sc,
            })));
          }
          return send(res, 200, store.listProfiles().map((p) => p.data));
        }
        const name = slugParam(rawName, what);
        if (method === 'GET') {
          const hit = isTeam ? store.readTeam(name) : store.readProfile(name);
          if (!hit) throw new HttpError(404, `No ${isTeam ? 'team' : 'profile'} named "${name}"`);
          return send(res, 200, hit.data);
        }
        if (method === 'PUT') {
          const body = await readBody(req);
          if (body && typeof body === 'object' && !Array.isArray(body)) {
            const key = isTeam ? 'name' : 'slug';
            if (body[key] !== undefined && body[key] !== name) {
              throw new HttpError(400, `"${key}" in the body (${JSON.stringify(body[key])}) does not match the URL (${JSON.stringify(name)})`);
            }
          }
          const result = isTeam ? validateTeam(body) : validateProfile(body);
          if (!result.ok) {
            const first = result.problems.find((p) => p.level === 'error');
            throw new HttpError(400, `Invalid ${isTeam ? 'team' : 'profile'}: ${first.message}`, { problems: result.problems });
          }
          if (isTeam) store.writeTeam(name, body, { scope }); else store.writeProfile(name, body, { scope });
          return send(res, 200, { ok: true, name, scope, problems: result.problems });
        }
        if (method === 'DELETE') {
          const ok = isTeam ? store.removeTeam(name, { scope }) : store.removeProfile(name, { scope });
          if (!ok) throw new HttpError(404, `No ${isTeam ? 'team' : 'profile'} named "${name}" in the ${scope} store`);
          return send(res, 200, { ok: true });
        }
        throw new HttpError(405, 'Method not allowed');
      }
      throw new HttpError(404, 'Not found');
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message, ...(e.extra || {}) });
      if (e instanceof UserError) return send(res, 400, { error: e.message });
      console.error(e);
      return send(res, 500, { error: 'Internal error' });
    }
  };
}

// Listens on 127.0.0.1. port 0 = any free port (no retry). Otherwise tries port..port+20.
export function startServer({ port = 4317, store = createStore(), editorPath = EDITOR } = {}) {
  let actual = port;
  const server = http.createServer(createHandler({ store, getPort: () => actual, editorPath }));
  server.requestTimeout = 30000;
  const last = port === 0 ? 0 : port + 20;
  return new Promise((resolve, reject) => {
    const attempt = (p) => {
      const onError = (err) => {
        server.removeListener('listening', onListening);
        if (err.code === 'EADDRINUSE' && p < last) attempt(p + 1);
        else reject(err);
      };
      const onListening = () => {
        server.removeListener('error', onError);
        actual = server.address().port;
        resolve({ server, port: actual, url: `http://127.0.0.1:${actual}/`, store });
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(p, '127.0.0.1');
    };
    attempt(port);
  });
}
