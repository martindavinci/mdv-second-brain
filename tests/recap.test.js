'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { write, makeVault, io } = require('./helpers');
const { main } = require('../scripts/brain');
const recap = require('../scripts/lib/recap');

const session = (id, time, status, log = []) => `## ${time} — Session\n<!-- brain:session:${id} -->\n- Status: ${status}\n- Next: —\n- Open: —\n\nLog:\n- ${time} started\n${log.map((l) => `- ${l}\n`).join('')}<!-- /brain:session:${id} -->\n`;
const item = (type, status, completed, project = 'alpha') => `---\ntype: ${type}\nstatus: ${status}\nproject: "[[${project}]]"\ncompleted_at: ${completed}\n---\n# x\n`;

function fixture() {
  const r = makeVault();
  const v = r.vault;
  write(join(v, '00_Inbox', 'Daily', '2026-10-28.md'), '# 2026-10-28\n' + session('aaaa1111', '09:00', 'parser half done', ['10:00 split the lexer']));
  write(join(v, '00_Inbox', 'Daily', '2026-10-30.md'), '# 2026-10-30\n' + session('bbbb2222', '08:00', 'release out', ['08:30 tagged v1']) + session('cccc3333', '14:00', 'docs', []));
  write(join(v, '90_Archive', 'Daily', '2026-10-20.md'), '# 2026-10-20\n' + session('dddd4444', '11:00', 'last week', []));
  write(join(v, '20_Projects', 'alpha', 'Tasks', 'Parser.md'), item('task', 'completed', '2026-10-29'));
  write(join(v, '20_Projects', 'alpha', 'Issues', 'Crash.md'), item('issue', 'completed', '2026-10-30'));
  write(join(v, '90_Archive', '20_Projects', 'alpha', 'Tasks', 'Old.md'), item('task', 'completed', '2026-10-27'));
  write(join(v, '20_Projects', 'alpha', 'Tasks', 'Dropped.md'), item('task', 'discarded', '2026-10-29'));
  write(join(v, '20_Projects', 'alpha', 'Tasks', 'Open.md'), item('task', 'in-progress', ''));
  return r;
}

test('recap of a week: items closed in it, archived ones too, and every session by day', () => {
  const { ctx } = fixture();
  const r = recap.build(ctx, { period: 'week', date: new Date(2026, 9, 30) });
  assert.equal(r.from, '2026-10-26');
  assert.equal(r.to, '2026-11-01');
  assert.deepEqual(r.closed.map((i) => [i.name, i.status, i.date]), [['Crash', 'completed', '2026-10-30'], ['Dropped', 'discarded', '2026-10-29'], ['Parser', 'completed', '2026-10-29'], ['Old', 'completed', '2026-10-27']]);
  assert.deepEqual(r.days.map((d) => [d.date, d.sessions.map((s) => s.status)]), [['2026-10-30', ['release out', 'docs']], ['2026-10-28', ['parser half done']]]);
  assert.deepEqual(r.days[0].sessions[0].log, ['08:30 tagged v1']);
});

test('recap of a day reads that day only; an archived daily counts', () => {
  const { ctx } = fixture();
  const r = recap.build(ctx, { period: 'day', date: new Date(2026, 9, 20) });
  assert.deepEqual(r.days.map((d) => d.date), ['2026-10-20']);
  assert.deepEqual(r.closed, []);
});

test('recap text stays within the budget, dropping log lines before sessions', () => {
  const { ctx } = fixture();
  const full = recap.text(recap.build(ctx, { period: 'week', date: new Date(2026, 9, 30) }), 4000);
  assert.match(full, /- 08:30 tagged v1/);
  const short = recap.text(recap.build(ctx, { period: 'week', date: new Date(2026, 9, 30) }), 330);
  assert.ok(short.length <= 330, String(short.length));
  assert.doesNotMatch(short, /tagged v1/);
  assert.match(short, /release out/);
});

test('cli recap --week --date prints the period', async () => {
  const { cfgFile, code } = fixture();
  const o = io();
  assert.equal(await main(['--config', cfgFile, 'recap', '--week', '--date', '2026-10-30'], { cwd: code, ...o }), 0);
  assert.match(o.text(), /^recap 2026-10-26 → 2026-11-01/);
  assert.match(o.text(), /closed: 4\n- issue Crash \(alpha\) — completed 2026-10-30/);
  assert.match(o.text(), /2026-10-30\n- 08:00 — Session: release out\n  - 08:30 tagged v1/);
});
