'use strict';
// Renames a project: its hub, its folder, the notes named after it (topics, post mortems, split board), its archive,
// and every reference to them in the vault: [[links]], plain `project:` fields, idea headings, the bootstrap record.
const fs = require('node:fs');
const path = require('node:path');
const frontmatter = require('./frontmatter');
const projects = require('./projects');
const { projectName } = require('./names');

// Link rewriting leaves tool folders alone; moving a project folder takes everything in it.
const SKIP = new Set(['.brain', '.obsidian', '.git', '.trash']);
const rel = (vault, f) => path.relative(vault, f).replace(/\\/g, '/');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function walk(dir, { all = false } = {}, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!all && SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, { all }, out);
    else out.push(full);
  }
  return out;
}

// Folders only, bottom-up, and only when nothing is left in them.
function removeEmpty(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) if (e.isDirectory()) removeEmpty(path.join(dir, e.name));
  try {
    if (!fs.readdirSync(dir).length) fs.rmdirSync(dir);
  } catch {}
}

const taken = (file) => Object.assign(new Error('name-taken'), { file });

// "alpha — Topic.md" → "omega — Topic.md"; other names stay.
const renamed = (name, from, to) => (name === `${from}.md` || name.startsWith(`${from} `) || name.startsWith(`${from}.`) ? to + name.slice(from.length) : name);

const BASES = (vault) => [projects.projectsRoot(vault), path.join(vault, '00_Inbox'), path.join(vault, '90_Archive')];

function planRename(ctx, rawFrom, rawTo) {
  const tasks = require('./tasks');
  const vault = ctx.vault;
  const want = projectName(rawFrom).toLowerCase();
  const from = projects.projectNames(vault).find((p) => p.toLowerCase() === want);
  if (!from) throw Object.assign(new Error('unknown-project'), { project: projectName(rawFrom) });
  const to = projectName(rawTo);
  if (to.toLowerCase() === from.toLowerCase()) throw Object.assign(new Error('unknown-project'), { project: to });
  // the new name must be free everywhere a project lives, whatever the case: nothing is ever merged or overwritten
  for (const base of BASES(vault)) {
    let names = [];
    try {
      names = fs.readdirSync(base);
    } catch {}
    const clash = names.find((n) => n.toLowerCase() === to.toLowerCase() || n.toLowerCase() === `${to}.md`.toLowerCase());
    if (clash) throw taken(path.join(base, clash));
  }
  const note = tasks.findNote(vault, to);
  if (note) throw taken(note);

  const moves = [];
  const hub = projects.findHub(vault, from);
  if (hub) moves.push({ from: hub, to: projects.hubFile(vault, to) });
  const local = path.join(projects.projectsRoot(vault), `${from}.local.md`);
  if (fs.existsSync(local)) moves.push({ from: local, to: path.join(projects.projectsRoot(vault), `${to}.local.md`) });
  // the project folder, its split board folder and its archive, file by file; names only change at their top level
  for (const base of BASES(vault)) {
    const dir = path.join(base, from);
    for (const file of walk(dir, { all: true })) {
      if (file === hub) continue;
      const parts = path.relative(dir, file).split(path.sep);
      if (parts.length === 1) parts[0] = renamed(parts[0], from, to);
      moves.push({ from: file, to: path.join(base, to, ...parts) });
    }
  }
  for (const m of moves) {
    if (fs.existsSync(m.to)) throw taken(m.to);
    const before = path.basename(m.from, '.md');
    const after = path.basename(m.to, '.md');
    if (m.to.endsWith('.md') && before !== after && tasks.findNote(vault, after)) throw taken(tasks.findNote(vault, after));
  }
  return { from, to, moves: moves.map((m) => ({ from: rel(vault, m.from), to: rel(vault, m.to) })) };
}

function rewriteLinks(text, names) {
  return text.replace(/\[\[([^\]|#]+)([^\]]*)\]\]/g, (all, target, rest) => {
    const t = target.trim().replace(/\.md$/i, '');
    const name = names.get(t.toLowerCase()) || names.get(t.split('/').pop().toLowerCase());
    return name ? `[[${name}${rest}]]` : all;
  });
}

// Every move, or none: a failure half way (a file held open by a sync tool) puts the moved files back.
function moveAll(vault, moves) {
  const done = [];
  try {
    for (const m of moves) {
      const src = path.join(vault, m.from);
      const dest = path.join(vault, m.to);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.renameSync(src, dest);
      done.push([src, dest]);
    }
  } catch (e) {
    for (const [src, dest] of done.reverse()) {
      try {
        fs.mkdirSync(path.dirname(src), { recursive: true });
        fs.renameSync(dest, src);
      } catch {}
    }
    for (const m of moves) removeEmpty(path.join(vault, m.to.split('/').slice(0, 2).join('/')));
    throw e;
  }
}

function applyRename(ctx, plan) {
  const vault = ctx.vault;
  const { from, to } = plan;
  moveAll(vault, plan.moves);
  // the project itself, hub or not, and every note that carried its name
  const names = new Map([[from.toLowerCase(), to]]);
  for (const m of plan.moves) {
    const before = path.basename(m.from, '.md');
    const after = path.basename(m.to, '.md');
    if (m.to.endsWith('.md') && before !== after) names.set(before.toLowerCase(), after);
  }
  for (const base of BASES(vault)) removeEmpty(path.join(base, from));
  const titles = new Map(plan.moves.filter((m) => m.to.endsWith('.md')).map((m) => [path.join(vault, m.to), [path.basename(m.from, '.md'), path.basename(m.to, '.md')]]));
  let linksRewritten = 0;
  for (const file of walk(vault)) {
    if (!file.endsWith('.md')) continue;
    const text = fs.readFileSync(file, 'utf8');
    let next = rewriteLinks(text, names);
    const project = frontmatter.parse(next).data.project;
    if (typeof project === 'string' && !project.trim().startsWith('[[') && project.toLowerCase() === from.toLowerCase()) next = frontmatter.setKeys(next, { project: to });
    const title = titles.get(file);
    if (title && title[0] !== title[1]) next = next.replace(new RegExp(`^# ${esc(title[0])}$`, 'm'), () => `# ${title[1]}`);
    if (/(^|\s)Ideas\.md$/.test(path.basename(file))) next = next.replace(new RegExp(`^## ${esc(from)}$`, 'gmi'), () => `## ${to}`);
    if (next !== text) {
      fs.writeFileSync(file, next);
      if (rewriteLinks(text, names) !== text) linksRewritten++;
    }
  }
  const repos = require('./repos');
  const record = repos.readRecord(vault);
  if (record[from]) {
    record[to] = record[from];
    delete record[from];
    repos.writeRecord(vault, record);
  }
  return { from, to, moved: plan.moves.length, linksRewritten };
}

module.exports = { planRename, applyRename, rewriteLinks };
