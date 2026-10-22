'use strict';
// Guided migration of an existing vault, in place: dry run first, move instead of copy, delete nothing.
const fs = require('node:fs');
const path = require('node:path');
const frontmatter = require('./frontmatter');
const board = require('./board');
const git = require('./git');
const { projectName, unwrapLink, parseYmd, ymd } = require('./names');

const KNOWN_TOP = new Set(['00_Daily', '00_Work', '00_Inbox', '10_Notes', '20_Projects', '80_Assets', '90_Archive']);
const KNOWN_ROOT_FILES = new Set(['AGENTS.md', 'WORKFLOW.md', 'TOOLS.md', 'DECISIONS.md', 'MEMORY.md', 'Home.md', 'TASKS.md', 'secrets.local.md', '.gitignore', '.gitattributes']);
const SECTION_STATUS = [
  [/^(now|next|later|inbox|backlog|todo|to do)\b/i, 'todo'],
  [/^(in progress|doing|wip)\b/i, 'in-progress'],
  [/^(done|completed)\b/i, 'completed'],
  [/^(discarded|dropped|cancelled)\b/i, 'discarded'],
];
const KIND_DIR = { feature: 'Features', task: 'Tasks', issue: 'Issues' };
const TASK_STATUSES = new Set(['todo', 'to do', 'to-do', 'in progress', 'in-progress', 'doing', 'wip', 'blocked', 'done', 'completed', 'discarded', 'open', 'closed']);

const posix = (p) => p.split(path.sep).join('/');
const readFm = (file) => {
  try {
    return frontmatter.parse(fs.readFileSync(file, 'utf8')).data;
  } catch {
    return {};
  }
};
const entries = (dir) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => !e.name.startsWith('.'));
  } catch {
    return [];
  }
};

function classify(data) {
  const type = String(data.type || '').toLowerCase();
  const tags = [].concat(data.tags || []).map((t) => String(t).toLowerCase());
  if (['feature', 'system', 'spec'].includes(type)) return 'feature';
  if (['issue', 'bug'].includes(type) || tags.includes('bug') || tags.includes('issue')) return 'issue';
  if (type === 'task') return 'task';
  // only work statuses make a task: PKM ones (evergreen, seedling…) and typed notes stay notes
  if (!type && TASK_STATUSES.has(String(data.status || '').trim().toLowerCase())) return 'task';
  return null;
}

function parseTasksFile(text) {
  const items = [];
  let section = '';
  for (const line of text.split('\n')) {
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) {
      section = h[1].trim();
      continue;
    }
    const m = /^\s*- \[( |x|X)\]\s+(.*\S)\s*$/.exec(line);
    if (!m) continue;
    const fromSection = (SECTION_STATUS.find(([re]) => re.test(section)) || [null, 'todo'])[1];
    items.push({ title: m[2].replace(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, '$1').trim(), status: m[1] === ' ' ? fromSection : 'completed' });
  }
  return items;
}

function planAdopt(src, now = new Date()) {
  const moves = [];
  const untouched = [];
  const conflicts = [];
  const taken = new Set();
  const add = (from, to) => {
    if (fs.existsSync(path.join(src, to)) || taken.has(to.toLowerCase())) conflicts.push({ from, to });
    else {
      moves.push({ from, to });
      taken.add(to.toLowerCase());
    }
  };

  const projects = new Set();
  for (const e of entries(path.join(src, '20_Projects'))) projects.add(e.isDirectory() ? e.name : e.name.replace(/\.md$/, ''));

  for (const e of entries(src)) {
    if (e.isDirectory() ? !KNOWN_TOP.has(e.name) : !KNOWN_ROOT_FILES.has(e.name) && !/ Plan\.md$|^Plan\.md$/.test(e.name)) untouched.push(e.name);
  }

  const today = parseYmd(ymd(now)).getTime();
  for (const e of entries(path.join(src, '00_Daily'))) {
    if (!e.isFile()) {
      untouched.push(`00_Daily/${e.name}`);
      continue;
    }
    const d = parseYmd(e.name);
    const recent = d && Math.round((today - d.getTime()) / 86400000) <= 7;
    add(`00_Daily/${e.name}`, `${recent ? '00_Inbox/Daily' : '90_Archive/Daily'}/${e.name}`);
  }

  let mainBoard = null;
  const boardMoves = new Set();
  for (const dir of ['', '00_Work', '00_Inbox']) {
    for (const e of entries(path.join(src, dir))) {
      if (!e.isFile() || !e.name.endsWith('.md')) continue;
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (readFm(path.join(src, rel))['kanban-plugin'] !== 'board') continue;
      const m = /^(.+) Plan\.md$/.exec(e.name);
      if (m && projects.has(m[1])) {
        const p = projectName(m[1]);
        add(rel, `00_Inbox/${p}/${p} Plan.md`);
        boardMoves.add(rel);
      } else if (!mainBoard) {
        mainBoard = dir === '00_Work' ? `00_Inbox/${e.name}` : rel;
        if (dir === '00_Work') add(rel, mainBoard);
        boardMoves.add(rel);
      }
    }
  }

  for (const e of entries(path.join(src, '00_Work'))) {
    const rel = `00_Work/${e.name}`;
    if (!boardMoves.has(rel)) add(rel, `00_Inbox/${e.name}`);
  }

  for (const e of entries(path.join(src, '10_Notes'))) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    const data = readFm(path.join(src, '10_Notes', e.name));
    const kind = classify(data);
    if (!kind) continue;
    const project = unwrapLink(data.project);
    const dir = project ? `20_Projects/${projectName(project)}/${KIND_DIR[kind]}` : `10_Notes/${KIND_DIR[kind]}`;
    add(`10_Notes/${e.name}`, `${dir}/${e.name}`);
  }

  for (const e of entries(path.join(src, '20_Projects'))) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    const p = e.name.replace(/\.md$/, '');
    add(`20_Projects/${e.name}`, `20_Projects/${p}/${e.name}`);
  }

  let boardLaneMap = {};
  const boardSource = mainBoard && (moves.find((m) => m.to === mainBoard) || { from: mainBoard }).from;
  if (boardSource) {
    for (const lane of board.parseBoard(fs.readFileSync(path.join(src, boardSource), 'utf8')).lanes) boardLaneMap[lane.title] = board.laneStatus(lane.title);
  }

  let tasksFile = null;
  let taskItems = [];
  if (fs.existsSync(path.join(src, 'TASKS.md'))) {
    taskItems = parseTasksFile(fs.readFileSync(path.join(src, 'TASKS.md'), 'utf8'));
    if (taskItems.length) tasksFile = 'TASKS.md';
  }

  return { moves, conflicts, board: mainBoard, boardLaneMap, tasksFile, taskItems, untouched: untouched.sort() };
}

function markdownFiles(dir, out = []) {
  for (const e of entries(dir)) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) markdownFiles(full, out);
    else if (e.name.endsWith('.md')) out.push(full);
  }
  return out;
}

// [[old/path/Name]] → [[Name]] for every moved file.
function rewriteLinks(src, moves) {
  const map = new Map(moves.filter((m) => m.from.endsWith('.md')).map((m) => [m.from.slice(0, -3).toLowerCase(), path.posix.basename(m.to, '.md')]));
  if (!map.size) return 0;
  let changed = 0;
  for (const file of markdownFiles(src)) {
    const text = fs.readFileSync(file, 'utf8');
    const next = text.replace(/\[\[([^\]|#]+)([^\]]*)\]\]/g, (all, target, rest) => {
      const name = map.get(target.trim().replace(/\.md$/, '').toLowerCase());
      return name ? `[[${name}${rest}]]` : all;
    });
    if (next !== text) {
      fs.writeFileSync(file, next);
      changed++;
    }
  }
  return changed;
}

function applyAdopt(cfg, src, ws, plan, cfgFile, { language } = {}) {
  const config = require('./config');
  const vault = require('./vault');
  const tasks = require('./tasks');
  config.assertWorkspaceName(ws);
  const existing = cfg.workspaces[ws] || {};
  cfg.workspaces[ws] = { ...existing, paths: existing.paths || [], vault: src };
  if (plan.board) cfg.workspaces[ws].board = plan.board;
  if (!vault.languageFor(cfg, ws) && !language) throw new Error('language-required');
  // a moved folder moves its notes too: their path links are rewritten like any other
  const linkMoves = [...plan.moves];
  for (const m of plan.moves) {
    const from = path.join(src, m.from);
    if (!fs.existsSync(from) || !fs.statSync(from).isDirectory()) continue;
    for (const f of markdownFiles(from)) {
      const rel = posix(path.relative(from, f));
      linkMoves.push({ from: `${m.from}/${rel}`, to: `${m.to}/${rel}` });
    }
  }
  let moved = 0;
  for (const m of plan.moves) {
    const from = path.join(src, m.from);
    const to = path.join(src, m.to);
    if (!fs.existsSync(from) || fs.existsSync(to)) continue;
    git.moveFile(from, to);
    moved++;
  }
  rewriteLinks(src, linkMoves);
  config.saveConfig(cfg, cfgFile);
  vault.ensureVault(cfg, ws, { language, cfgFile, repair: true });
  const ctx = { vault: src, boardFile: path.join(src, config.boardPathFor(cfg, ws)), lang: vault.languageFor(cfg, ws) || language };
  let tasksCreated = 0;
  if (plan.tasksFile && fs.existsSync(path.join(src, plan.tasksFile))) {
    git.moveFile(path.join(src, plan.tasksFile), path.join(src, plan.tasksFile.replace(/\.md$/, '.legacy.md')));
    for (const item of plan.taskItems) {
      try {
        tasks.addItem(ctx, 'task', item);
        tasksCreated++;
      } catch (e) {
        if (!['name-taken', 'empty-title'].includes(e.message)) throw e;
      }
    }
  }
  tasks.syncFromBoard(ctx);
  require('./indexes').rebuildIndexes(ctx);
  return { moved, tasksCreated };
}

module.exports = { planAdopt, applyAdopt, classify, parseTasksFile, rewriteLinks };
