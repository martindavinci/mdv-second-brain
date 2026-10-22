'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { projectName } = require('./names');

const inboxOf = (ctx) => path.join(ctx.vault, '00_Inbox');
const projectBoardFile = (ctx, p) => path.join(inboxOf(ctx), p, `${p} Plan.md`);

function listBoards(ctx) {
  const out = [{ project: null, file: ctx.boardFile }];
  let entries = [];
  try {
    entries = fs.readdirSync(inboxOf(ctx), { withFileTypes: true });
  } catch {}
  for (const e of entries) {
    if (!e.isDirectory() || e.name === 'Daily') continue;
    const f = projectBoardFile(ctx, e.name);
    if (fs.existsSync(f)) out.push({ project: e.name, file: f });
  }
  return [out[0], ...out.slice(1).sort((a, b) => a.project.localeCompare(b.project))];
}

function isSplit(ctx, project) {
  if (!project) return false;
  return fs.existsSync(projectBoardFile(ctx, projectName(project)));
}

function boardFor(ctx, project) {
  return isSplit(ctx, project) ? projectBoardFile(ctx, projectName(project)) : ctx.boardFile;
}

function checkName(raw) {
  const { RESERVED } = require('./names');
  if (!raw || !String(raw).trim() || RESERVED.has(String(raw).trim().toLowerCase())) throw new Error('reserved-name');
  return projectName(raw);
}

function readBoard(file) {
  const board = require('./board');
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : board.emptyBoard();
  return { text, B: board.parseBoard(text) };
}

function writeBoard(file, B) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, require('./board').serializeBoard(B));
}

// Moves every card of `from` that `pick` accepts into the lane with the same status (or title) of `to`, order kept.
function moveCards(from, to, pick) {
  const board = require('./board');
  let moved = 0;
  for (const lane of from.lanes) {
    const status = board.laneStatus(lane.title);
    for (const c of board.cards(lane).filter(pick)) {
      const removed = board.removeCardByLink(from, c.link);
      if (!removed) continue;
      board.appendCardLines(status ? board.ensureStatusLane(to, status) : board.ensureLane(to, lane.title), removed.lines);
      moved++;
    }
  }
  return moved;
}

function splitProject(ctx, raw) {
  const tasks = require('./tasks');
  const ideas = require('./ideas');
  const p = checkName(raw);
  const file = projectBoardFile(ctx, p);
  if (fs.existsSync(file)) throw new Error('already-split');
  tasks.syncFromBoard(ctx);
  const idx = tasks.scanNotes(ctx.vault);
  const main = readBoard(ctx.boardFile);
  const own = readBoard(file);
  const cardsMoved = moveCards(main.B, own.B, (c) => {
    const f = c.link && idx.get(c.link.toLowerCase());
    return !!f && tasks.projectOfNote(f, tasks.readNote(f).data) === p;
  });
  writeBoard(ctx.boardFile, main.B);
  writeBoard(file, own.B);
  const lines = ideas.takeSection(path.join(inboxOf(ctx), 'Ideas.md'), p);
  if (lines.length) {
    const target = ideas.ideasFile(ctx, p);
    ideas.writeLines(target, ideas.insertUnder(ideas.readLines(target, `${p} Ideas`), p, lines));
  }
  require('./indexes').rebuildIndexes(ctx);
  return { cardsMoved, ideasMoved: lines.filter((l) => /^- \[/.test(l)).length };
}

function mergeProject(ctx, raw) {
  const ideas = require('./ideas');
  const p = checkName(raw);
  const file = projectBoardFile(ctx, p);
  if (!fs.existsSync(file)) throw new Error('not-split');
  const main = readBoard(ctx.boardFile);
  const own = readBoard(file);
  const cardsMoved = moveCards(own.B, main.B, () => true);
  writeBoard(ctx.boardFile, main.B);
  const dir = path.join(inboxOf(ctx), p);
  const ideasOwn = path.join(dir, `${p} Ideas.md`);
  const lines = ideas.takeSection(ideasOwn, p);
  if (lines.length) {
    const target = path.join(inboxOf(ctx), 'Ideas.md');
    const title = (ideas.TEXT[ctx.lang] || ideas.TEXT.en).title;
    ideas.writeLines(target, ideas.insertUnder(ideas.readLines(target, title), p, lines));
  }
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    const generated = f === `${p} Bugs.md` || f === `${p} Features.md`;
    const emptyIdeas = f === `${p} Ideas.md` && !/^- \[/m.test(fs.readFileSync(full, 'utf8'));
    if (f === `${p} Plan.md` || generated || emptyIdeas) fs.rmSync(full);
  }
  if (!fs.readdirSync(dir).length) fs.rmdirSync(dir);
  require('./indexes').rebuildIndexes(ctx);
  return { cardsMoved, ideasMoved: lines.filter((l) => /^- \[/.test(l)).length };
}

module.exports = { listBoards, isSplit, boardFor, projectBoardFile, inboxOf, splitProject, mergeProject };
