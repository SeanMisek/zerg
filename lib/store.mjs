// File store for teams and profiles. Global root ($TEAMS_HOME or ~/.claude/agent-teams),
// optional project root (<cwd>/.claude/agent-teams). Slugs are validated before any path is built,
// so a name can never escape the store directory. Writes are atomic (temp file + rename).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isSlug } from './validate.mjs';

export class UserError extends Error {}

const EXAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const KINDS = ['teams', 'profiles'];

export function defaultHome() {
  return process.env.TEAMS_HOME || path.join(os.homedir(), '.claude', 'agent-teams');
}

export function assertSlug(name, what = 'name') {
  if (!isSlug(name)) {
    throw new UserError(`Bad ${what} ${JSON.stringify(String(name))}: use lowercase letters, digits and hyphens (a-z, 0-9, -), starting with a letter or digit, at most 63 characters`);
  }
  return name;
}

function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw e;
  }
}
export { atomicWrite };

export function createStore({ home, cwd } = {}) {
  const globalRoot = path.resolve(home || defaultHome());
  const projectRoot = path.resolve(cwd || process.cwd(), '.claude', 'agent-teams');
  let seeded = false;

  const rootFor = (scope) => (scope === 'project' ? projectRoot : globalRoot);
  const fileFor = (kind, slug, scope) => {
    if (!KINDS.includes(kind)) throw new Error(`unknown kind ${kind}`);
    assertSlug(slug, kind === 'teams' ? 'team name' : 'profile name');
    return path.join(rootFor(scope), kind, `${slug}.json`);
  };

  function seed() {
    if (seeded) return;
    seeded = true;
    const marker = path.join(globalRoot, '.seeded');
    if (fs.existsSync(marker)) return;
    const hasAny = KINDS.some((k) => {
      try { return fs.readdirSync(path.join(globalRoot, k)).some((f) => f.endsWith('.json')); } catch { return false; }
    });
    if (!hasAny) {
      for (const k of KINDS) {
        const src = path.join(EXAMPLES, k);
        let files = [];
        try { files = fs.readdirSync(src).filter((f) => f.endsWith('.json')).sort(); } catch { /* no examples */ }
        for (const f of files) atomicWrite(path.join(globalRoot, k, f), fs.readFileSync(path.join(src, f), 'utf8'));
      }
    }
    atomicWrite(marker, 'seeded from examples/\n');
  }

  function readFile(file) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw new UserError(`Cannot read ${file}: ${e.message}`);
    }
  }

  function scopesInReadOrder() {
    return projectRoot === globalRoot ? ['global'] : ['project', 'global'];
  }

  function read(kind, slug) {
    seed();
    assertSlug(slug, kind === 'teams' ? 'team name' : 'profile name');
    for (const scope of scopesInReadOrder()) {
      const data = readFile(fileFor(kind, slug, scope));
      if (data !== null) return { data, scope };
    }
    return null;
  }

  function list(kind) {
    seed();
    const seen = new Map();
    for (const scope of scopesInReadOrder()) {
      let files = [];
      try { files = fs.readdirSync(path.join(rootFor(scope), kind)); } catch { continue; }
      for (const f of files.sort()) {
        if (!f.endsWith('.json')) continue;
        const slug = f.slice(0, -5);
        if (!isSlug(slug) || seen.has(slug)) continue;
        try {
          const file = path.join(rootFor(scope), kind, f);
          seen.set(slug, { slug, scope, data: JSON.parse(fs.readFileSync(file, 'utf8')), mtimeMs: fs.statSync(file).mtimeMs });
        } catch { /* skip unreadable file */ }
      }
    }
    return [...seen.values()].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  }

  function write(kind, slug, data, { scope = 'global' } = {}) {
    seed();
    const file = fileFor(kind, slug, scope);
    atomicWrite(file, JSON.stringify(data, null, 2) + '\n');
    return file;
  }

  function remove(kind, slug, { scope = 'global' } = {}) {
    seed();
    const file = fileFor(kind, slug, scope);
    try {
      fs.unlinkSync(file);
      return true;
    } catch (e) {
      if (e.code === 'ENOENT') return false;
      throw e;
    }
  }

  return {
    home: globalRoot,
    projectRoot,
    seed,
    listTeams: () => list('teams'),
    readTeam: (n) => read('teams', n),
    writeTeam: (n, d, o) => write('teams', n, d, o),
    removeTeam: (n, o) => remove('teams', n, o),
    listProfiles: () => list('profiles'),
    readProfile: (n) => read('profiles', n),
    writeProfile: (n, d, o) => write('profiles', n, d, o),
    removeProfile: (n, o) => remove('profiles', n, o),
  };
}
