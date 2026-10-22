'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const { join } = require('node:path');
const { read, write, io, ymd } = require('./helpers');
const adopt = require('../scripts/lib/adopt');
const { main } = require('../scripts/brain');
const { defaults, saveConfig, loadConfig } = require('../scripts/lib/config');

const kanban = (lanes) => `---\n\nkanban-plugin: board\n\n---\n\n${lanes}\n%% kanban:settings\n\`\`\`\n{"kanban-plugin":"board"}\n\`\`\`\n%%\n`;

function fixture() {
  const t = fs.mkdtempSync(join(os.tmpdir(), 'sb-adopt-'));
  const src = join(t, 'OldVault');
  const today = ymd(new Date());
  write(join(src, '00_Daily', `${today}.md`), '# today\n');
  write(join(src, '00_Daily', '2020-01-01.md'), '# old\n');
  write(join(src, '00_Work', 'Plan.md'), kanban('## To Do\n\n- [ ] [[Write Docs Card]]\n\n## Doing\n\n- [ ] [[Refactor]]\n\n## Done\n\n'));
  write(join(src, '00_Work', 'Scratch.md'), '# scratch\n');
  write(join(src, '00_Work', 'alpha Plan.md'), kanban('## ToDo\n\n- [ ] [[Alpha Thing]]\n\n## Completed\n\n'));
  write(join(src, '20_Projects', 'alpha.md'), '---\ntype: project\n---\n# alpha\n');
  write(join(src, '10_Notes', 'Exporter.md'), '---\ntype: feature\n---\n# Exporter\n');
  write(join(src, '10_Notes', 'Refactor.md'), '---\nstatus: in-progress\n---\n# Refactor\n');
  write(join(src, '10_Notes', 'Alpha Thing.md'), '---\nstatus: todo\nproject: "[[alpha]]"\n---\n# Alpha Thing\n');
  write(join(src, '10_Notes', 'Crash On Save.md'), '---\ntype: bug\n---\n# Crash\n');
  write(join(src, '10_Notes', 'Random.md'), '# just a note\n');
  write(join(src, '10_Notes', 'Linker.md'), '# Linker\n\nSee [[00_Work/Plan]] and [[10_Notes/Exporter|the exporter]].\n');
  write(join(src, 'TASKS.md'), '# Tasks\n\n## NOW\n- [ ] Write docs\n\n## IN PROGRESS\n- [ ] Ship v2\n\n## DONE\n- [x] Old thing\n');
  write(join(src, 'AGENTS.md'), 'my own agent rules\n');
  write(join(src, '_Scripts', 'x.ps1'), 'echo\n');
  write(join(src, 'RUNBOOK.md'), '# runbook\n');
  const cfgFile = join(t, 'cfg', 'config.json');
  const cfg = defaults();
  cfg.root = join(t, 'root');
  cfg.git = { mode: 'none' };
  saveConfig(cfg, cfgFile);
  return { t, src, cfgFile, today };
}

function snapshot(dir) {
  return fs.readdirSync(dir, { recursive: true }).sort().map((f) => {
    const full = join(dir, f);
    return fs.statSync(full).isFile() ? `${f}:${read(full)}` : f;
  });
}

const movedTo = (plan, from) => (plan.moves.find((m) => m.from === from) || {}).to;

test('plan maps 00_Daily/00_Work and leaves unknown folders', () => {
  const { src, today } = fixture();
  const plan = adopt.planAdopt(src, new Date());
  assert.equal(movedTo(plan, `00_Daily/${today}.md`), `00_Inbox/Daily/${today}.md`);
  assert.equal(movedTo(plan, '00_Daily/2020-01-01.md'), '90_Archive/Daily/2020-01-01.md');
  assert.equal(movedTo(plan, '00_Work/Scratch.md'), '00_Inbox/Scratch.md');
  assert.equal(movedTo(plan, '10_Notes/Exporter.md'), '10_Notes/Features/Exporter.md');
  assert.equal(movedTo(plan, '10_Notes/Refactor.md'), '10_Notes/Tasks/Refactor.md');
  assert.equal(movedTo(plan, '10_Notes/Alpha Thing.md'), '20_Projects/alpha/Tasks/Alpha Thing.md');
  assert.equal(movedTo(plan, '10_Notes/Crash On Save.md'), '10_Notes/Issues/Crash On Save.md');
  assert.equal(movedTo(plan, '10_Notes/Random.md'), undefined);
  assert.ok(plan.untouched.includes('_Scripts'));
  assert.ok(plan.untouched.includes('RUNBOOK.md'));
  assert.equal(plan.tasksFile, 'TASKS.md');
  assert.deepEqual(plan.taskItems, [
    { title: 'Write docs', status: 'todo' },
    { title: 'Ship v2', status: 'in-progress' },
    { title: 'Old thing', status: 'completed' },
  ]);
});

test('existing kanban board under 00_Work is detected and moved', () => {
  const { src } = fixture();
  const plan = adopt.planAdopt(src, new Date());
  assert.equal(plan.board, '00_Inbox/Plan.md');
  assert.equal(movedTo(plan, '00_Work/Plan.md'), '00_Inbox/Plan.md');
  assert.deepEqual(plan.boardLaneMap, { 'To Do': 'todo', Doing: 'in-progress', Done: 'completed' });
});

test('<Name> Plan.md of a known project becomes a split project; flat project note moves into its folder', () => {
  const { src } = fixture();
  const plan = adopt.planAdopt(src, new Date());
  assert.equal(movedTo(plan, '00_Work/alpha Plan.md'), '00_Inbox/alpha/alpha Plan.md');
  assert.equal(movedTo(plan, '20_Projects/alpha.md'), '20_Projects/alpha/alpha.md');
});

test('dry run changes nothing', async () => {
  const { src, cfgFile, t } = fixture();
  const before = snapshot(src);
  const o = io();
  assert.equal(await main(['--config', cfgFile, 'adopt', src, '--as', 'old'], { cwd: t, ...o }), 0);
  assert.match(o.text(), /dry run/);
  assert.match(o.text(), /00_Work\/Plan\.md → 00_Inbox\/Plan\.md/);
  assert.deepEqual(snapshot(src), before);
  assert.deepEqual(loadConfig(cfgFile).workspaces, {});
});

test('apply moves files, rewrites links, converts TASKS.md, deletes nothing, keeps AGENTS.md', async () => {
  const { src, cfgFile, t, today } = fixture();
  const filesBefore = snapshot(src).filter((x) => x.includes(':')).length;
  const o = io();
  assert.equal(await main(['--config', cfgFile, 'adopt', src, '--as', 'old', '--apply', '--language', 'en'], { cwd: t, ...o }), 0, o.errText());
  const cfg = loadConfig(cfgFile);
  assert.equal(cfg.workspaces.old.vault, src);
  assert.equal(cfg.workspaces.old.board, '00_Inbox/Plan.md');
  assert.ok(fs.existsSync(join(src, '00_Inbox', 'Daily', `${today}.md`)));
  assert.ok(fs.existsSync(join(src, '10_Notes', 'Features', 'Exporter.md')));
  assert.ok(fs.existsSync(join(src, '00_Inbox', 'alpha', 'alpha Plan.md')));
  assert.ok(fs.existsSync(join(src, '20_Projects', 'alpha', 'alpha.md')));
  assert.equal(read(join(src, 'AGENTS.md')), 'my own agent rules\n');
  assert.ok(fs.existsSync(join(src, 'WORKFLOW.md')));
  assert.match(read(join(src, '10_Notes', 'Linker.md')), /See \[\[Plan\]\] and \[\[Exporter\|the exporter\]\]\./);
  assert.ok(fs.existsSync(join(src, 'TASKS.legacy.md')));
  assert.ok(!fs.existsSync(join(src, 'TASKS.md')));
  const board = read(join(src, '00_Inbox', 'Plan.md'));
  assert.match(board, /\[\[Write docs\]\]/);
  assert.match(board, /## Doing\n\n- \[ \] \[\[Refactor\]\]\n- \[ \] \[\[Ship v2\]\]/);
  assert.match(board, /## Done\n\n- \[x\] \[\[Old thing\]\]/);
  assert.ok(fs.existsSync(join(src, '_Scripts', 'x.ps1')));
  assert.ok(snapshot(src).filter((x) => x.includes(':')).length >= filesBefore);
  assert.match(o.text(), /adopted: \d+ moved, 3 tasks created/);
});
