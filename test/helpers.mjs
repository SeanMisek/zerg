import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const tmp = (p = 'ats-') => fs.mkdtempSync(path.join(os.tmpdir(), p));
export const example = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'teams', `${n}.json`), 'utf8'));

export function team(over = {}) {
  return {
    version: 1, name: 't', title: 'T', description: 'd', settings: { maxReviewRounds: 2, parallel: true },
    nodes: [
      { id: 'a', name: 'A', role: 'r', description: 'do a', model: 'inherit', tools: null, isLead: false, x: 0, y: 0 },
      { id: 'b', name: 'B', role: 'r', description: 'do b', model: 'inherit', tools: null, isLead: false, x: 1, y: 1 },
    ],
    edges: [{ id: 'e1', from: 'a', to: 'b', kind: 'delegate', label: '', description: 'a asks b' }],
    ...over,
  };
}

// Raw request so tests can set Host freely (fetch forbids it).
export function request(port, { method = 'GET', path: p = '/', headers = {}, body, host } = {}) {
  return new Promise((resolve, reject) => {
    const h = { Host: host ?? `127.0.0.1:${port}`, ...headers };
    const data = body === undefined ? undefined : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    if (data !== undefined) h['Content-Length'] = Buffer.byteLength(data);
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: h, setHost: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json;
        try { json = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (data !== undefined) req.write(data);
    req.end();
  });
}
