'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { read, write, makeVault } = require('./helpers');
const tasks = require('../scripts/lib/tasks');
const ideas = require('../scripts/lib/ideas');
const retrieve = require('../scripts/lib/retrieve');
const budget = require('../scripts/lib/budget');

test('search ranks names over body, skips archive by default, caps snippets', () => {
  const { ctx, vault: v } = makeVault();
  write(join(v, '10_Notes', 'Tooling.md'), '---\ntype: note\n---\n# Tooling\n\nWe use the parser generator here.\n');
  write(join(v, '20_Projects', 'alpha', 'Features', 'Parser.md'), '---\ntype: feature\nproject: "[[alpha]]"\n---\n# Parser\n\n## Rules\nnothing\n');
  write(join(v, '20_Projects', 'alpha', 'alpha — Architecture.md'), '---\ntype: note\n---\n# A\n\n## Parser layer\n' + 'x'.repeat(10) + '\n');
  write(join(v, '90_Archive', 'Tasks', 'Old Parser.md'), '# Old Parser\n');
  write(join(v, '10_Notes', 'Long.md'), '# Long\n\nparser ' + 'y'.repeat(500) + '\n');
  const hits = retrieve.search(ctx, 'parser', {});
  assert.equal(hits[0].name, 'Parser');
  assert.equal(hits[1].name, 'alpha — Architecture');
  assert.equal(hits[1].heading, 'Parser layer');
  assert.ok(!hits.some((h) => h.name === 'Old Parser'));
  assert.ok(hits.every((h) => h.snippet.length <= 200));
  assert.ok(retrieve.search(ctx, 'parser', { archive: true }).some((h) => h.name === 'Old Parser'));
  assert.deepEqual(retrieve.search(ctx, 'parser', { type: 'feature' }).map((h) => h.name), ['Parser']);
  assert.deepEqual(retrieve.search(ctx, 'parser', { project: 'alpha' }).map((h) => h.name).sort(), ['Parser', 'alpha — Architecture']);
  assert.equal(retrieve.search(ctx, 'parser', { limit: 1 }).length, 1);
});

test('search prefers current notes over log lines', () => {
  const { ctx } = makeVault();
  const a = tasks.addItem(ctx, 'task', { title: 'Alpha Work' });
  write(a.file, read(a.file) + '- 2026-10-01 — touched the zebra module\n');
  const b = tasks.addItem(ctx, 'task', { title: 'Beta Work' });
  write(b.file, read(b.file).replace('New, not started.', 'Rewriting the zebra module.'));
  assert.deepEqual(retrieve.search(ctx, 'zebra', {}).map((h) => h.name), ['Beta Work', 'Alpha Work']);
});

test('context stays under 2500 chars for a big project', () => {
  const { ctx, vault: v } = makeVault();
  write(join(v, '20_Projects', 'alpha', 'alpha.md'), '---\ntype: project\n---\n# alpha\n\n' + 'Summary paragraph. '.repeat(100) + '\n\n## Stack\nnode\n\n## Build\nnpm\n');
  for (let i = 0; i < 30; i++) tasks.addItem(ctx, 'task', { title: `Alpha task ${i}`, project: 'alpha', status: i % 2 ? 'in-progress' : 'todo' });
  tasks.addItem(ctx, 'issue', { title: 'Alpha bug', project: 'alpha' });
  ideas.addIdea(ctx, 'Alpha idea', { project: 'alpha' });
  const c = retrieve.context(ctx, 'alpha');
  assert.ok(c.length <= 2500, String(c.length));
  assert.match(c, /## Stack/);
  assert.match(c, /open bugs: 1/);
  assert.match(c, /open ideas: 1/);
  assert.equal(c.split('\n').filter((l) => /^- Alpha task/.test(l)).length, 10);
  assert.ok(c.split('\n').filter((l) => /^- Alpha task/.test(l)).every((l) => l.includes('[in-progress]')));
});

test('rotateLogs moves old log entries to the archive log note and keeps a link', () => {
  const { ctx, vault: v } = makeVault();
  ctx.budgets = { log: 300 };
  const r = tasks.addItem(ctx, 'task', { title: 'Chatty', project: 'alpha' });
  const entries = Array.from({ length: 20 }, (_, i) => `- 2026-10-${String(i + 1).padStart(2, '0')} — entry number ${i} with some words`);
  write(r.file, read(r.file).replace(/## Log\n[\s\S]*$/, `## Log\n${entries.join('\n')}\n`));
  assert.equal(budget.rotateLogs(ctx), 1);
  const note = read(r.file);
  const arch = read(join(v, '90_Archive', 'alpha', 'Tasks', 'Chatty — Log.md'));
  assert.match(note, /## Log\n→ \[\[Chatty — Log\]\]\n/);
  assert.ok(tasks.sectionOf(note.split('---\n').slice(2).join('---\n'), 'Log').length <= 300);
  for (const e of entries) assert.ok(note.includes(e) !== arch.includes(e), e);
  assert.ok(note.includes(entries[19]));
  assert.ok(arch.includes(entries[0]));
  assert.equal(budget.rotateLogs(ctx), 0);
});

test('budget.check reports oversize hub and MEMORY.md', () => {
  const { ctx, vault: v } = makeVault();
  ctx.budgets = { hub: 100, memory: 50, note: 8000, state: 600, decisions: 8000 };
  write(join(v, '20_Projects', 'alpha', 'alpha.md'), '# alpha\n' + 'h'.repeat(200));
  write(join(v, 'MEMORY.md'), '# Memory\n' + 'm'.repeat(100));
  const r = budget.check(ctx);
  assert.deepEqual(r.map((x) => x.file).sort(), ['20_Projects/alpha/alpha.md', 'MEMORY.md']);
  assert.equal(r.find((x) => x.file === 'MEMORY.md').budget, 50);
});

test('archiveDecisions moves old superseded lines only', () => {
  const { ctx, vault: v } = makeVault();
  write(join(v, 'DECISIONS.md'), '# Decisions\n\n- 2026-01-01 — ~~use X~~ → [[Y]]\n- 2026-01-02 — use Y → [[Y]]\n- 2026-10-20 — ~~recent~~ → [[Z]]\n');
  assert.equal(budget.archiveDecisions(ctx, new Date(2026, 9, 22), 14), 1);
  assert.doesNotMatch(read(join(v, 'DECISIONS.md')), /use X/);
  assert.match(read(join(v, 'DECISIONS.md')), /use Y/);
  assert.match(read(join(v, '90_Archive', 'Decisions Archive.md')), /~~use X~~/);
});
