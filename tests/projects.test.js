'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join } = require('node:path');
const { read, makeVault } = require('./helpers');
const tasks = require('../scripts/lib/tasks');
const ideas = require('../scripts/lib/ideas');
const boards = require('../scripts/lib/boards');

test('split moves cards and ideas, never notes; merge restores', () => {
  const { ctx, vault: v, board } = makeVault();
  const a = tasks.addItem(ctx, 'task', { title: 'Alpha One', project: 'alpha', status: 'in-progress' });
  tasks.addItem(ctx, 'task', { title: 'Main Thing' });
  tasks.addItem(ctx, 'task', { title: 'Alpha Two', project: 'alpha' });
  tasks.addItem(ctx, 'task', { title: 'Alpha Three', project: 'alpha' });
  ideas.addIdea(ctx, 'alpha idea', { project: 'alpha' });
  ideas.addIdea(ctx, 'general idea', {});
  const noteBefore = read(a.file);
  const r = boards.splitProject(ctx, 'alpha');
  assert.deepEqual(r, { cardsMoved: 3, ideasMoved: 1 });
  const pb = read(join(v, '00_Inbox', 'alpha', 'alpha Plan.md'));
  assert.match(pb, /## ToDo\n\n- \[ \] \[\[Alpha Two\]\]\n- \[ \] \[\[Alpha Three\]\]\n/);
  assert.match(pb, /## In Progress\n\n- \[ \] \[\[Alpha One\]\]/);
  assert.doesNotMatch(read(board), /Alpha/);
  assert.match(read(board), /Main Thing/);
  assert.match(read(join(v, '00_Inbox', 'alpha', 'alpha Ideas.md')), /alpha idea/);
  assert.doesNotMatch(read(join(v, '00_Inbox', 'Ideas.md')), /alpha idea/);
  assert.ok(fs.existsSync(join(v, '00_Inbox', 'alpha', 'alpha Bugs.md')));
  assert.equal(read(a.file), noteBefore);
  const m = boards.mergeProject(ctx, 'alpha');
  assert.deepEqual(m, { cardsMoved: 3, ideasMoved: 1 });
  assert.equal(fs.existsSync(join(v, '00_Inbox', 'alpha')), false);
  assert.match(read(board), /## ToDo\n\n- \[ \] \[\[Main Thing\]\]\n- \[ \] \[\[Alpha Two\]\]\n- \[ \] \[\[Alpha Three\]\]\n/);
  assert.match(read(join(v, '00_Inbox', 'Ideas.md')), /## alpha\n\n- \[ \] alpha idea/);
  assert.equal(read(a.file), noteBefore);
});

test('split refuses Daily and an already split project', () => {
  const { ctx } = makeVault();
  assert.throws(() => boards.splitProject(ctx, 'Daily'), /reserved-name/);
  assert.throws(() => boards.splitProject(ctx, ' '), /reserved-name/);
  boards.splitProject(ctx, 'alpha');
  assert.throws(() => boards.splitProject(ctx, 'alpha'), /already-split/);
  assert.throws(() => boards.mergeProject(ctx, 'beta'), /not-split/);
});
