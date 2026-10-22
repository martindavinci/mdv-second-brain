'use strict';
const fs = require('node:fs');
const path = require('node:path');
const templates = require('./templates');
const markers = require('./markers');
const git = require('./git');
const { ymd, parseYmd } = require('./names');

const dailyDir = (vault) => path.join(vault, '00_Inbox', 'Daily');
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const sid8 = (sid) => String(sid).slice(0, 8);
const CHECKPOINT = /^- (Status|Stato|Next|Open|Aperto):/i;

function dailyPath(vault, date) {
  return path.join(dailyDir(vault), `${ymd(date)}.md`);
}

function ensureSessionSection(vault, lang, sid, startedAt) {
  const start = new Date(startedAt);
  const file = dailyPath(vault, start);
  const marker = `session:${sid8(sid)}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : templates.fill(templates.load(lang, 'daily.md'), { date: ymd(start) });
  if (markers.hasSection(text, marker)) return { file, marker };
  const [heading, ...rest] = templates.fill(templates.load(lang, 'session.md'), { time: hhmm(start) }).replace(/\n+$/, '').split('\n');
  if (!text.endsWith('\n')) text += '\n';
  text += `\n${heading}\n${markers.open(marker)}\n${rest.join('\n')}\n${markers.close(marker)}\n`;
  fs.writeFileSync(file, text);
  return { file, marker };
}

function sessionsIn(text) {
  const out = [];
  const re = /<!-- brain:session:([^ ]+) -->/g;
  let m;
  while ((m = re.exec(text))) {
    const before = text.slice(0, m.index).split('\n');
    const heading = (before[before.length - 2] || '').replace(/^#+\s*/, '');
    out.push({ id: m[1], heading, body: markers.getSection(text, `session:${m[1]}`) || '' });
  }
  return out;
}

function dailyFiles(vault) {
  try {
    return fs.readdirSync(dailyDir(vault)).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().reverse();
  } catch {
    return [];
  }
}

function lastSessionState(vault, excludeSid, budget = 600) {
  const skip = sid8(excludeSid || '');
  for (const f of dailyFiles(vault)) {
    const sessions = sessionsIn(fs.readFileSync(path.join(dailyDir(vault), f), 'utf8')).reverse();
    const found = sessions.find((s) => s.id !== skip);
    if (!found) continue;
    const lines = found.body.split('\n').filter((l) => CHECKPOINT.test(l));
    const text = [`${f.replace(/\.md$/, '')} ${found.heading}`.trim(), ...lines].join('\n');
    return text.length > budget ? text.slice(0, budget - 1) + '…' : text;
  }
  return null;
}

function rollover(vault, now = new Date(), days = 7) {
  const today = parseYmd(ymd(now)).getTime();
  const moved = [];
  for (const f of dailyFiles(vault)) {
    const d = parseYmd(f);
    if (!d || Math.round((today - d.getTime()) / 86400000) <= days) continue;
    // same date already archived (a session resumed days later): keep both files
    let dest = path.join(vault, '90_Archive', 'Daily', f);
    for (let n = 2; fs.existsSync(dest); n++) dest = path.join(vault, '90_Archive', 'Daily', f.replace(/\.md$/, ` (${n}).md`));
    git.moveFile(path.join(dailyDir(vault), f), dest);
    moved.push(dest);
  }
  return moved;
}

module.exports = { dailyPath, ensureSessionSection, lastSessionState, rollover, sessionsIn, sid8 };
