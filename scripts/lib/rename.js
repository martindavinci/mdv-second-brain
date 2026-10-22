'use strict';
// Renames a project: its hub, its folder, the notes named after it (topics, post mortems, split board), its archive,
// and every reference to them in the vault: [[links]], plain `project:` fields, idea headings, the bootstrap record.
const fs = require('node:fs');
const path = require('node:path');
const frontmatter = require('./frontmatter');
const projects = require('./projects');
const { projectName } = require('./names');

const SKIP = new Set(['.brain', '.obsidian', '.git', '.trash']);
const rel = (vault, f) => path.relative(vault, f).replace(/\\/g, '/');

function walk(dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// "alpha — Topic.md" → "omega — Topic.md"; other names stay.
const renamed = (name, from, to) => (name === `${from}.md` || name.startsWith(`${from} `) || name.startsWith(`${from}.`) ? to + name.slice(from.length) : name);

function planRename(ctx, rawFrom, rawTo) {
  const tasks = require('./tasks');
  const vault = ctx.vault;
  const want = projectName(rawFrom).toLowerCase();
  const from = projects.projectNames(vault).find((p) => p.toLowerCase() === want);
  if (!from) throw Object.assign(new Error('unknown-project'), { project: projectName(rawFrom) });
  const to = projectName(rawTo);
  if (to.toLowerCase() === from.toLowerCase()) throw Object.assign(new Error('unknown-project'), { project: to });
  const taken = projects.projectNames(vault).includes(to) ? projects.hubFile(vault, to) : tasks.findNote(vault, to);
  if (taken) throw Object.assign(new Error('name-taken'), { file: taken });

  const moves = [];
  const hub = projects.findHub(vault, from);
  if (hub) moves.push({ from: hub, to: projects.hubFile(vault, to) });
  const local = path.join(projects.projectsRoot(vault), `${from}.local.md`);
  if (fs.existsSync(local)) moves.push({ from: local, to: path.join(projects.projectsRoot(vault), `${to}.local.md`) });
  // the project folder, its split board folder and its archive, file by file; names only change at their top level
  for (const base of [projects.projectsRoot(vault), path.join(vault, '00_Inbox'), path.join(vault, '90_Archive')]) {
    const dir = path.join(base, from);
    for (const file of walk(dir)) {
      if (file === hub) continue;
      const parts = path.relative(dir, file).split(path.sep);
      if (parts.length === 1) parts[0] = renamed(parts[0], from, to);
      moves.push({ from: file, to: path.join(base, to, ...parts) });
    }
  }
  for (const m of moves) {
    const before = path.basename(m.from, '.md');
    const after = path.basename(m.to, '.md');
    if (m.to.endsWith('.md') && before !== after && tasks.findNote(vault, after)) throw Object.assign(new Error('name-taken'), { file: tasks.findNote(vault, after) });
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

function applyRename(ctx, plan) {
  const vault = ctx.vault;
  const { from, to } = plan;
  const names = new Map();
  for (const m of plan.moves) {
    const src = path.join(vault, m.from);
    const dest = path.join(vault, m.to);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(src, dest);
    if (m.to.endsWith('.md')) {
      const before = path.basename(m.from, '.md');
      const after = path.basename(m.to, '.md');
      if (before !== after) names.set(before.toLowerCase(), after);
    }
  }
  // only empty folders are left behind
  for (const base of ['20_Projects', '00_Inbox', '90_Archive']) {
    const dir = path.join(vault, base, from);
    if (fs.existsSync(dir) && !walk(dir).length) fs.rmSync(dir, { recursive: true, force: true });
  }
  const titles = new Map(plan.moves.filter((m) => m.to.endsWith('.md')).map((m) => [path.join(vault, m.to), [path.basename(m.from, '.md'), path.basename(m.to, '.md')]]));
  let linksRewritten = 0;
  for (const file of walk(vault)) {
    if (!file.endsWith('.md')) continue;
    const text = fs.readFileSync(file, 'utf8');
    let next = rewriteLinks(text, names);
    const project = frontmatter.parse(next).data.project;
    if (typeof project === 'string' && project.toLowerCase() === from.toLowerCase()) next = frontmatter.setKeys(next, { project: to });
    const title = titles.get(file);
    if (title && title[0] !== title[1]) next = next.replace(new RegExp(`^# ${title[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'), `# ${title[1]}`);
    if (/(^|\s)Ideas\.md$/.test(path.basename(file))) next = next.replace(new RegExp(`^## ${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'gm'), `## ${to}`);
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
