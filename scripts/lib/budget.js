'use strict';
// Size budgets: report what the agent must distil, rotate what the CLI can move without losing anything.
const fs = require('node:fs');
const path = require('node:path');
const frontmatter = require('./frontmatter');
const { defaults } = require('./config');
const { parseYmd } = require('./names');

const budgetsOf = (ctx) => ({ ...defaults().budgets, ...(ctx.budgets || {}) });
const rel = (ctx, f) => path.relative(ctx.vault, f).replace(/\\/g, '/');

function projectDirs(vault) {
  try {
    return fs.readdirSync(path.join(vault, '20_Projects'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

function check(ctx) {
  const tasks = require('./tasks');
  const b = budgetsOf(ctx);
  const out = [];
  const over = (file, chars, budget) => {
    if (chars > budget) out.push({ file: rel(ctx, file), chars, budget });
  };
  for (const p of projectDirs(ctx.vault)) {
    const dir = path.join(ctx.vault, '20_Projects', p);
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.md')) continue;
      const file = path.join(dir, f);
      const text = fs.readFileSync(file, 'utf8');
      if (f === `${p}.md`) over(file, text.length, b.hub);
      else if (frontmatter.parse(text).data.type !== 'postmortem') over(file, text.length, b.note);
    }
  }
  for (const file of tasks.itemFiles(ctx.vault, ['feature'])) over(file, fs.readFileSync(file, 'utf8').length, b.note);
  for (const [f, key] of [['MEMORY.md', 'memory'], ['DECISIONS.md', 'decisions']]) {
    const file = path.join(ctx.vault, f);
    if (fs.existsSync(file)) over(file, fs.readFileSync(file, 'utf8').length, b[key]);
  }
  for (const file of tasks.itemFiles(ctx.vault)) {
    const body = frontmatter.parse(fs.readFileSync(file, 'utf8')).body;
    const sec = tasks.sectionOf(body, 'Status') || tasks.sectionOf(body, 'Stato');
    if (sec) over(file, sec.split('\n').slice(1).join('\n').trim().length, b.state);
  }
  return out;
}

// Log entries: a line starting with "- " plus its indented continuation lines.
function entriesOf(lines) {
  const entries = [];
  for (const l of lines) {
    if (/^- /.test(l) || !entries.length) entries.push([l]);
    else entries[entries.length - 1].push(l);
  }
  return entries.map((e) => e.join('\n'));
}

function rotateLogs(ctx) {
  const tasks = require('./tasks');
  const limit = budgetsOf(ctx).log;
  let rotated = 0;
  for (const file of tasks.itemFiles(ctx.vault)) {
    const text = fs.readFileSync(file, 'utf8');
    const { data, body } = frontmatter.parse(text);
    const sec = tasks.sectionOf(body, 'Log');
    if (!sec || sec.length <= limit) continue;
    const name = path.basename(file, '.md');
    const link = `→ [[${name} — Log]]`;
    const [heading, ...rest] = sec.split('\n');
    // blank lines inside an entry belong to it; only the trailing ones of the section are dropped
    const body0 = rest.filter((l) => l.trim() !== link);
    while (body0.length && !body0[body0.length - 1].trim()) body0.pop();
    while (body0.length && !body0[0].trim()) body0.shift();
    const entries = entriesOf(body0);
    const keep = [];
    let size = heading.length + link.length + 2;
    for (let i = entries.length - 1; i >= 0; i--) {
      if (keep.length && size + entries[i].length + 1 > limit / 2) break;
      keep.unshift(entries[i]);
      size += entries[i].length + 1;
    }
    const moved = entries.slice(0, entries.length - keep.length);
    if (!moved.length) continue;
    const archFile = path.join(tasks.archiveDir(ctx.vault, file), `${name} — Log.md`);
    fs.mkdirSync(path.dirname(archFile), { recursive: true });
    const prev = fs.existsSync(archFile) ? fs.readFileSync(archFile, 'utf8').replace(/\n*$/, '\n') : `# ${name} — Log\n\n`;
    fs.writeFileSync(archFile, prev + moved.join('\n') + '\n');
    const newSec = [heading, link, ...keep].join('\n');
    // splice by index (a "$&" in the log must stay literal) and keep the frontmatter as written
    const at = body.indexOf(sec);
    fs.writeFileSync(file, frontmatter.setBody(text, body.slice(0, at) + newSec + body.slice(at + sec.length)));
    rotated++;
  }
  return rotated;
}

function archiveDecisions(ctx, now = new Date(), days = 14) {
  const file = path.join(ctx.vault, 'DECISIONS.md');
  if (!fs.existsSync(file)) return 0;
  const cutoff = now.getTime() - days * 86400000;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const moved = [];
  const kept = lines.filter((l) => {
    const m = /^- (\d{4}-\d{2}-\d{2}).*~~.+~~/.exec(l);
    const d = m && parseYmd(m[1]);
    if (d && d.getTime() < cutoff) {
      moved.push(l);
      return false;
    }
    return true;
  });
  if (!moved.length) return 0;
  const arch = path.join(ctx.vault, '90_Archive', 'Decisions Archive.md');
  fs.mkdirSync(path.dirname(arch), { recursive: true });
  const prev = fs.existsSync(arch) ? fs.readFileSync(arch, 'utf8').replace(/\n*$/, '\n') : '# Decisions Archive\n\n';
  fs.writeFileSync(arch, prev + moved.join('\n') + '\n');
  fs.writeFileSync(file, kept.join('\n'));
  return moved.length;
}

module.exports = { check, rotateLogs, archiveDecisions, budgetsOf };
