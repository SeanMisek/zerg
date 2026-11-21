// Validation for team and profile objects: shape errors plus graph problems.
// Pure, zero dependencies. A problem is { level: "error"|"warning", message, nodeId?, edgeId? }.

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const EDGE_KINDS = ['delegate', 'handoff', 'review', 'consult', 'debate'];
export const MODELS = ['inherit', 'opus', 'sonnet', 'haiku'];
export const LIMITS = { nodes: 64, edges: 256, text: 50000, name: 80, label: 24 };
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
export const TOOL_RE = /^[A-Za-z0-9_:*()-]+$/;
const CTRL_RE = /[\u0000-\u001f\u007f\u0085\u2028\u2029]/;

export function isSlug(s) {
  return typeof s === 'string' && SLUG_RE.test(s);
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function checkNodeShape(n, where, out, nodeId) {
  const add = (message) => out.push({ level: 'error', message: `${where}: ${message}`, ...(nodeId ? { nodeId } : {}) });
  if (typeof n.name !== 'string' || n.name.trim() === '') add('"name" must be a non-empty string');
  else if (n.name.length > LIMITS.name) add(`"name" is longer than ${LIMITS.name} characters`);
  else if (CTRL_RE.test(n.name)) add('"name" must not contain control characters or line breaks');
  if (n.role !== undefined && typeof n.role !== 'string') add('"role" must be a string');
  else if (typeof n.role === 'string' && CTRL_RE.test(n.role)) add('"role" must not contain control characters or line breaks');
  if (n.description !== undefined && typeof n.description !== 'string') add('"description" must be a string');
  else if (typeof n.description === 'string' && n.description.length > LIMITS.text) add('"description" is too long');
  if (n.model !== undefined && !MODELS.includes(n.model)) add(`"model" must be one of ${MODELS.join(', ')}`);
  if (n.tools !== undefined && n.tools !== null) {
    if (!Array.isArray(n.tools) || n.tools.some((t) => typeof t !== 'string' || t.trim() === '')) {
      add('"tools" must be null or an array of non-empty strings');
    } else if (n.tools.some((t) => !TOOL_RE.test(t))) {
      add('"tools" entries may only contain letters, digits and _ : * ( ) -');
    }
  }
  if (n.profile !== undefined && n.profile !== null && !isSlug(n.profile)) add('"profile" must be a slug');
}

export function validateTeam(team) {
  const problems = [];
  const error = (message, extra = {}) => problems.push({ level: 'error', message, ...extra });
  const warn = (message, extra = {}) => problems.push({ level: 'warning', message, ...extra });
  const done = () => ({ ok: !problems.some((p) => p.level === 'error'), problems });

  if (!isObj(team)) {
    error('A team must be a JSON object');
    return done();
  }
  if (team.version !== 1) error('"version" must be 1');
  if (!isSlug(team.name)) error('"name" must be a slug: lowercase letters, digits and hyphens, starting with a letter or digit, at most 63 characters');
  if (team.title !== undefined && typeof team.title !== 'string') error('"title" must be a string');
  else if (typeof team.title === 'string' && CTRL_RE.test(team.title)) error('"title" must not contain control characters or line breaks');
  if (team.description !== undefined && typeof team.description !== 'string') error('"description" must be a string');
  if (team.settings !== undefined) {
    if (!isObj(team.settings)) error('"settings" must be an object');
    else {
      const m = team.settings.maxReviewRounds;
      if (m !== undefined && !(Number.isInteger(m) && m >= 0 && m <= 10)) error('"settings.maxReviewRounds" must be an integer from 0 to 10');
      if (team.settings.parallel !== undefined && typeof team.settings.parallel !== 'boolean') error('"settings.parallel" must be true or false');
    }
  }
  if (!Array.isArray(team.nodes)) {
    error('"nodes" must be an array');
    return done();
  }
  if (!Array.isArray(team.edges)) {
    error('"edges" must be an array');
    return done();
  }
  if (team.nodes.length > LIMITS.nodes) error(`Too many nodes (limit ${LIMITS.nodes})`);
  if (team.edges.length > LIMITS.edges) error(`Too many edges (limit ${LIMITS.edges})`);

  const nodeIds = new Set();
  const dupNodes = new Set();
  const leads = [];
  const heads = [];
  team.nodes.forEach((n, i) => {
    const where = `nodes[${i}]`;
    if (!isObj(n)) return error(`${where} must be an object`);
    if (typeof n.id !== 'string' || !ID_RE.test(n.id)) {
      return error(`${where}: "id" must be a string of letters, digits, "_" or "-" (1-40 characters)`);
    }
    if (nodeIds.has(n.id) && !dupNodes.has(n.id)) {
      dupNodes.add(n.id);
      error(`Duplicate node id "${n.id}"`, { nodeId: n.id });
    }
    nodeIds.add(n.id);
    checkNodeShape(n, `${where} (${n.id})`, problems, n.id);
    if (n.isLead !== undefined && typeof n.isLead !== 'boolean') error(`${where} (${n.id}): "isLead" must be true or false`, { nodeId: n.id });
    if (n.isLead === true) leads.push(n);
    if (n.isHead !== undefined && typeof n.isHead !== 'boolean') error(`${where} (${n.id}): "isHead" must be true or false`, { nodeId: n.id });
    if (n.isHead === true) heads.push(n);
    if (n.isHead === true && n.isLead === true) error(`Node "${n.name || n.id}" cannot be both the head (main session) and the lead`, { nodeId: n.id });
    for (const k of ['x', 'y']) {
      if (n[k] !== undefined && !Number.isFinite(n[k])) error(`${where} (${n.id}): "${k}" must be a finite number`, { nodeId: n.id });
    }
    if (n.isHead !== true && (typeof n.description !== 'string' || n.description.trim() === '')) {
      warn(`Node "${n.name || n.id}" has an empty description (its instructions)`, { nodeId: n.id });
    }
  });
  if (leads.length > 1) {
    error(`Only one node may be the lead; found ${leads.length}: ${leads.map((n) => n.name || n.id).join(', ')}`, { nodeId: leads[1].id });
  }

  if (heads.length > 1) {
    error(`Only one node may be the head; found ${heads.length}: ${heads.map((n) => n.name || n.id).join(', ')}`, { nodeId: heads[1].id });
  }

  const edgeIds = new Set();
  const outgoing = new Set();
  const dupEdges = new Set();
  const touched = new Set();
  team.edges.forEach((e, i) => {
    const where = `edges[${i}]`;
    if (!isObj(e)) return error(`${where} must be an object`);
    if (typeof e.id !== 'string' || !ID_RE.test(e.id)) {
      return error(`${where}: "id" must be a string of letters, digits, "_" or "-" (1-40 characters)`);
    }
    if (edgeIds.has(e.id) && !dupEdges.has(e.id)) {
      dupEdges.add(e.id);
      error(`Duplicate edge id "${e.id}"`, { edgeId: e.id });
    }
    edgeIds.add(e.id);
    const eerr = (m) => error(`${where} (${e.id}): ${m}`, { edgeId: e.id });
    if (!EDGE_KINDS.includes(e.kind)) eerr(`"kind" must be one of ${EDGE_KINDS.join(', ')}`);
    if (e.polarity !== undefined && e.polarity !== 'positive' && e.polarity !== 'negative') eerr('"polarity" must be "positive" or "negative"');
    if (e.label !== undefined && typeof e.label !== 'string') eerr('"label" must be a string');
    else if (typeof e.label === 'string' && e.label.length > LIMITS.label) eerr(`"label" is longer than ${LIMITS.label} characters`);
    else if (typeof e.label === 'string' && CTRL_RE.test(e.label)) eerr('"label" must not contain control characters or line breaks');
    if (e.description !== undefined && typeof e.description !== 'string') eerr('"description" must be a string');
    else if (typeof e.description === 'string' && e.description.length > LIMITS.text) eerr('"description" is too long');
    let ends = true;
    for (const k of ['from', 'to']) {
      if (typeof e[k] !== 'string') {
        eerr(`"${k}" must be a node id`);
        ends = false;
      } else if (!nodeIds.has(e[k])) {
        error(`Edge ${e.id} has an unknown "${k}" node "${e[k]}"`, { edgeId: e.id });
        ends = false;
      }
    }
    if (ends && e.from === e.to) {
      error(`Edge ${e.id} connects node "${e.from}" to itself`, { edgeId: e.id });
      ends = false;
    }
    if (ends) {
      outgoing.add(e.from);
      touched.add(e.from);
      touched.add(e.to);
    }
    if (typeof e.description !== 'string' || e.description.trim() === '') {
      warn(`Edge ${e.id} has an empty description (the protocol between the two agents)`, { edgeId: e.id });
    }
  });

  for (const h of heads) {
    if (!outgoing.has(h.id)) warn(`Head node "${h.name || h.id}" has no outgoing edges, so it delegates to nobody`, { nodeId: h.id });
  }
  if (team.nodes.length > 1) {
    for (const n of team.nodes) {
      if (isObj(n) && typeof n.id === 'string' && !touched.has(n.id) && !dupNodes.has(n.id)) {
        warn(`Node "${n.name || n.id}" is not connected to any other node`, { nodeId: n.id });
      }
    }
  }
  const names = new Map();
  for (const n of team.nodes) {
    if (!isObj(n) || typeof n.name !== 'string') continue;
    const k = n.name.trim().toLowerCase();
    if (names.has(k)) warn(`Nodes "${names.get(k)}" and "${n.id}" share the name "${n.name}"`, { nodeId: n.id });
    else names.set(k, n.id);
  }
  return done();
}

export function validateProfile(p) {
  const problems = [];
  const error = (message) => problems.push({ level: 'error', message });
  if (!isObj(p)) {
    error('A profile must be a JSON object');
    return { ok: false, problems };
  }
  if (p.version !== 1) error('"version" must be 1');
  if (!isSlug(p.slug)) error('"slug" must be a slug: lowercase letters, digits and hyphens, at most 63 characters');
  checkNodeShape(p, 'profile', problems);
  if (p.isHead === true) error('The head node cannot be saved as a profile');
  if (typeof p.description !== 'string' || p.description.trim() === '') {
    problems.push({ level: 'warning', message: 'Profile has an empty description (its instructions)' });
  }
  return { ok: !problems.some((q) => q.level === 'error'), problems };
}

export function formatProblems(problems) {
  return problems.map((p) => `${p.level}: ${p.message}`).join('\n');
}

// Hard size limits only (no graph rules), for tolerant callers such as the live brief preview.
export function checkLimits(team) {
  const bad = [];
  if (!isObj(team) || !Array.isArray(team.nodes) || !Array.isArray(team.edges)) return ['"nodes" and "edges" must be arrays'];
  const over = (v, max, what) => { if (typeof v === 'string' && v.length > max) bad.push(`${what} is longer than ${max} characters`); };
  if (team.nodes.length > LIMITS.nodes) bad.push(`Too many nodes (limit ${LIMITS.nodes})`);
  if (team.edges.length > LIMITS.edges) bad.push(`Too many edges (limit ${LIMITS.edges})`);
  over(team.title, LIMITS.name * 2, '"title"');
  over(team.description, LIMITS.text, '"description"');
  team.nodes.slice(0, LIMITS.nodes + 1).forEach((n, i) => {
    if (!isObj(n)) return;
    over(n.id, 40, `nodes[${i}].id`);
    over(n.name, LIMITS.name, `nodes[${i}].name`);
    over(n.role, LIMITS.text, `nodes[${i}].role`);
    over(n.description, LIMITS.text, `nodes[${i}].description`);
    if (Array.isArray(n.tools) && n.tools.length > 200) bad.push(`nodes[${i}].tools has too many entries`);
  });
  team.edges.slice(0, LIMITS.edges + 1).forEach((e, i) => {
    if (!isObj(e)) return;
    over(e.id, 40, `edges[${i}].id`);
    over(e.label, LIMITS.label, `edges[${i}].label`);
    over(e.description, LIMITS.text, `edges[${i}].description`);
  });
  return bad;
}
