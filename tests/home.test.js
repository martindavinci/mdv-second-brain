'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { read, write, makeVault } = require('./helpers');
const tasks = require('../scripts/lib/tasks');
const ideas = require('../scripts/lib/ideas');
const home = require('../scripts/lib/home');
const markers = require('../scripts/lib/markers');
const { emptyBoard } = require('../scripts/lib/board');

test('rebuildHome fills generated sections and keeps user text', () => {
  const { ctx, vault: v } = makeVault();
  const f = join(v, 'Home.md');
  write(f, read(f) + '\nMy own notes stay here.\n');
  tasks.addItem(ctx, 'task', { title: 'Working On It', project: 'alpha', status: 'in-progress' });
  tasks.setBlocked(ctx, 'Working On It', true);
  write(join(v, '00_Inbox', 'Daily', '2026-10-20.md'), '# d\n');
  write(join(v, '00_Inbox', 'Daily', '2026-10-21.md'), '# d\n');
  write(join(v, 'DECISIONS.md'), '# Decisions\n\n- 2026-10-01 — use node → [[Stack]]\n');
  write(join(v, '10_Notes', 'Private.local.md'), '# secret prose\n');
  home.rebuildHome(ctx);
  const text = read(f);
  assert.match(text, /My own notes stay here\./);
  assert.match(markers.getSection(text, 'in-progress'), /- \[\[Working On It\]\] \(alpha\) 🔒/);
  assert.match(markers.getSection(text, 'daily'), /- \[\[2026-10-21\]\]\n- \[\[2026-10-20\]\]/);
  assert.match(markers.getSection(text, 'decisions'), /use node/);
  assert.doesNotMatch(text, /Private\.local/);
});

test('Home projects table has one row per project with board link and counts', () => {
  const { ctx, vault: v } = makeVault();
  write(join(v, '20_Projects', 'alpha', 'alpha.md'), '---\ntype: project\n---\n# alpha\n');
  write(join(v, '00_Inbox', 'beta', 'beta Plan.md'), emptyBoard());
  tasks.addItem(ctx, 'task', { title: 'A1', project: 'alpha', status: 'in-progress' });
  tasks.addItem(ctx, 'task', { title: 'A2', project: 'alpha' });
  tasks.addItem(ctx, 'issue', { title: 'B1', project: 'beta' });
  ideas.addIdea(ctx, 'beta idea', { project: 'beta' });
  home.rebuildHome(ctx);
  const table = markers.getSection(read(join(v, 'Home.md')), 'projects');
  const rows = table.split('\n').filter((l) => l.startsWith('| ') && !/^\| (Project|---)/.test(l));
  assert.equal(rows.length, 2);
  assert.match(rows[0], /^\| \[\[alpha\]\] \| \[\[Plan\]\] \| 1 \| 1 \| 0 \| 0 \| \d{4}-\d{2}-\d{2} \|$/);
  assert.match(rows[1], /^\| beta \| \[\[beta Plan\]\] \| 0 \| 1 \| 1 \| 1 \| \d{4}-\d{2}-\d{2} \|$/);
});

test('Home projects table follows a blank line, or Obsidian does not render it after the marker', () => {
  const { ctx, vault: v } = makeVault();
  tasks.addItem(ctx, 'task', { title: 'A1', project: 'alpha' });
  home.rebuildHome(ctx);
  assert.match(read(join(v, 'Home.md')), /<!-- brain:projects -->\n\n\| Project \|/);
  home.rebuildHome(ctx);
  assert.match(read(join(v, 'Home.md')), /<!-- brain:projects -->\n\n\| Project \|/, 'stable on rebuild');
});

test('rebuildHome fills the project-index of every hub', () => {
  const { ctx, vault: v } = makeVault();
  const hub = join(v, '20_Projects', 'alpha', 'alpha.md');
  write(hub, '---\ntype: project\n---\n# alpha\n\n## Summary\nmine\n');
  write(join(v, '20_Projects', 'alpha', 'alpha — Architecture.md'), '# arch\n');
  write(join(v, '20_Projects', 'alpha', 'Features', 'Exporter.md'), '---\ntype: feature\nlifecycle: available\n---\n');
  tasks.addItem(ctx, 'task', { title: 'Hub Task', project: 'alpha' });
  home.rebuildHome(ctx);
  const idx = markers.getSection(read(hub), 'project-index');
  assert.match(read(hub), /## Summary\nmine/);
  assert.match(idx, /\[\[Plan\]\]/);
  assert.match(idx, /\[\[Exporter\]\] \(available\)/);
  assert.match(idx, /\[\[Hub Task\]\] — todo/);
  assert.match(idx, /\[\[alpha — Architecture\]\]/);
});
