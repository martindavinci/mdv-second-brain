'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join } = require('node:path');
const { read, write, makeVault, daysAgo, ymd } = require('./helpers');
const tasks = require('../scripts/lib/tasks');
const boards = require('../scripts/lib/boards');
const frontmatter = require('../scripts/lib/frontmatter');
const state = require('../scripts/lib/state');

const fm = (f) => frontmatter.parse(read(f)).data;

test('addItem task creates note in Tasks/ and ToDo card', () => {
  const { ctx, vault: v, board } = makeVault();
  const r = tasks.addItem(ctx, 'task', { title: 'Export PDF', project: 'mdv-tools', feature: 'Exporter' });
  assert.equal(r.file, join(v, '20_Projects', 'mdv-tools', 'Tasks', 'Export PDF.md'));
  assert.match(read(board), /## ToDo\n\n- \[ \] \[\[Export PDF\]\]/);
  const data = fm(r.file);
  assert.equal(data.type, 'task');
  assert.equal(data.status, 'todo');
  assert.equal(data.project, '[[mdv-tools]]');
  assert.equal(data.feature, '[[Exporter]]');
  assert.match(read(r.file), /## Status[\s\S]*## Log/);
});

test('addItem issue without project lands in 10_Notes/Issues', () => {
  const { ctx, vault: v } = makeVault();
  const r = tasks.addItem(ctx, 'issue', { title: 'Crash On Save' });
  assert.equal(r.file, join(v, '10_Notes', 'Issues', 'Crash On Save.md'));
  assert.equal(fm(r.file).type, 'issue');
  assert.equal(fm(r.file).project, undefined);
});

test('reserved project name gets the (project) suffix', () => {
  const { ctx, vault: v } = makeVault();
  assert.equal(tasks.projectName('Tasks'), 'Tasks (project)');
  assert.equal(tasks.projectName('daily'), 'daily (project)');
  assert.equal(tasks.projectName('my-repo'), 'my-repo');
  const r = tasks.addItem(ctx, 'task', { title: 'Do it', project: 'Tasks' });
  assert.equal(r.file, join(v, '20_Projects', 'Tasks (project)', 'Tasks', 'Do it.md'));
});

test('duplicate name in another folder is refused', () => {
  const { ctx, vault: v } = makeVault();
  write(join(v, '20_Projects', 'alpha', 'Features', 'Payments.md'), '---\ntype: feature\n---\n');
  assert.throws(() => tasks.addItem(ctx, 'task', { title: 'payments' }), (e) => e.message === 'name-taken' && e.file.endsWith('Payments.md'));
  assert.throws(() => tasks.addItem(ctx, 'task', { title: 'Plan' }), /name-taken/);
});

test('noteName strips illegal characters and refuses empty titles', () => {
  assert.equal(tasks.noteName('  C++/Server:  fix? '), 'C++Server fix');
  assert.equal(tasks.noteName('Perché #2'), 'Perché 2');
  assert.equal(tasks.noteName('x'.repeat(150)).length, 100);
  assert.throws(() => tasks.noteName(' /:? '), /empty-title/);
});

test('board wins: dragged card updates status and completed_at', () => {
  const { ctx, board } = makeVault();
  const r = tasks.addItem(ctx, 'task', { title: 'Fix Login' });
  write(board, read(board).replace('## ToDo\n\n- [ ] [[Fix Login]]\n', '## ToDo\n').replace('## Completed\n', '## Completed\n\n- [ ] [[Fix Login]]\n'));
  const res = tasks.syncFromBoard(ctx);
  assert.equal(res.statusChanged, 1);
  assert.equal(fm(r.file).status, 'completed');
  assert.equal(fm(r.file).completed_at, ymd(new Date()));
  assert.match(read(board), /- \[x\] \[\[Fix Login\]\]/);
  write(board, read(board).replace('- [x] [[Fix Login]]\n', '').replace('## ToDo\n', '## ToDo\n\n- [ ] [[Fix Login]]\n'));
  tasks.syncFromBoard(ctx);
  assert.equal(fm(r.file).status, 'todo');
  assert.equal(fm(r.file).completed_at, '');
});

test('free-text card becomes a task note', () => {
  const { ctx, vault: v, board } = makeVault();
  write(board, read(board).replace('## In Progress\n', '## In Progress\n\n- [ ] Call vendor\n'));
  const res = tasks.syncFromBoard(ctx);
  assert.equal(res.notesCreated, 1);
  const f = join(v, '10_Notes', 'Tasks', 'Call vendor.md');
  assert.equal(fm(f).status, 'in-progress');
  assert.match(read(board), /## In Progress\n\n- \[ \] \[\[Call vendor\]\]\n/);
});

test('card pointing to a feature is reported, not converted', () => {
  const { ctx, vault: v, board } = makeVault();
  write(join(v, '10_Notes', 'Features', 'Exporter.md'), '---\ntype: feature\nlifecycle: available\n---\n# Exporter\n');
  write(board, read(board).replace('## ToDo\n', '## ToDo\n\n- [ ] [[Exporter]]\n'));
  const res = tasks.syncFromBoard(ctx);
  assert.deepEqual(res.featureCards, ['Exporter']);
  assert.equal(fm(join(v, '10_Notes', 'Features', 'Exporter.md')).status, undefined);
  assert.match(read(board), /- \[ \] \[\[Exporter\]\]/);
});

test('sync keeps unknown lanes and card order', () => {
  const { ctx, board } = makeVault();
  tasks.addItem(ctx, 'task', { title: 'A' });
  tasks.addItem(ctx, 'task', { title: 'B' });
  write(board, read(board).replace('- [ ] [[A]]\n- [ ] [[B]]\n', '- [ ] [[B]]\n- [ ] [[A]]\n').replace('## Discarded\n', '## Ideas\n\n- [ ] dark theme maybe\n\n## Discarded\n'));
  const before = read(board);
  tasks.syncFromBoard(ctx);
  assert.equal(read(board), before);
});

test('notes with a status and no card get one', () => {
  const { ctx, vault: v, board } = makeVault();
  write(join(v, '10_Notes', 'Issues', 'Leak.md'), '---\ntype: issue\nstatus: in-progress\n---\n# Leak\n');
  assert.equal(tasks.syncFromBoard(ctx).cardsAdded, 1);
  assert.match(read(board), /## In Progress\n\n- \[ \] \[\[Leak\]\]/);
});

test('titles with illegal characters map to one stable note', () => {
  const { ctx, vault: v } = makeVault();
  tasks.addItem(ctx, 'task', { title: 'C++/Server: fix?' });
  tasks.syncFromBoard(ctx);
  tasks.syncFromBoard(ctx);
  assert.equal(fs.readdirSync(join(v, '10_Notes', 'Tasks')).filter((f) => f.startsWith('C++')).length, 1);
});

test('move, done and block keep card and note in sync', () => {
  const { ctx, board } = makeVault();
  const r = tasks.addItem(ctx, 'task', { title: 'Ship It' });
  tasks.moveItem(ctx, 'ship it', 'in-progress');
  assert.match(read(board), /## In Progress\n\n- \[ \] \[\[Ship It\]\]/);
  tasks.setBlocked(ctx, 'Ship It', true);
  assert.equal(fm(r.file).blocked, true);
  assert.deepEqual(fm(r.file).tags, ['status/blocked']);
  assert.match(read(board), /## In Progress\n\n- \[ \] \[\[Ship It\]\]/);
  tasks.setBlocked(ctx, 'Ship It', false);
  assert.deepEqual(fm(r.file).tags, []);
  tasks.moveItem(ctx, 'Ship It', 'completed');
  assert.match(read(board), /## Completed\n\n- \[x\] \[\[Ship It\]\]/);
  assert.throws(() => tasks.moveItem(ctx, 'Ship It', 'blocked'), /bad-status/);
  assert.throws(() => tasks.moveItem(ctx, 'Nope', 'todo'), /not-found/);
});

test('delete archives the note, never removes it', () => {
  const { ctx, vault: v, board } = makeVault();
  tasks.addItem(ctx, 'task', { title: 'Gone', project: 'alpha' });
  const dest = tasks.deleteItem(ctx, 'Gone');
  assert.equal(dest, join(v, '90_Archive', 'alpha', 'Tasks', 'Gone.md'));
  assert.ok(fs.existsSync(dest));
  assert.ok(!fs.existsSync(join(v, '20_Projects', 'alpha', 'Tasks', 'Gone.md')));
  assert.doesNotMatch(read(board), /Gone/);
  assert.equal(tasks.findNote(v, 'Gone'), null);
});

test('archive mirrors the origin path', () => {
  const { vault: v } = makeVault();
  assert.equal(tasks.archiveDir(v, join(v, '20_Projects', 'alpha', 'Tasks', 'X.md')), join(v, '90_Archive', 'alpha', 'Tasks'));
  assert.equal(tasks.archiveDir(v, join(v, '10_Notes', 'Issues', 'Y.md')), join(v, '90_Archive', 'Issues'));
});

test('archiveDone uses completed_at, covers Discarded, notes follow', () => {
  const { ctx, vault: v, board } = makeVault();
  const now = new Date();
  const mk = (title, status, ago) => {
    const r = tasks.addItem(ctx, 'task', { title, status });
    const data = frontmatter.parse(read(r.file));
    data.data.completed_at = ymd(daysAgo(ago, now));
    data.data.updated = ymd(daysAgo(1, now));
    write(r.file, frontmatter.stringify(data.data, data.body));
    return r.file;
  };
  mk('Old Done', 'completed', 20);
  mk('Old Drop', 'discarded', 30);
  const recent = mk('New Done', 'completed', 3);
  const archived = tasks.archiveDone(ctx, now, 14);
  assert.deepEqual(archived.sort(), ['Old Done', 'Old Drop']);
  const arch = read(join(v, '90_Archive', 'Plan Archive.md'));
  assert.match(arch, /kanban-plugin: board/);
  assert.match(arch, /## Plan\n\n- \[x\] \[\[Old Done\]\]\n- \[ \] \[\[Old Drop\]\]/);
  assert.ok(fs.existsSync(join(v, '90_Archive', 'Tasks', 'Old Done.md')));
  assert.ok(fs.existsSync(recent));
  assert.match(read(board), /New Done/);
  assert.doesNotMatch(read(board), /Old Done|Old Drop/);
});

test('listItems and showItem', () => {
  const { ctx } = makeVault();
  tasks.addItem(ctx, 'task', { title: 'One', project: 'alpha' });
  tasks.addItem(ctx, 'issue', { title: 'Two', status: 'in-progress' });
  assert.deepEqual(tasks.listItems(ctx, {}).map((i) => i.name), ['Two', 'One']);
  assert.deepEqual(tasks.listItems(ctx, { project: 'alpha' }).map((i) => i.name), ['One']);
  assert.deepEqual(tasks.listItems(ctx, { kind: 'issue' }).map((i) => i.status), ['in-progress']);
  const shown = tasks.showItem(ctx, 'One', { section: 'log' });
  assert.match(shown, /^One · task · todo · project alpha/);
  assert.match(shown, /created/);
  assert.doesNotMatch(shown, /## Status/);
  const short = tasks.showItem(ctx, 'One', { maxChars: 20 });
  assert.match(short, /… \(truncated, \d+ more chars\)$/);
});

test('split project: add routes the card to its board', () => {
  const { ctx, vault: v, board } = makeVault();
  write(join(v, '00_Inbox', 'alpha', 'alpha Plan.md'), require('../scripts/lib/board').emptyBoard());
  assert.equal(boards.isSplit(ctx, 'alpha'), true);
  assert.deepEqual(boards.listBoards(ctx).map((b) => b.project), [null, 'alpha']);
  tasks.addItem(ctx, 'issue', { title: 'Alpha Bug', project: 'alpha' });
  assert.match(read(join(v, '00_Inbox', 'alpha', 'alpha Plan.md')), /\[\[Alpha Bug\]\]/);
  assert.doesNotMatch(read(board), /Alpha Bug/);
});

test('hand-written card of a split project on Plan.md is routed on sync', () => {
  const { ctx, vault: v, board } = makeVault();
  tasks.addItem(ctx, 'task', { title: 'Route Me', project: 'alpha', status: 'in-progress' });
  write(join(v, '00_Inbox', 'alpha', 'alpha Plan.md'), require('../scripts/lib/board').emptyBoard());
  const res = tasks.syncFromBoard(ctx);
  assert.equal(res.cardsRouted, 1);
  assert.match(read(join(v, '00_Inbox', 'alpha', 'alpha Plan.md')), /## In Progress\n\n- \[ \] \[\[Route Me\]\]/);
  assert.doesNotMatch(read(board), /Route Me/);
});

test('archive lanes are named after the source board', () => {
  const { ctx, vault: v } = makeVault();
  write(join(v, '00_Inbox', 'alpha', 'alpha Plan.md'), require('../scripts/lib/board').emptyBoard());
  const old = (title, project) => {
    const r = tasks.addItem(ctx, 'task', { title, project, status: 'completed' });
    const d = frontmatter.parse(read(r.file));
    d.data.completed_at = ymd(daysAgo(30));
    write(r.file, frontmatter.stringify(d.data, d.body));
  };
  old('Main Old');
  old('Alpha Old', 'alpha');
  tasks.archiveDone(ctx, new Date(), 14);
  const arch = read(join(v, '90_Archive', 'Plan Archive.md'));
  assert.match(arch, /## Plan\n\n- \[x\] \[\[Main Old\]\]/);
  assert.match(arch, /## alpha Plan\n\n- \[x\] \[\[Alpha Old\]\]/);
});

test('cli writes are stamped per session only', () => {
  const { vault: v } = makeVault();
  state.markCliWrite(v, 'abc', new Date('2026-01-01T10:00:00Z'));
  assert.equal(state.cliLastWrite(v, 'abc').toISOString(), '2026-01-01T10:00:00.000Z');
  assert.equal(state.cliLastWrite(v, 'other'), null);
  state.markCliWrite(v, undefined);
  assert.deepEqual(fs.readdirSync(join(v, '.brain', 'state')), ['abc.cli']);
});
