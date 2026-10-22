'use strict';
// Project layout: the hub sits next to its folder (20_Projects/<p>.md); the folder (20_Projects/<p>/) holds
// tasks, issues, features and topic notes and exists only once there is one. Older vaults keep the hub inside
// the folder (20_Projects/<p>/<p>.md): it is still read, and `index` moves it out.
const fs = require('node:fs');
const path = require('node:path');
const frontmatter = require('./frontmatter');
const { projectName, unwrapLink, ymd } = require('./names');

const ROOT = '20_Projects';

const projectsRoot = (vault) => path.join(vault, ROOT);
const projectDir = (vault, p) => path.join(vault, ROOT, p);
const hubFile = (vault, p) => path.join(vault, ROOT, `${p}.md`);
const legacyHubFile = (vault, p) => path.join(vault, ROOT, p, `${p}.md`);
const relHub = (p) => `${ROOT}/${p}.md`;

// The hub file that exists (new layout first), or null.
function findHub(vault, p) {
  for (const f of [hubFile(vault, p), legacyHubFile(vault, p)]) if (fs.existsSync(f)) return f;
  return null;
}

function entries(vault) {
  try {
    return fs.readdirSync(projectsRoot(vault), { withFileTypes: true }).filter((e) => !e.name.startsWith('.'));
  } catch {
    return [];
  }
}

// Every project name: a hub file or a folder under 20_Projects.
function projectNames(vault) {
  const names = new Set();
  for (const e of entries(vault)) {
    if (e.isDirectory()) names.add(e.name);
    else if (e.name.endsWith('.md') && !e.name.endsWith('.local.md')) names.add(e.name.slice(0, -3));
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

const projectsWithHub = (vault) => projectNames(vault).filter((p) => findHub(vault, p));

// Moves every hub still inside its folder next to it; drops the folder when nothing else is left in it.
function migrateHubs(vault) {
  const moved = [];
  for (const p of projectNames(vault)) {
    const from = legacyHubFile(vault, p);
    const to = hubFile(vault, p);
    if (!fs.existsSync(from) || fs.existsSync(to)) continue;
    fs.renameSync(from, to);
    for (const extra of [`${p}.local.md`]) {
      const f = path.join(projectDir(vault, p), extra);
      if (fs.existsSync(f) && !fs.existsSync(path.join(projectsRoot(vault), extra))) fs.renameSync(f, path.join(projectsRoot(vault), extra));
    }
    try {
      fs.rmdirSync(projectDir(vault, p));
    } catch {}
    moved.push(p);
  }
  return moved;
}

// Projects with a hub in both places: migrateHubs leaves them alone, the user keeps one.
const hubConflicts = (vault) => projectNames(vault).filter((p) => fs.existsSync(hubFile(vault, p)) && fs.existsSync(legacyHubFile(vault, p)));

// Relation lists in the hub frontmatter ("[[project]]" items), each with the key the other hub gets.
const RELATIONS = { depends_on: 'used_by', used_by: 'depends_on', source_of: 'built_from', built_from: 'source_of', related: 'related' };

// The project's name as its hub spells it.
function hubName(vault, raw) {
  const want = projectName(raw).toLowerCase();
  const p = projectsWithHub(vault).find((n) => n.toLowerCase() === want);
  if (!p) throw Object.assign(new Error('no-hub'), { project: projectName(raw) });
  return p;
}

const linked = (list, p) => list.some((v) => (unwrapLink(v) || '').toLowerCase() === p.toLowerCase());

function relations(vault, p) {
  const { data } = frontmatter.parse(fs.readFileSync(findHub(vault, p), 'utf8'));
  const out = {};
  for (const k of Object.keys(RELATIONS)) out[k] = Array.isArray(data[k]) ? data[k] : data[k] ? [data[k]] : [];
  return out;
}

function setRelation(vault, p, key, other, remove, day) {
  const list = relations(vault, p)[key];
  if (remove !== linked(list, other)) return false;
  const next = remove ? list.filter((v) => (unwrapLink(v) || '').toLowerCase() !== other.toLowerCase()) : [...list, `[[${other}]]`];
  const file = findHub(vault, p);
  fs.writeFileSync(file, frontmatter.setKeys(fs.readFileSync(file, 'utf8'), { [key]: next, updated: day }));
  return true;
}

// a <rel> b, and b <inverse> a: both hubs always agree.
function relate(vault, rawA, rel, rawB, { remove = false, day = ymd() } = {}) {
  if (!RELATIONS[rel]) throw new Error('bad-relation');
  const a = hubName(vault, rawA);
  const b = hubName(vault, rawB);
  if (a === b) throw new Error('bad-relation');
  const changed = [setRelation(vault, a, rel, b, remove, day), setRelation(vault, b, RELATIONS[rel], a, remove, day)].some(Boolean);
  return { a, rel, b, removed: remove, changed };
}

module.exports = { ROOT, RELATIONS, projectsRoot, projectDir, hubFile, legacyHubFile, relHub, findHub, projectNames, projectsWithHub, migrateHubs, hubConflicts, hubName, relations, relate };
