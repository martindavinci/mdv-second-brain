'use strict';
// Active playbooks: a playbook note (`type: playbook`, under 10_Notes/) holds check lines; a project hub links the
// playbooks that govern it (`playbooks:`) and waives what it differs in on purpose (`waive:`). Checks only read files
// of the project's repo: a file contains a text, lacks it, or exists. Nothing is ever run or written in the repo.
//
// Check line:  - `id` — `glob` has|lacks|exists `pattern`   (optional "[ ] ", any trailing note)
// The first wildcard folder of the glob is a unit (`apps-*/app/x.xml` → one unit per apps-* folder); a glob without
// wildcard folders has one unit, the repo ('.').
const fs = require('node:fs');
const path = require('node:path');
const frontmatter = require('./frontmatter');
const projects = require('./projects');
const { unwrapLink, ymd } = require('./names');

const NOTES = '10_Notes';
const MAX_BYTES = 1024 * 1024;
const MAX_FILES = 2000;
const MAX_LINE = 300;
const SKIP = new Set(['.git', 'node_modules', 'build', 'target', 'dist']);
const ID = /^[a-z0-9-]+$/;
const ATTEMPT = /^\s*[-*]\s+(?:\[[ xX]\]\s+)?`([^`]+)`\s*(?:—|–|-|:)\s*`([^`]+)`\s*(.*)$/;
const OP = /^(has|lacks|exists)\b\s*(?:`([^`]*)`)?/;

function pattern(raw) {
  const m = /^\/(.+)\/([a-z]*)$/.exec(raw);
  if (!m) return raw;
  return new RegExp(m[1], m[2].replace(/[gy]/g, ''));
}

function parseChecks(text) {
  const checks = [];
  const broken = [];
  const seen = new Set();
  for (const line of String(text).split(/\r?\n/)) {
    const m = ATTEMPT.exec(line);
    if (!m || !ID.test(m[1])) continue;
    const [, id, glob, rest] = m;
    const op = OP.exec(rest);
    const bad = (reason) => broken.push({ id, line: line.trim(), reason });
    if (!op) {
      bad('expected has, lacks or exists after the path');
      continue;
    }
    if (op[1] !== 'exists' && (op[2] === undefined || op[2] === '')) {
      bad(`${op[1]} needs a \`pattern\``);
      continue;
    }
    if (seen.has(id)) {
      bad('duplicate id');
      continue;
    }
    const c = { id, glob: glob.trim().replace(/\\/g, '/'), op: op[1] };
    if (op[1] !== 'exists') {
      try {
        c.pattern = pattern(op[2]);
      } catch (e) {
        bad(`bad regex: ${e.message}`);
        continue;
      }
    }
    seen.add(id);
    checks.push(c);
  }
  return { checks, broken };
}

const wild = (seg) => /[*?]/.test(seg);
const segRe = (seg) => new RegExp(`^${seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, process.platform === 'win32' ? 'i' : '');

function list(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

// Paths under `base` matching `segs`; the last segment names files (or directories when `dirs`).
function match(base, segs, { dirs = false, budget = { left: MAX_FILES } } = {}) {
  let cur = [''];
  segs.forEach((seg, i) => {
    const last = i === segs.length - 1;
    const want = (e) => (last && !dirs ? e.isFile() : e.isDirectory());
    const next = [];
    for (const rel of cur) {
      if (!wild(seg)) {
        const p = path.join(base, rel, seg);
        let st = null;
        try {
          st = fs.statSync(p);
        } catch {}
        if (st && (last && !dirs ? st.isFile() : st.isDirectory())) next.push(path.join(rel, seg));
        continue;
      }
      const re = segRe(seg);
      for (const e of list(path.join(base, rel))) {
        if (SKIP.has(e.name) || !re.test(e.name) || !want(e)) continue;
        if (budget.left-- <= 0) break;
        next.push(path.join(rel, e.name));
      }
    }
    cur = next;
  });
  return cur.sort();
}

function units(repoDir, glob) {
  const segs = String(glob).replace(/\\/g, '/').split('/').filter(Boolean);
  // the first wildcard folder is the unit (an app of a monorepo); wildcards below it only select files inside it
  let cut = -1;
  for (let i = 0; i < segs.length - 1 && cut < 0; i++) if (wild(segs[i])) cut = i;
  const budget = { left: MAX_FILES };
  if (cut < 0) return [{ unit: '.', files: match(repoDir, segs, { budget }).map((f) => path.join(repoDir, f)) }];
  return match(repoDir, segs.slice(0, cut + 1), { dirs: true, budget }).map((u) => ({
    unit: u.replace(/\\/g, '/'),
    files: match(path.join(repoDir, u), segs.slice(cut + 1), { budget }).map((f) => path.join(repoDir, u, f)),
  }));
}

function head(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(MAX_BYTES);
    const n = fs.readSync(fd, buf, 0, MAX_BYTES, 0);
    return buf.subarray(0, n).toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

const contains = (file, p) => {
  const text = head(file);
  return p instanceof RegExp ? p.test(text) : text.includes(p);
};

function evaluate(repoDir, check) {
  const us = units(repoDir, check.glob);
  if (!us.length) return { ok: false, failing: ['(nothing matches)'] };
  const failing = us
    .filter((u) => {
      if (check.op === 'exists') return !u.files.length;
      const hit = u.files.some((f) => contains(f, check.pattern));
      return check.op === 'has' ? !hit : hit;
    })
    .map((u) => u.unit);
  return { ok: !failing.length, failing };
}

function walk(dir, out = []) {
  for (const e of list(dir)) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

const listOf = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(String).filter(Boolean);

// Playbooks of the vault by lower-case name.
function loadPlaybooks(vault) {
  const out = new Map();
  for (const file of walk(path.join(vault, NOTES))) {
    let parsed;
    try {
      parsed = frontmatter.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    if (parsed.data.type !== 'playbook') continue;
    const name = path.basename(file, '.md');
    out.set(name.toLowerCase(), { name, file, appliesWhen: listOf(parsed.data.applies_when), ...parseChecks(parsed.body) });
  }
  return out;
}

function hubData(vault, project) {
  const file = projects.findHub(vault, project);
  if (!file) return null;
  try {
    return frontmatter.parse(fs.readFileSync(file, 'utf8')).data;
  } catch {
    return null;
  }
}

function waivers(hub) {
  const w = { ids: new Set(), units: new Set(), playbooks: new Set() };
  for (const e of listOf(hub && hub.waive)) {
    const link = unwrapLink(e);
    if (link && /^\[\[/.test(e.trim())) w.playbooks.add(link.toLowerCase());
    else if (e.includes('@')) w.units.add(e);
    else w.ids.add(e);
  }
  return w;
}

const linkedNames = (hub) => listOf(hub && hub.playbooks).map((v) => unwrapLink(v) || v).filter(Boolean);

// One result per linked playbook (declined ones are left out): checks failed with their units, waived ids, broken lines.
function run(vault, hub, repoDir, pbs = loadPlaybooks(vault)) {
  const w = waivers(hub);
  const results = [];
  const ids = new Map();
  for (const name of linkedNames(hub)) {
    if (w.playbooks.has(name.toLowerCase())) continue;
    const p = pbs.get(name.toLowerCase());
    if (!p) {
      results.push({ playbook: name, missing: true, total: 0, failed: [], waived: [], broken: [] });
      continue;
    }
    const r = { playbook: p.name, total: p.checks.length, failed: [], waived: [], broken: [...p.broken] };
    for (const c of p.checks) {
      if (ids.has(c.id)) r.broken.push({ id: c.id, reason: `same id as a check of [[${ids.get(c.id)}]]` });
      ids.set(c.id, p.name);
      if (w.ids.has(c.id)) {
        r.waived.push(c.id);
        continue;
      }
      const units = evaluate(repoDir, c).failing.filter((u) => !w.units.has(`${c.id}@${u}`));
      if (units.length) r.failed.push({ id: c.id, units });
    }
    results.push(r);
  }
  return results;
}

// Playbooks whose applies_when matches the repo, not linked and not declined by the hub.
function suggest(vault, hub, repoDir, pbs = loadPlaybooks(vault)) {
  const w = waivers(hub);
  const linked = new Set(linkedNames(hub).map((n) => n.toLowerCase()));
  return [...pbs.values()]
    .filter((p) => !linked.has(p.name.toLowerCase()) && !w.playbooks.has(p.name.toLowerCase()))
    .filter((p) => p.appliesWhen.some((g) => units(repoDir, g).some((u) => u.files.length)))
    .map((p) => p.name);
}

const clip = (s) => (s.length > MAX_LINE ? `${s.slice(0, MAX_LINE - 1)}…` : s);

function contextLine(results) {
  if (!results || !results.length) return null;
  const parts = results.map((r) => {
    if (r.missing) return `[[${r.playbook}]] — not found in ${NOTES}/`;
    const broken = r.broken.length ? `, ${r.broken.length} broken lines` : '';
    if (!r.failed.length) return `[[${r.playbook}]] — ${r.total} checks ok${broken}`;
    return `[[${r.playbook}]] — ${r.failed.length} of ${r.total} checks failing: ${r.failed.map((f) => `${f.id}${f.units.length && f.units[0] !== '.' ? ` (${f.units.join(', ')})` : ''}`).join(', ')}${broken}`;
  });
  const anyFailed = results.some((r) => r.missing || r.failed.length || r.broken.length);
  const tail = anyFailed ? '; brain check for details' : `; follow ${results.length > 1 ? 'them' : 'it'} for new work and releases`;
  const line = `playbooks: ${parts.join('; ')}`;
  return line.length + tail.length > MAX_LINE ? `${line.slice(0, MAX_LINE - tail.length - 1)}…${tail}` : line + tail;
}

function suggestionLine(names, project, { hub = true } = {}) {
  if (!names || !names.length) return null;
  const how = hub ? `brain project playbook ${project} "${names[0]}"` : `brain project add ${project}, then brain project playbook ${project} "${names[0]}"`;
  return clip(`playbook suggestion: ${names.map((n) => `[[${n}]]`).join(', ')} ${names.length > 1 ? 'match' : 'matches'} this repo; ask the user before ${how}`);
}

function hubFileOf(vault, raw) {
  const p = projects.hubName(vault, raw);
  return { project: p, file: projects.findHub(vault, p) };
}

function setList(vault, raw, key, value, { remove = false, day = ymd() } = {}) {
  const { project, file } = hubFileOf(vault, raw);
  const text = fs.readFileSync(file, 'utf8');
  const list = listOf(frontmatter.parse(text).data[key]);
  const same = (v) => v.toLowerCase() === value.toLowerCase();
  const has = list.some(same);
  if (remove !== has) return { project, changed: false };
  const next = remove ? list.filter((v) => !same(v)) : [...list, value];
  fs.writeFileSync(file, frontmatter.setKeys(text, { [key]: next, updated: day }));
  return { project, changed: true };
}

function link(vault, raw, name, opts = {}) {
  const want = unwrapLink(name) || String(name).trim();
  const p = loadPlaybooks(vault).get(want.toLowerCase());
  if (!p && !opts.remove) throw Object.assign(new Error('no-playbook'), { name: want });
  const r = setList(vault, raw, 'playbooks', `[[${p ? p.name : want}]]`, opts);
  return { ...r, playbook: p ? p.name : want };
}

function setWaive(vault, raw, entry, opts = {}) {
  const e = String(entry).trim();
  if (!/^\[\[[^\]]+\]\]$/.test(e) && !/^[a-z0-9-]+(@\S+)?$/.test(e)) throw Object.assign(new Error('bad-waive'), { entry: e });
  return { ...setList(vault, raw, 'waive', e, opts), entry: e };
}

module.exports = { NOTES, MAX_LINE, parseChecks, units, evaluate, loadPlaybooks, hubData, waivers, run, suggest, contextLine, suggestionLine, link, setWaive };
