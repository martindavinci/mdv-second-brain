'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { read, write, makeVault } = require('./helpers');
const tasks = require('../scripts/lib/tasks');
const indexes = require('../scripts/lib/indexes');
const { emptyBoard } = require('../scripts/lib/board');

test('Bugs.md lists open issues by project with blocked marker', () => {
  const { ctx, vault: v } = makeVault();
  tasks.addItem(ctx, 'issue', { title: 'Crash On Save', project: 'alpha' });
  tasks.addItem(ctx, 'issue', { title: 'Old Bug', status: 'completed' });
  tasks.addItem(ctx, 'issue', { title: 'Stuck' });
  tasks.setBlocked(ctx, 'Stuck', true);
  const bugs = read(join(v, '00_Inbox', 'Bugs.md'));
  assert.match(bugs, /generated/i);
  assert.match(bugs, /## alpha\n\n- \[\[Crash On Save\]\] — todo/);
  assert.match(bugs, /- \[\[Stuck\]\] — todo 🔒/);
  assert.doesNotMatch(bugs, /Old Bug/);
});

test('Features.md groups by lifecycle', () => {
  const { ctx, vault: v } = makeVault();
  write(join(v, '20_Projects', 'alpha', 'Features', 'Exporter.md'), '---\ntype: feature\nlifecycle: available\nproject: "[[alpha]]"\n---\n');
  write(join(v, '20_Projects', 'alpha', 'Features', 'Importer.md'), '---\ntype: feature\nlifecycle: proposed\nproject: "[[alpha]]"\n---\n');
  write(join(v, '10_Notes', 'Features', 'Search.md'), '---\ntype: feature\nlifecycle: available\n---\n');
  indexes.rebuildIndexes(ctx);
  const f = read(join(v, '00_Inbox', 'Features.md'));
  assert.match(f, /## alpha\n\n### available\n\n- \[\[Exporter\]\]\n\n### proposed\n\n- \[\[Importer\]\]/);
  assert.match(f, /## General\n\n### available\n\n- \[\[Search\]\]/);
});

test('split project gets its own indexes and a pointer line in the root ones', () => {
  const { ctx, vault: v } = makeVault();
  write(join(v, '00_Inbox', 'alpha', 'alpha Plan.md'), emptyBoard());
  tasks.addItem(ctx, 'issue', { title: 'Alpha Bug', project: 'alpha' });
  const root = read(join(v, '00_Inbox', 'Bugs.md'));
  assert.match(root, /\[\[alpha Bugs\]\] — 1 open/);
  assert.doesNotMatch(root, /Alpha Bug/);
  assert.match(read(join(v, '00_Inbox', 'alpha', 'alpha Bugs.md')), /- \[\[Alpha Bug\]\] — todo/);
  assert.match(read(join(v, '00_Inbox', 'Features.md')), /\[\[alpha Features\]\]/);
});

test('indexes use the workspace language', () => {
  const { ctx, vault: v } = makeVault({ lang: 'it' });
  indexes.rebuildIndexes(ctx);
  assert.match(read(join(v, '00_Inbox', 'Bugs.md')), /Nessuna issue aperta/);
});
