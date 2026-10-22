'use strict';
// Home.md and project hubs: generated marker sections for humans browsing the vault in Obsidian.
const fs = require('node:fs');
const path = require('node:path');
const markers = require('./markers');
const boards = require('./boards');
const templates = require('./templates');
const projects = require('./projects');

const TEXT = {
  en: { cols: ['Project', 'Board', 'In Progress', 'ToDo', 'Bugs', 'Ideas', 'Last activity'], none: '—', board: 'Board', features: 'Features', work: 'Open work', ideas: 'Open ideas', notes: 'Notes' },
  it: { cols: ['Progetto', 'Board', 'In corso', 'ToDo', 'Bug', 'Idee', 'Ultima attività'], none: '—', board: 'Board', features: 'Feature', work: 'Lavoro aperto', ideas: 'Idee aperte', notes: 'Note' },
};
const T = (ctx) => TEXT[ctx.lang] || TEXT.en;
const isLocal = (name) => name.endsWith('.local');

const hubs = (vault) => projects.projectsWithHub(vault);

const boardLink = (ctx, p) => (p && boards.isSplit(ctx, p) ? `[[${p} Plan]]` : `[[${path.basename(ctx.boardFile, '.md')}]]`);

function projectsTable(ctx, items, ideaList, features) {
  const tasks = require('./tasks');
  const hubSet = new Set(hubs(ctx.vault));
  const names = new Set([...hubSet, ...items.map((i) => i.project), ...ideaList.map((i) => i.project)].filter(Boolean));
  for (const b of boards.listBoards(ctx)) if (b.project) names.add(b.project);
  if (!names.size) return T(ctx).none;
  const rows = [...names].sort((a, b) => a.localeCompare(b)).map((p) => {
    const mine = items.filter((i) => i.project === p);
    const count = (st) => mine.filter((i) => i.status === st).length;
    const bugs = mine.filter((i) => i.kind === 'issue' && i.status !== 'completed' && i.status !== 'discarded').length;
    const openIdeas = ideaList.filter((i) => i.project === p && i.state === 'open').length;
    const dates = [...mine.map((i) => tasks.readNote(i.file).data.updated), ...features.filter((f) => f.project === p).map((f) => f.updated)].filter(Boolean).sort();
    return `| ${hubSet.has(p) ? `[[${p}]]` : p} | ${boardLink(ctx, p)} | ${count('in-progress')} | ${count('todo')} | ${bugs} | ${openIdeas} | ${dates[dates.length - 1] || T(ctx).none} |`;
  });
  const cols = T(ctx).cols;
  return [`| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`, ...rows].join('\n');
}

function featureInfo(ctx) {
  const tasks = require('./tasks');
  return tasks.itemFiles(ctx.vault, ['feature']).map((file) => {
    const { data } = tasks.readNote(file);
    return { name: path.basename(file, '.md'), project: tasks.projectOfNote(file, data), lifecycle: data.lifecycle || 'proposed', updated: data.updated };
  });
}

function hubIndex(ctx, p, items, ideaList, features) {
  const t = T(ctx);
  const dir = projects.projectDir(ctx.vault, p);
  const lines = [`${t.board}: ${boardLink(ctx, p)}`];
  const feats = features.filter((f) => f.project === p).sort((a, b) => a.name.localeCompare(b.name));
  if (feats.length) lines.push('', `${t.features}:`, ...feats.map((f) => `- [[${f.name}]] (${f.lifecycle})`));
  const open = items.filter((i) => i.project === p && (i.status === 'in-progress' || i.status === 'todo'));
  if (open.length) lines.push('', `${t.work}:`, ...open.map((i) => `- [[${i.name}]] — ${i.status}${i.blocked ? ' 🔒' : ''}`));
  const openIdeas = ideaList.filter((i) => i.project === p && i.state === 'open').length;
  if (openIdeas) lines.push('', `${t.ideas}: ${openIdeas}`);
  const notes = (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((f) => f.endsWith('.md') && f !== `${p}.md`).map((f) => f.slice(0, -3)).filter((n) => !isLocal(n)).sort();
  if (notes.length) lines.push('', `${t.notes}:`, ...notes.map((n) => `- [[${n}]]`));
  return lines.join('\n');
}

function writeIfChanged(file, text) {
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) fs.writeFileSync(file, text);
}

function rebuildHome(ctx) {
  const tasks = require('./tasks');
  const ideas = require('./ideas');
  const t = T(ctx);
  const items = tasks.listItems(ctx, {}).filter((i) => !isLocal(i.name));
  const ideaList = ideas.listIdeas(ctx, { limit: 0 });
  const features = featureInfo(ctx);
  const homeFile = path.join(ctx.vault, 'Home.md');
  let home = fs.existsSync(homeFile) ? fs.readFileSync(homeFile, 'utf8') : templates.fill(templates.load(ctx.lang, 'Home.md'), { workspace: path.basename(ctx.vault) });

  home = markers.setSection(home, 'projects', projectsTable(ctx, items, ideaList, features));
  const inProgress = items.filter((i) => i.status === 'in-progress');
  home = markers.setSection(home, 'in-progress', inProgress.length ? inProgress.map((i) => `- [[${i.name}]]${i.project ? ` (${i.project})` : ''}${i.blocked ? ' 🔒' : ''}`).join('\n') : t.none);
  let dailies = [];
  try {
    dailies = fs.readdirSync(path.join(ctx.vault, '00_Inbox', 'Daily')).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().reverse();
  } catch {}
  home = markers.setSection(home, 'daily', dailies.length ? dailies.map((f) => `- [[${f.slice(0, -3)}]]`).join('\n') : t.none);
  let decisions = [];
  try {
    decisions = fs.readFileSync(path.join(ctx.vault, 'DECISIONS.md'), 'utf8').split('\n').filter((l) => /^- \d{4}-\d{2}-\d{2}/.test(l) && !/~~/.test(l));
  } catch {}
  home = markers.setSection(home, 'decisions', decisions.length ? decisions.slice(-10).reverse().join('\n') : t.none);
  writeIfChanged(homeFile, home);

  for (const p of hubs(ctx.vault)) {
    const hubFile = projects.findHub(ctx.vault, p);
    writeIfChanged(hubFile, markers.setSection(fs.readFileSync(hubFile, 'utf8'), 'project-index', hubIndex(ctx, p, items, ideaList, features)));
  }
}

module.exports = { rebuildHome, hubs };
