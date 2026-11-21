// Compiler: team JSON -> orchestration brief (Markdown) or subagent files. Deterministic: no clocks,
// no randomness; same input gives the same bytes. Tolerant of draft teams (edges with unknown ends
// and self loops are skipped), so the editor can preview while the user is still wiring things.

const KIND_ORDER = ['delegate', 'handoff', 'review', 'consult', 'debate'];

export function slugify(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

// Single-line, markup-neutral text for headings, bullets and labels.
export function inline(s) {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[#>\s]+/, '')
    .replace(/\*/g, '\\*')
    .replace(/`/g, "'");
}

const TOOL_OK = /^[A-Za-z0-9_:*()-]+$/;

export function normalize(team) {
  const s = team.settings || {};
  const nodes = (Array.isArray(team.nodes) ? team.nodes : [])
    .filter((n) => n && typeof n === 'object' && typeof n.id === 'string')
    .map((n) => ({
      id: n.id,
      name: inline(n.name ?? n.id) || inline(n.id),
      role: typeof n.role === 'string' ? inline(n.role) : '',
      description: typeof n.description === 'string' ? n.description : '',
      model: n.model || 'inherit',
      tools: Array.isArray(n.tools) ? n.tools.map(String).filter((t) => TOOL_OK.test(t)) : null,
      isLead: n.isLead === true,
      isHead: n.isHead === true,
    }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = (Array.isArray(team.edges) ? team.edges : [])
    .filter((e) => e && byId.has(e.from) && byId.has(e.to) && e.from !== e.to && KIND_ORDER.includes(e.kind))
    .map((e) => ({
      id: String(e.id ?? ''),
      from: e.from,
      to: e.to,
      kind: e.kind,
      label: typeof e.label === 'string' ? inline(e.label) : '',
      description: typeof e.description === 'string' ? e.description : '',
    }));
  return {
    name: typeof team.name === 'string' && team.name ? team.name : 'team',
    title: (typeof team.title === 'string' && inline(team.title)) || inline(team.name) || 'Untitled team',
    description: typeof team.description === 'string' ? team.description.replace(/\r\n/g, '\n').trim() : '',
    settings: {
      maxReviewRounds: Number.isInteger(s.maxReviewRounds) ? s.maxReviewRounds : 2,
      parallel: s.parallel !== false,
    },
    nodes,
    edges,
    byId,
  };
}

// Ordering constraints: delegate/handoff run `from` before `to`; review needs `to`'s output first;
// debate is two-way (a loop); consult is on demand and imposes no order.
function dependencyPairs(edges) {
  const pairs = [];
  for (const e of edges) {
    if (e.kind === 'delegate' || e.kind === 'handoff') pairs.push([e.from, e.to]);
    else if (e.kind === 'review') pairs.push([e.to, e.from]);
    else if (e.kind === 'debate') pairs.push([e.from, e.to], [e.to, e.from]);
  }
  return pairs;
}

// Strongly connected components (iterative Tarjan), then longest-path layers over the condensed
// graph with Kahn's algorithm. Linear time; no recursion, so very long chains are fine.
export function executionPlan(nodes, edges) {
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const adj = new Map(nodes.map((n) => [n.id, []]));
  const pairs = dependencyPairs(edges);
  for (const [a, b] of pairs) adj.get(a).push(b);
  for (const list of adj.values()) list.sort((x, y) => index.get(x) - index.get(y));

  let counter = 0;
  const idx = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const comps = [];
  for (const root of nodes) {
    if (idx.has(root.id)) continue;
    const work = [[root.id, 0]];
    idx.set(root.id, counter);
    low.set(root.id, counter++);
    stack.push(root.id);
    onStack.add(root.id);
    while (work.length) {
      const frame = work[work.length - 1];
      const v = frame[0];
      const outs = adj.get(v);
      if (frame[1] < outs.length) {
        const w = outs[frame[1]++];
        if (!idx.has(w)) {
          idx.set(w, counter);
          low.set(w, counter++);
          stack.push(w);
          onStack.add(w);
          work.push([w, 0]);
        } else if (onStack.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
      } else {
        work.pop();
        if (work.length) {
          const u = work[work.length - 1][0];
          low.set(u, Math.min(low.get(u), low.get(v)));
        }
        if (low.get(v) === idx.get(v)) {
          const comp = [];
          let w;
          do {
            w = stack.pop();
            onStack.delete(w);
            comp.push(w);
          } while (w !== v);
          comp.sort((x, y) => index.get(x) - index.get(y));
          comps.push(comp);
        }
      }
    }
  }

  comps.sort((a, b) => index.get(a[0]) - index.get(b[0]));
  const compOf = new Map();
  comps.forEach((c, i) => c.forEach((id) => compOf.set(id, i)));
  const cAdj = comps.map(() => new Set());
  const indeg = comps.map(() => 0);
  for (const [a, b] of pairs) {
    const ca = compOf.get(a);
    const cb = compOf.get(b);
    if (ca !== cb && !cAdj[ca].has(cb)) {
      cAdj[ca].add(cb);
      indeg[cb]++;
    }
  }
  const level = comps.map(() => 0);
  const queue = [];
  indeg.forEach((d, i) => { if (d === 0) queue.push(i); });
  for (let h = 0; h < queue.length; h++) {
    const a = queue[h];
    for (const b of cAdj[a]) {
      if (level[b] < level[a] + 1) level[b] = level[a] + 1;
      if (--indeg[b] === 0) queue.push(b);
    }
  }
  const layers = [];
  comps.forEach((c, i) => {
    (layers[level[i]] ||= []).push({ ids: c, loop: c.length > 1 });
  });
  return layers.filter(Boolean);
}

function fenceFor(text) {
  const runs = text.match(/`+/g) || [];
  const longest = runs.reduce((m, r) => Math.max(m, r.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}

function kindLine(kind, rounds) {
  switch (kind) {
    case 'delegate': return '`delegate`: **From** assigns work to **To** and waits for the result.';
    case 'handoff': return '`handoff`: **From** finishes, then passes its output to **To** as input (a pipeline step).';
    case 'review': return rounds === 0
      ? '`review`: **From** reviews **To**\'s output and returns concrete feedback once; review rounds are disabled (0), so **To** does not revise in a loop.'
      : `\`review\`: **From** reviews **To**'s output and returns concrete feedback; **To** revises; at most ${rounds} review round${rounds === 1 ? '' : 's'}.`;
    case 'consult': return '`consult`: **From** may ask **To** questions (a one-way ask; the answer returns).';
    case 'debate': return '`debate`: two-way; both state a position, then reconcile; the lead decides ties.';
    default: return '';
  }
}

export function compileBrief(team, { prompt } = {}) {
  const t = normalize(team);
  const { nodes, edges, byId, settings } = t;
  const head = nodes.find((n) => n.isHead);
  const lead = head ? null : nodes.find((n) => n.isLead);
  const spawned = nodes.filter((n) => n !== head);
  const out = [];

  out.push(`# Team: ${t.title}`, '');
  if (t.description) {
    const f = fenceFor(t.description);
    out.push(f + 'markdown', t.description, f, '');
  }

  out.push('## How to run this team', '');
  const steps = [];
  steps.push(head
    ? `The main session is the lead and acts as the head agent **${head.name}**. It is not spawned: the main session itself plays that part${head.description.trim() ? ' (see Head agent below)' : ''}, coordinates the other agents, resolves disagreements and owns the final answer.`
    : lead
    ? `The main session is the lead and takes on the role of **${lead.name}**, following that agent's instructions from the Roster as its own. It coordinates the other agents and owns the final answer.`
    : 'The main session is the lead. It coordinates the agents, resolves disagreements and owns the final answer.');
  steps.push('Spawn each agent in the Roster with the Agent tool. Pass that agent\'s instructions verbatim, plus the Interactions bullets that name it, so it knows who it works with and under what protocol. Use the model and tools given in the Roster where the Agent tool allows it.');
  steps.push('Follow edge direction and kind exactly as written under Interactions. The meaning of each kind in this team:');
  const kinds = KIND_ORDER.filter((k) => edges.some((e) => e.kind === k));
  const nested = kinds.map((k) => `   - ${kindLine(k, settings.maxReviewRounds)}`);
  steps.push(settings.parallel
    ? 'Run independent agents in parallel (several Agent calls in one message). Run an agent only after the agents it depends on have returned.'
    : 'Run agents one at a time, in the suggested execution order. Do not start an agent before the agents it depends on have returned.');
  steps.push(settings.maxReviewRounds === 0
    ? 'Review rounds are disabled (0): run each `review` and `debate` interaction once, apply no revision loop, and state what stayed open.'
    : `For \`review\` and \`debate\` loops stop after ${settings.maxReviewRounds} round${settings.maxReviewRounds === 1 ? '' : 's'}, even if disagreements remain; state what stayed open.`);
  steps.push('When finished, report back what each agent concluded, what changed as a result, and anything unresolved.');
  steps.forEach((s, i) => {
    out.push(`${i + 1}. ${s}`);
    if (i === 2) out.push(...nested);
  });
  out.push('');

  if (head && head.description.trim()) {
    const body = head.description.replace(/\r\n/g, '\n').replace(/\s+$/g, '');
    const f = fenceFor(body);
    out.push('## Head agent (the main session)', '', `You, the main session, act as **${head.name}**. Standing instructions for the lead:`, '', f + 'markdown', body, f, '');
  }

  out.push('## Roster', '');
  if (spawned.length === 0) out.push(head ? '_This team has no spawned agents._' : '_This team has no agents yet._', '');
  spawned.forEach((n, i) => {
    out.push(`### ${i + 1}. ${n.name}${n.isLead ? ' (lead)' : ''}`, '');
    if (n.role) out.push(`- **Role:** ${n.role}`);
    out.push(`- **Model:** ${n.model === 'inherit' ? 'inherit (the session\'s model)' : n.model}`);
    out.push(`- **Tools:** ${n.tools === null ? 'all (inherited)' : n.tools.length ? n.tools.join(', ') : 'none'}`);
    out.push('', 'Instructions (pass verbatim):', '');
    if (n.description.trim() === '') out.push('_(no instructions written)_');
    else {
      const body = n.description.replace(/\r\n/g, '\n').replace(/\s+$/g, '');
      const f = fenceFor(body);
      out.push(f + 'markdown', body, f);
    }
    out.push('');
  });

  out.push('## Interactions', '');
  if (edges.length === 0) out.push('_No interactions are defined._', '');
  else {
    for (const e of edges) {
      const label = e.label ? `, "${e.label}"` : '';
      const desc = e.description.trim().replace(/\s*\n\s*/g, ' ');
      out.push(`- **${byId.get(e.from).name} → ${byId.get(e.to).name}** (${e.kind}${label}): ${desc || '(no protocol written)'}`);
    }
    out.push('');
  }
  out.push('Suggested execution order:', '');
  if (nodes.length === 0) out.push('_(none)_');
  const planEdges = head ? edges.filter((e) => e.from !== head.id && e.to !== head.id) : edges;
  const layers = executionPlan(spawned, planEdges);
  if (head) layers.unshift([{ ids: [head.id], loop: false, head: true }]);
  layers.forEach((layer, i) => {
    const items = layer.map((c) => {
      const names = c.ids.map((id) => byId.get(id).name);
      const r = settings.maxReviewRounds;
      if (c.head) return `${names[0]} (you, not spawned)`;
      return c.loop ? `[loop: ${names.join(' ⇄ ')}; ${r === 0 ? 'run each once, no repeat rounds' : `iterate at most ${r} round${r === 1 ? '' : 's'}, then stop`}]` : names[0];
    });
    const tail = items.length > 1 ? (settings.parallel ? ' (in parallel)' : ' (one after another)') : '';
    out.push(`${i + 1}. ${items.join(', ')}${tail}`);
  });
  const hasConsult = edges.some((e) => e.kind === 'consult');
  if (hasConsult) out.push('', 'Consult targets are asked on demand and do not constrain the order.');
  out.push('');

  out.push('## Task', '');
  const p = typeof prompt === 'string' ? prompt.trim() : '';
  out.push(p || 'The user\'s request follows this brief. Treat it as the task for this team.', '');
  return out.join('\n');
}

export function agentFileNames(team) {
  const t = normalize(team);
  const used = new Set();
  const map = new Map();
  for (const n of t.nodes) {
    if (n.isHead) continue;
    const base = slugify(n.name) || slugify(n.id) || 'agent';
    let slug = base;
    for (let k = 2; used.has(slug); k++) slug = `${base}-${k}`;
    used.add(slug);
    map.set(n.id, `${t.name}-${slug}`);
  }
  return map;
}

export function compileAgents(team) {
  const t = normalize(team);
  const names = agentFileNames(team);
  const q = (s) => JSON.stringify(s.replace(/\s*\n\s*/g, ' ').trim());
  return t.nodes.filter((n) => !n.isHead).map((n) => {
    const agent = names.get(n.id);
    const fm = ['---', `name: ${agent}`, `description: ${q(n.role || `${n.name} in the team ${t.title}`)}`];
    if (n.tools !== null) fm.push(`tools: ${n.tools.join(', ')}`);
    if (n.model !== 'inherit') fm.push(`model: ${n.model}`);
    fm.push('---', '');
    const body = [n.description.trim() || `You are ${n.name}.`, ''];
    const mine = t.edges.filter((e) => e.from === n.id || e.to === n.id);
    if (mine.length) {
      body.push(`## Interactions in team "${t.title}"`, '');
      for (const e of mine) {
        const out = e.from === n.id;
        const other = t.byId.get(out ? e.to : e.from);
        const label = e.label ? `, "${e.label}"` : '';
        const desc = e.description.trim().replace(/\s*\n\s*/g, ' ') || '(no protocol written)';
        const who = other.isHead ? 'the main session' : `agent \`${names.get(other.id)}\``;
        body.push(`- **${out ? 'To' : 'From'} ${other.name}** (${who}; ${e.kind}${label}): ${desc}`);
      }
      body.push('');
    }
    return { file: `${agent}.md`, name: agent, content: fm.join('\n') + body.join('\n') };
  });
}
