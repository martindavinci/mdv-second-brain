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

module.exports = { listBoards, isSplit, boardFor, projectBoardFile, inboxOf };
