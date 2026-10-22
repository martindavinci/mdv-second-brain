'use strict';
// Project layout: the hub sits next to its folder (20_Projects/<p>.md); the folder (20_Projects/<p>/) holds
// tasks, issues, features and topic notes and exists only once there is one. Older vaults keep the hub inside
// the folder (20_Projects/<p>/<p>.md): it is still read, and `index` moves it out.
const fs = require('node:fs');
const path = require('node:path');

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

module.exports = { ROOT, projectsRoot, projectDir, hubFile, legacyHubFile, relHub, findHub, projectNames, projectsWithHub, migrateHubs, hubConflicts };
