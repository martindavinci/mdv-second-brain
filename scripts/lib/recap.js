'use strict';
// What happened in a day, week or month: the items closed in it and each session's state, from the dailies (archived
// ones included) and the task and issue notes.
const fs = require('node:fs');
const path = require('node:path');
const frontmatter = require('./frontmatter');
const { sessionsIn } = require('./daily');
const { ymd, parseYmd, unwrapLink } = require('./names');

const STATUS = /^- (Status|Stato):\s*(.*)$/i;
const LOG = /^- (\d{2}:\d{2}) (.*)$/;

function range(period, date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (period === 'week') {
    const from = new Date(d);
    from.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const to = new Date(from);
    to.setDate(from.getDate() + 6);
    return [ymd(from), ymd(to)];
  }
  if (period === 'month') return [ymd(new Date(d.getFullYear(), d.getMonth(), 1)), ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0))];
  return [ymd(d), ymd(d)];
}

function mdFiles(dir, keep, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) mdFiles(full, keep, out);
    else if (e.name.endsWith('.md') && keep(full)) out.push(full);
  }
  return out;
}

const inside = (from, to) => (d) => d >= from && d <= to;

function closedItems(vault, within) {
  const inItems = (f) => ['Tasks', 'Issues'].includes(path.basename(path.dirname(f)));
  const files = [vault, path.join(vault, '90_Archive')].flatMap((root) => ['10_Notes', '20_Projects'].flatMap((top) => mdFiles(path.join(root, top), inItems)));
  const out = [];
  for (const f of files) {
    let data;
    try {
      ({ data } = frontmatter.parse(fs.readFileSync(f, 'utf8')));
    } catch {
      continue;
    }
    const date = String(data.completed_at || '').slice(0, 10);
    if (!['completed', 'discarded'].includes(data.status) || !parseYmd(date) || !within(date)) continue;
    out.push({ name: path.basename(f, '.md'), kind: data.type || (path.basename(path.dirname(f)) === 'Issues' ? 'issue' : 'task'), status: data.status, project: unwrapLink(data.project), date });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
}

function sessionDays(vault, within) {
  const byDate = new Map();
  for (const dir of [path.join(vault, '00_Inbox', 'Daily'), path.join(vault, '90_Archive', 'Daily')]) {
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {}
    for (const f of names) {
      const m = /^(\d{4}-\d{2}-\d{2})( \(\d+\))?\.md$/.exec(f);
      if (!m || !within(m[1])) continue;
      const sessions = sessionsIn(fs.readFileSync(path.join(dir, f), 'utf8')).map((s) => {
        const lines = s.body.split('\n');
        const st = lines.map((l) => STATUS.exec(l)).find(Boolean);
        const log = lines.map((l) => LOG.exec(l)).filter((x) => x && !/^(started|avviata|iniziata)$/i.test(x[2].trim())).map((x) => `${x[1]} ${x[2]}`);
        return { heading: s.heading, status: st ? st[2].trim() : '', log };
      });
      byDate.set(m[1], [...(byDate.get(m[1]) || []), ...sessions]);
    }
  }
  return [...byDate.entries()].filter(([, s]) => s.length).sort((a, b) => b[0].localeCompare(a[0])).map(([date, sessions]) => ({ date, sessions }));
}

function build(ctx, { period = 'day', date = new Date() } = {}) {
  const [from, to] = range(period, date);
  const within = inside(from, to);
  return { period, from, to, closed: closedItems(ctx.vault, within), days: sessionDays(ctx.vault, within) };
}

// Log lines go first when the text is over budget, then whole sessions from the oldest day.
function text(r, maxChars = 6000) {
  const render = (withLog) => {
    const lines = [`recap ${r.from}${r.to !== r.from ? ` → ${r.to}` : ''} (${r.period})`];
    if (r.closed.length) lines.push(`closed: ${r.closed.length}`, ...r.closed.map((i) => `- ${i.kind} ${i.name}${i.project ? ` (${i.project})` : ''} — ${i.status} ${i.date}`));
    for (const d of r.days) {
      lines.push(d.date);
      for (const s of d.sessions) {
        lines.push(`- ${s.heading}${s.status ? `: ${s.status}` : ''}`);
        if (withLog) lines.push(...s.log.map((l) => `  - ${l}`));
      }
    }
    if (!r.closed.length && !r.days.length) lines.push('nothing recorded');
    return lines.join('\n');
  };
  let out = render(true);
  if (out.length > maxChars) out = render(false);
  return out.length > maxChars ? out.slice(0, maxChars - 1) + '…' : out;
}

module.exports = { build, text, range };
