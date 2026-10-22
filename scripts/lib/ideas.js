'use strict';
// Ideas.md: undecided ideas, one Tasks-plugin line each, grouped under "## <project>".
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const boards = require('./boards');
const { projectName, ymd, parseYmd } = require('./names');

const TEXT = { en: { title: 'Ideas', general: 'General' }, it: { title: 'Idee', general: 'Generale' } };
const LINE = /^- \[( |x|X|-)\] (.*)$/;
const ID = /\s*🆔\s*([a-z0-9]{6})/;
const CREATED = /\s*➕\s*(\d{4}-\d{2}-\d{2})/;
const CLOSED = /\s*(✅|❌)\s*(\d{4}-\d{2}-\d{2})/;
const LINK = /\s*→\s*\[\[([^\]]+)\]\]/;

const T = (ctx) => TEXT[ctx.lang] || TEXT.en;

function ideasFile(ctx, project) {
  if (project && boards.isSplit(ctx, project)) {
    const p = projectName(project);
    return path.join(ctx.vault, '00_Inbox', p, `${p} Ideas.md`);
  }
  return path.join(ctx.vault, '00_Inbox', 'Ideas.md');
}

function allFiles(ctx, { archive = false } = {}) {
  const out = [path.join(ctx.vault, '00_Inbox', 'Ideas.md')];
  for (const b of boards.listBoards(ctx)) if (b.project) out.push(path.join(ctx.vault, '00_Inbox', b.project, `${b.project} Ideas.md`));
  if (archive) out.push(path.join(ctx.vault, '90_Archive', 'Ideas Archive.md'));
  return out.filter((f) => fs.existsSync(f));
}

function parseLine(raw) {
  const m = LINE.exec(raw);
  if (!m) return null;
  let rest = m[2];
  const id = (ID.exec(rest) || [])[1] || null;
  const created = (CREATED.exec(rest) || [])[1] || null;
  const closedM = CLOSED.exec(rest);
  const link = (LINK.exec(rest) || [])[1] || null;
  rest = rest.replace(ID, '').replace(CREATED, '').replace(CLOSED, '').replace(LINK, '').trim();
  const struck = /^~~(.*)~~$/.exec(rest);
  const state = m[1] === ' ' ? 'open' : m[1] === '-' ? 'discarded' : 'promoted';
  return { state, text: struck ? struck[1] : rest, id, created, closed: closedM ? closedM[2] : null, link };
}

function formatLine(i) {
  const box = i.state === 'open' ? ' ' : i.state === 'discarded' ? '-' : 'x';
  const text = i.state === 'discarded' ? `~~${i.text}~~` : i.text;
  let s = `- [${box}] ${text}`;
  if (i.link) s += ` → [[${i.link}]]`;
  if (i.id) s += ` 🆔 ${i.id}`;
  if (i.created) s += ` ➕ ${i.created}`;
  if (i.closed) s += ` ${i.state === 'discarded' ? '❌' : '✅'} ${i.closed}`;
  return s;
}

// Lines of a file with their heading: [{heading, index, raw}]
function scan(lines) {
  let heading = null;
  const out = [];
  lines.forEach((raw, index) => {
    const h = /^##\s+(.*)$/.exec(raw);
    if (h) heading = h[1].trim();
    else if (LINE.test(raw)) out.push({ heading, index, raw });
  });
  return out;
}

function knownIds(ctx) {
  const ids = new Set();
  for (const f of allFiles(ctx, { archive: true })) for (const m of fs.readFileSync(f, 'utf8').matchAll(/🆔\s*([a-z0-9]{6})/g)) ids.add(m[1]);
  return ids;
}

function newId(ids) {
  for (;;) {
    const id = Array.from(crypto.randomBytes(6), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
    if (!ids.has(id)) {
      ids.add(id);
      return id;
    }
  }
}

// Inserts lines at the end of the "## heading" section, creating the section when missing.
function insertUnder(lines, heading, newLines) {
  const start = lines.findIndex((l) => /^##\s+/.test(l) && l.replace(/^##\s+/, '').trim() === heading);
  if (start < 0) {
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    lines.push('', `## ${heading}`, '', ...newLines, '');
    return lines;
  }
  let end = start + 1;
  while (end < lines.length && !/^##\s+/.test(lines[end])) end++;
  let at = end;
  while (at > start + 1 && lines[at - 1] === '') at--;
  if (at === start + 1) {
    lines.splice(at, 0, '', ...newLines);
    if (lines[at + 1 + newLines.length] !== '') lines.splice(at + 1 + newLines.length, 0, '');
  } else lines.splice(at, 0, ...newLines);
  return lines;
}

function readLines(file, title) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/) : [`# ${title}`, ''];
}

// Keeps the file's line endings (CRLF files stay CRLF).
function writeLines(file, lines) {
  while (lines.length > 1 && lines[lines.length - 1] === '' && lines[lines.length - 2] === '') lines.pop();
  if (lines[lines.length - 1] !== '') lines.push('');
  const eol = fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes('\r\n') ? '\r\n' : '\n';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join(eol));
}

function headingFor(ctx, project) {
  return project ? projectName(project) : T(ctx).general;
}

function addIdea(ctx, text, { project, now = new Date() } = {}) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) throw new Error('empty-title');
  const file = ideasFile(ctx, project);
  const id = newId(knownIds(ctx));
  const lines = readLines(file, T(ctx).title);
  writeLines(file, insertUnder(lines, headingFor(ctx, project), [formatLine({ state: 'open', text: clean, id, created: ymd(now) })]));
  return { id, file };
}

function listIdeas(ctx, { project, open, limit = 20 } = {}) {
  const ids = knownIds(ctx);
  const general = T(ctx).general;
  const want = project ? projectName(project) : null;
  const out = [];
  for (const file of allFiles(ctx)) {
    const lines = readLines(file);
    let changed = false;
    for (const e of scan(lines)) {
      const i = parseLine(e.raw);
      if (!i.id) {
        i.id = newId(ids);
        lines[e.index] = formatLine(i);
        changed = true;
      }
      const proj = !e.heading || e.heading === general ? null : e.heading;
      out.push({ id: i.id, project: proj, text: i.text, state: i.state, file, line: e.index + 1 });
    }
    if (changed) writeLines(file, lines);
  }
  return out
    .filter((i) => !want || (i.project && i.project.toLowerCase() === want.toLowerCase()))
    .filter((i) => !open || i.state === 'open')
    .slice(0, limit > 0 ? limit : undefined);
}

function updateIdea(ctx, id, fn) {
  listIdeas(ctx, { limit: 0 });
  for (const file of allFiles(ctx)) {
    const lines = readLines(file);
    for (const e of scan(lines)) {
      const i = parseLine(e.raw);
      if (i.id !== id) continue;
      fn(i);
      lines[e.index] = formatLine(i);
      writeLines(file, lines);
      return i;
    }
  }
  throw new Error('not-found');
}

function promoteIdea(ctx, id, name, now = new Date()) {
  return updateIdea(ctx, id, (i) => Object.assign(i, { state: 'promoted', link: name, closed: ymd(now) }));
}

function discardIdea(ctx, id, now = new Date()) {
  return updateIdea(ctx, id, (i) => Object.assign(i, { state: 'discarded', link: null, closed: ymd(now) }));
}

function archiveIdeas(ctx, now = new Date(), days = 14) {
  const cutoff = now.getTime() - days * 86400000;
  const archFile = path.join(ctx.vault, '90_Archive', 'Ideas Archive.md');
  let arch = null;
  let moved = 0;
  for (const file of allFiles(ctx)) {
    const lines = readLines(file);
    const take = scan(lines).filter((e) => {
      const i = parseLine(e.raw);
      const closed = i.state !== 'open' && parseYmd(i.closed);
      return closed && closed.getTime() < cutoff;
    });
    if (!take.length) continue;
    arch = arch || readLines(archFile, `${T(ctx).title} Archive`);
    for (const e of take) insertUnder(arch, e.heading || T(ctx).general, [e.raw]);
    for (const e of take.slice().reverse()) lines.splice(e.index, 1);
    writeLines(file, lines);
    moved += take.length;
  }
  if (arch) writeLines(archFile, arch);
  return moved;
}

// Section "## heading" of a file: its idea lines (used by split/merge).
function takeSection(file, heading) {
  if (!fs.existsSync(file)) return [];
  const lines = readLines(file);
  const start = lines.findIndex((l) => /^##\s+/.test(l) && l.replace(/^##\s+/, '').trim() === heading);
  if (start < 0) return [];
  let end = start + 1;
  while (end < lines.length && !/^##\s+/.test(lines[end])) end++;
  const body = lines.slice(start + 1, end).filter((l) => l.trim());
  lines.splice(start, end - start);
  writeLines(file, lines);
  return body;
}

module.exports = { ideasFile, addIdea, listIdeas, promoteIdea, discardIdea, archiveIdeas, parseLine, formatLine, insertUnder, takeSection, readLines, writeLines, TEXT };
