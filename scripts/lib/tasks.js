'use strict';
const fs = require('node:fs');
const path = require('node:path');
const board = require('./board');
const boards = require('./boards');
const frontmatter = require('./frontmatter');
const templates = require('./templates');
const git = require('./git');
const state = require('./state');
const { noteName, projectName, unwrapLink, ymd, parseYmd } = require('./names');

const KINDS = { task: 'Tasks', issue: 'Issues', feature: 'Features' };
const ITEM_KINDS = ['task', 'issue'];
const SKIP_TOP = new Set(['90_Archive', '80_Assets', 'node_modules']);
const LIST_ORDER = ['in-progress', 'todo', 'completed', 'discarded'];

const today = (ctx) => ymd(ctx.now || new Date());
const lower = (s) => s.toLowerCase();
const nameOf = (file) => path.basename(file, '.md');

function itemDir(vault, kind, project) {
  return project ? path.join(vault, '20_Projects', projectName(project), KINDS[kind]) : path.join(vault, '10_Notes', KINDS[kind]);
}

function archiveDir(vault, file) {
  const rel = path.relative(vault, path.dirname(file)).split(path.sep);
  if (rel[0] === '20_Projects') return path.join(vault, '90_Archive', ...rel.slice(1));
  if (rel[0] === '10_Notes') return path.join(vault, '90_Archive', ...rel.slice(1));
  return path.join(vault, '90_Archive', ...rel);
}

// Every note of the vault except the archive, assets and hidden folders: name (lower) → file.
function scanNotes(vault) {
  const map = new Map();
  const walk = (dir, top) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!(top && SKIP_TOP.has(e.name))) walk(full, false);
      } else if (e.name.endsWith('.md') && !map.has(lower(nameOf(e.name)))) map.set(lower(nameOf(e.name)), full);
    }
  };
  walk(vault, true);
  return map;
}

function findNote(vault, name) {
  return scanNotes(vault).get(lower(String(name))) || null;
}

// Files in every Tasks/ and Issues/ folder (10_Notes and each project).
function itemFiles(vault, kinds = ITEM_KINDS) {
  const dirs = [];
  for (const k of kinds) dirs.push(path.join(vault, '10_Notes', KINDS[k]));
  let projects = [];
  try {
    projects = fs.readdirSync(path.join(vault, '20_Projects'), { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch {}
  for (const p of projects) for (const k of kinds) dirs.push(path.join(vault, '20_Projects', p.name, KINDS[k]));
  const out = [];
  for (const d of dirs) {
    try {
      for (const f of fs.readdirSync(d)) if (f.endsWith('.md')) out.push(path.join(d, f));
    } catch {}
  }
  return out;
}

function readNote(file) {
  return frontmatter.parse(fs.readFileSync(file, 'utf8'));
}

function writeNote(ctx, file, note) {
  note.data.updated = today(ctx);
  fs.writeFileSync(file, frontmatter.stringify(note.data, note.body));
}

function kindOf(file, data) {
  if (data.type) return data.type;
  const dir = path.basename(path.dirname(file));
  return Object.keys(KINDS).find((k) => KINDS[k] === dir) || 'note';
}

function projectOfNote(file, data) {
  const p = unwrapLink(data.project);
  if (p) return p;
  // 20_Projects/<project>/<Kind>/<note>.md
  const parts = path.resolve(file).split(path.sep);
  const i = parts.lastIndexOf('20_Projects');
  return i >= 0 && parts.length - i === 4 ? parts[i + 1] : null;
}

function nameTaken(name, file) {
  const e = new Error('name-taken');
  e.file = file;
  e.noteName = name;
  return e;
}

function createNote(ctx, kind, { name, project, feature, status, lifecycle }) {
  const file = path.join(itemDir(ctx.vault, kind, project), `${name}.md`);
  const day = today(ctx);
  const data = { type: kind };
  if (kind === 'feature') data.lifecycle = lifecycle || 'proposed';
  else Object.assign(data, { status, completed_at: status === 'completed' || status === 'discarded' ? day : '', blocked: false });
  if (feature) data.feature = `[[${noteName(feature)}]]`;
  if (project) data.project = `[[${projectName(project)}]]`;
  Object.assign(data, { created: day, updated: day });
  const body = templates.fill(templates.load(ctx.lang, `${kind}.md`), { title: name, date: day });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, frontmatter.stringify(data, body));
  return file;
}

// Parsed boards of the vault, written back only when their text changed.
function openBoards(ctx) {
  return boards.listBoards(ctx).map((b) => {
    const text = fs.existsSync(b.file) ? fs.readFileSync(b.file, 'utf8') : board.emptyBoard();
    return { ...b, text, B: board.parseBoard(text) };
  });
}

function saveBoards(list) {
  for (const pb of list) {
    const out = board.serializeBoard(pb.B);
    if (out !== pb.text) {
      fs.mkdirSync(path.dirname(pb.file), { recursive: true });
      fs.writeFileSync(pb.file, out);
      pb.text = out;
    }
  }
}

function boardEntry(ctx, list, project) {
  const file = boards.boardFor(ctx, project);
  return list.find((pb) => path.resolve(pb.file) === path.resolve(file)) || list[0];
}

function applyStatus(ctx, note, status) {
  let changed = false;
  if (note.data.status !== status) {
    note.data.status = status;
    changed = true;
  }
  const done = status === 'completed' || status === 'discarded';
  if (done && !note.data.completed_at) {
    note.data.completed_at = today(ctx);
    changed = true;
  } else if (!done && note.data.completed_at) {
    note.data.completed_at = '';
    changed = true;
  }
  return changed;
}

function syncFromBoard(ctx) {
  const res = { statusChanged: 0, notesCreated: 0, cardsAdded: 0, cardsRouted: 0, featureCards: [] };
  const idx = scanNotes(ctx.vault);
  const list = openBoards(ctx);
  const seen = new Set();
  const routes = [];

  for (const pb of list) {
    for (const lane of pb.B.lanes) {
      const status = board.laneStatus(lane.title);
      if (!status) continue;
      for (const card of board.cards(lane)) {
        let name = card.link;
        let file = name ? idx.get(lower(name)) : null;
        if (!name) {
          try {
            name = noteName(card.text);
          } catch {
            continue;
          }
          file = idx.get(lower(name));
          if (file && !ITEM_KINDS.includes(kindOf(file, readNote(file).data))) {
            name = `${name} (task)`;
            file = idx.get(lower(name)) || null;
          }
        }
        if (file) {
          const kind = kindOf(file, readNote(file).data);
          if (kind === 'feature') {
            res.featureCards.push(nameOf(file));
            continue;
          }
          if (!ITEM_KINDS.includes(kind)) continue;
        } else {
          file = createNote(ctx, 'task', { name: noteName(name), project: pb.project, status });
          idx.set(lower(nameOf(file)), file);
          res.notesCreated++;
        }
        const canon = nameOf(file);
        const note = readNote(file);
        if (note.data.status !== status) res.statusChanged++;
        if (applyStatus(ctx, note, status)) writeNote(ctx, file, note);
        lane.lines[card.index] = board.cardLine({ checked: status === 'completed', text: card.link ? card.text : `[[${canon}]]` });
        seen.add(lower(canon));
        const project = projectOfNote(file, note.data);
        if (pb.project === null && project && boards.isSplit(ctx, project)) routes.push({ from: pb, name: canon, status, project });
      }
    }
  }

  for (const r of routes) {
    const removed = board.removeCardByLink(r.from.B, r.name);
    if (!removed) continue;
    board.appendCardLines(board.ensureStatusLane(boardEntry(ctx, list, r.project).B, r.status), removed.lines);
    res.cardsRouted++;
  }

  for (const file of itemFiles(ctx.vault)) {
    const canon = nameOf(file);
    if (seen.has(lower(canon))) continue;
    const note = readNote(file);
    const status = note.data.status;
    if (!board.STATUSES.includes(status) || !ITEM_KINDS.includes(kindOf(file, note.data))) continue;
    const target = boardEntry(ctx, list, projectOfNote(file, note.data));
    board.appendCard(board.ensureStatusLane(target.B, status), { checked: status === 'completed', text: `[[${canon}]]` });
    seen.add(lower(canon));
    res.cardsAdded++;
  }

  saveBoards(list);
  return res;
}

function afterWrite(ctx) {
  require('./indexes').rebuildIndexes(ctx);
  state.markCliWrite(ctx.vault, ctx.sid, ctx.now || new Date());
}

function addItem(ctx, kind, { title, project, feature, status = 'todo' }) {
  if (!ITEM_KINDS.includes(kind)) throw new Error('bad-kind');
  if (!board.STATUSES.includes(status)) throw new Error('bad-status');
  syncFromBoard(ctx);
  const name = noteName(title);
  const existing = findNote(ctx.vault, name);
  if (existing) throw nameTaken(name, existing);
  const file = createNote(ctx, kind, { name, project, feature, status });
  const list = openBoards(ctx);
  board.appendCard(board.ensureStatusLane(boardEntry(ctx, list, project).B, status), { checked: status === 'completed', text: `[[${name}]]` });
  saveBoards(list);
  afterWrite(ctx);
  return { name, file };
}

function addFeature(ctx, { title, project, lifecycle = 'proposed' }) {
  const name = noteName(title);
  const existing = findNote(ctx.vault, name);
  if (existing) throw nameTaken(name, existing);
  const file = createNote(ctx, 'feature', { name, project, lifecycle });
  afterWrite(ctx);
  return { name, file };
}

function addProjectHub(ctx, raw, { summary } = {}) {
  const p = projectName(raw);
  const existing = findNote(ctx.vault, p);
  if (existing) throw nameTaken(p, existing);
  const file = path.join(ctx.vault, '20_Projects', p, `${p}.md`);
  const day = today(ctx);
  const data = { type: 'project', status: 'active', depends_on: [], used_by: [], source_of: [], related: [], created: day, updated: day };
  const body = templates.fill(templates.load(ctx.lang, 'project.md'), { title: p, summary: summary || '—' });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, frontmatter.stringify(data, body));
  afterWrite(ctx);
  return { name: p, file };
}

function addPostmortem(ctx, { title, project }) {
  const day = today(ctx);
  const base = project ? `${projectName(project)} — Post Mortem ${day}` : `Post Mortem ${day}`;
  let name = base;
  for (let n = 2; findNote(ctx.vault, name); n++) name = `${base} (${n})`;
  const dir = project ? path.join(ctx.vault, '20_Projects', projectName(project)) : path.join(ctx.vault, '10_Notes');
  const file = path.join(dir, `${name}.md`);
  const data = { type: 'postmortem', ...(project ? { project: `[[${projectName(project)}]]` } : {}), created: day, updated: day };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, frontmatter.stringify(data, templates.fill(templates.load(ctx.lang, 'postmortem.md'), { title: noteName(title) })));
  afterWrite(ctx);
  return { name, file };
}

function requireItem(ctx, name) {
  const file = findNote(ctx.vault, name);
  if (!file) throw new Error('not-found');
  const note = readNote(file);
  if (!ITEM_KINDS.includes(kindOf(file, note.data))) throw new Error('not-an-item');
  return { file, note };
}

function removeCards(list, name) {
  let removed = null;
  for (const pb of list) {
    let r;
    while ((r = board.removeCardByLink(pb.B, name))) removed = removed || r;
  }
  return removed;
}

function moveItem(ctx, name, status) {
  if (!board.STATUSES.includes(status)) throw new Error('bad-status');
  syncFromBoard(ctx);
  const { file, note } = requireItem(ctx, name);
  const canon = nameOf(file);
  const list = openBoards(ctx);
  const removed = removeCards(list, canon);
  const lines = removed ? removed.lines.slice() : [board.cardLine({ checked: false, text: `[[${canon}]]` })];
  const text = removed ? removed.text : `[[${canon}]]`;
  lines[0] = board.cardLine({ checked: status === 'completed', text });
  board.appendCardLines(board.ensureStatusLane(boardEntry(ctx, list, projectOfNote(file, note.data)).B, status), lines);
  saveBoards(list);
  if (applyStatus(ctx, note, status)) writeNote(ctx, file, note);
  afterWrite(ctx);
  return { name: canon, file };
}

function setBlocked(ctx, name, blocked) {
  syncFromBoard(ctx);
  const { file, note } = requireItem(ctx, name);
  const tags = (Array.isArray(note.data.tags) ? note.data.tags : []).filter((t) => t !== 'status/blocked');
  if (blocked) tags.push('status/blocked');
  note.data.blocked = !!blocked;
  note.data.tags = tags;
  writeNote(ctx, file, note);
  afterWrite(ctx);
  return { name: nameOf(file), file };
}

function moveToArchive(ctx, file) {
  const dir = archiveDir(ctx.vault, file);
  fs.mkdirSync(dir, { recursive: true });
  let dest = path.join(dir, path.basename(file));
  for (let n = 2; fs.existsSync(dest); n++) dest = path.join(dir, `${nameOf(file)} (${n}).md`);
  return git.moveFile(file, dest);
}

function deleteItem(ctx, name) {
  syncFromBoard(ctx);
  const { file } = requireItem(ctx, name);
  const list = openBoards(ctx);
  removeCards(list, nameOf(file));
  saveBoards(list);
  const dest = moveToArchive(ctx, file);
  afterWrite(ctx);
  return dest;
}

function itemInfo(file) {
  const { data } = readNote(file);
  return {
    name: nameOf(file),
    kind: kindOf(file, data),
    status: data.status || '',
    blocked: data.blocked === true,
    project: projectOfNote(file, data),
    feature: unwrapLink(data.feature),
    file,
  };
}

function listItems(ctx, { kind, status, project, blocked } = {}) {
  const wantProject = project ? lower(projectName(project)) : null;
  return itemFiles(ctx.vault)
    .map(itemInfo)
    .filter((i) => ITEM_KINDS.includes(i.kind))
    .filter((i) => !kind || i.kind === kind)
    .filter((i) => !status || i.status === status)
    .filter((i) => !wantProject || (i.project && lower(i.project) === wantProject))
    .filter((i) => blocked === undefined || i.blocked === blocked)
    .sort((a, b) => (LIST_ORDER.indexOf(a.status) - LIST_ORDER.indexOf(b.status)) || a.name.localeCompare(b.name));
}

function sectionOf(body, heading) {
  const lines = body.split('\n');
  const want = lower(heading.trim());
  const start = lines.findIndex((l) => /^#{1,6}\s/.test(l) && lower(l.replace(/^#+\s+/, '').trim()) === want);
  if (start < 0) return null;
  const level = /^#+/.exec(lines[start])[0].length;
  let end = start + 1;
  while (end < lines.length && !(/^#{1,6}\s/.test(lines[end]) && /^#+/.exec(lines[end])[0].length <= level)) end++;
  return lines.slice(start, end).join('\n').trimEnd();
}

function truncate(text, maxChars) {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n… (truncated, ${text.length - maxChars} more chars)`;
}

function showNote(ctx, file, { section, maxChars = 4000 } = {}) {
  const { data, body } = readNote(file);
  const info = { ...itemInfo(file), kind: kindOf(file, data) };
  const bits = [info.name, info.kind];
  if (data.status) bits.push(data.status);
  if (data.lifecycle) bits.push(data.lifecycle);
  if (info.blocked) bits.push('blocked');
  if (info.project) bits.push(`project ${info.project}`);
  if (info.feature) bits.push(`feature ${info.feature}`);
  bits.push(path.relative(ctx.vault, file).replace(/\\/g, '/'));
  let content = body.trim();
  if (section) {
    const s = sectionOf(body, section);
    if (s === null) {
      const heads = body.split('\n').filter((l) => /^#{2,6}\s/.test(l)).map((l) => l.replace(/^#+\s+/, ''));
      content = `(no section "${section}"; sections: ${heads.join(', ') || 'none'})`;
    } else content = s;
  }
  return `${bits.join(' · ')}\n\n${truncate(content, maxChars)}`;
}

function showItem(ctx, name, opts = {}) {
  const file = findNote(ctx.vault, name);
  if (!file) throw new Error('not-found');
  return showNote(ctx, file, opts);
}

function archiveDone(ctx, now = new Date(), days = 14) {
  syncFromBoard(ctx);
  const cutoff = now.getTime() - days * 86400000;
  const idx = scanNotes(ctx.vault);
  const list = openBoards(ctx);
  const picked = [];
  for (const pb of list) {
    for (const lane of pb.B.lanes) {
      const status = board.laneStatus(lane.title);
      if (status !== 'completed' && status !== 'discarded') continue;
      for (const card of board.cards(lane)) {
        const file = card.link && idx.get(lower(card.link));
        if (!file) continue;
        const done = parseYmd(readNote(file).data.completed_at);
        if (done && done.getTime() < cutoff) picked.push({ pb, file, name: nameOf(file) });
      }
    }
  }
  if (!picked.length) return [];
  const archFile = path.join(ctx.vault, '90_Archive', 'Plan Archive.md');
  const archText = fs.existsSync(archFile) ? fs.readFileSync(archFile, 'utf8') : board.emptyArchiveBoard();
  const arch = board.parseBoard(archText);
  for (const p of picked) {
    const removed = board.removeCardByLink(p.pb.B, p.name);
    if (removed) board.appendCardLines(board.ensureLane(arch, nameOf(p.pb.file)), removed.lines);
  }
  saveBoards(list);
  fs.mkdirSync(path.dirname(archFile), { recursive: true });
  fs.writeFileSync(archFile, board.serializeBoard(arch));
  for (const p of picked) moveToArchive(ctx, p.file);
  afterWrite(ctx);
  return picked.map((p) => p.name);
}

module.exports = {
  KINDS, ITEM_KINDS, noteName, projectName, itemDir, archiveDir, scanNotes, findNote, itemFiles, readNote, writeNote,
  kindOf, projectOfNote, syncFromBoard, addItem, addFeature, addProjectHub, addPostmortem, moveItem, setBlocked, deleteItem, listItems, showItem,
  showNote, sectionOf, truncate, archiveDone, moveToArchive, openBoards, saveBoards, removeCards, today,
};
