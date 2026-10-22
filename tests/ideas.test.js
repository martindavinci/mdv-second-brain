'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join } = require('node:path');
const { read, write, makeVault, daysAgo, ymd } = require('./helpers');
const ideas = require('../scripts/lib/ideas');

test('idea add groups by project and uses Tasks-plugin format', () => {
  const { ctx, vault: v } = makeVault();
  const now = new Date(2026, 9, 22);
  ideas.addIdea(ctx, 'Export EPUB', { project: 'alpha', now });
  ideas.addIdea(ctx, 'Dark theme', { now });
  ideas.addIdea(ctx, 'Batch export', { project: 'alpha', now });
  const text = read(join(v, '00_Inbox', 'Ideas.md'));
  assert.match(text, /^# Ideas\n/);
  assert.match(text, /## alpha\n\n- \[ \] Export EPUB 🆔 [a-z0-9]{6} ➕ 2026-10-22\n- \[ \] Batch export 🆔 [a-z0-9]{6} ➕ 2026-10-22\n/);
  assert.match(text, /## General\n\n- \[ \] Dark theme 🆔 [a-z0-9]{6} ➕ 2026-10-22\n/);
});

test('idea promote and discard mark lines, never delete them', () => {
  const { ctx, vault: v } = makeVault();
  const now = new Date(2026, 9, 22);
  ideas.addIdea(ctx, 'Partial refunds', { project: 'pay', now });
  ideas.addIdea(ctx, 'Dark theme', { project: 'pay', now });
  const [a, b] = ideas.listIdeas(ctx, {});
  ideas.promoteIdea(ctx, a.id, 'Payments — Refunds', new Date(2026, 9, 23));
  ideas.discardIdea(ctx, b.id, new Date(2026, 9, 24));
  const text = read(join(v, '00_Inbox', 'Ideas.md'));
  assert.match(text, new RegExp(`- \\[x\\] Partial refunds → \\[\\[Payments — Refunds\\]\\] 🆔 ${a.id} ➕ 2026-10-22 ✅ 2026-10-23`));
  assert.match(text, new RegExp(`- \\[-\\] ~~Dark theme~~ 🆔 ${b.id} ➕ 2026-10-22 ❌ 2026-10-24`));
  assert.deepEqual(ideas.listIdeas(ctx, { open: true }), []);
  assert.deepEqual(ideas.listIdeas(ctx, {}).map((i) => [i.text, i.state]), [['Partial refunds', 'promoted'], ['Dark theme', 'discarded']]);
  assert.throws(() => ideas.promoteIdea(ctx, 'zzzzzz', 'X'), /not-found/);
});

test('closed ideas older than 14 days move to Ideas Archive', () => {
  const { ctx, vault: v } = makeVault();
  const now = new Date();
  ideas.addIdea(ctx, 'Old one', { project: 'alpha', now: daysAgo(40, now) });
  ideas.addIdea(ctx, 'Recent one', { project: 'alpha', now: daysAgo(40, now) });
  ideas.addIdea(ctx, 'Still open', { project: 'alpha', now: daysAgo(40, now) });
  const [o, r] = ideas.listIdeas(ctx, {});
  ideas.discardIdea(ctx, o.id, daysAgo(20, now));
  ideas.promoteIdea(ctx, r.id, 'Recent Task', daysAgo(3, now));
  assert.equal(ideas.archiveIdeas(ctx, now, 14), 1);
  const arch = read(join(v, '90_Archive', 'Ideas Archive.md'));
  assert.match(arch, /## alpha\n\n- \[-\] ~~Old one~~/);
  const inbox = read(join(v, '00_Inbox', 'Ideas.md'));
  assert.doesNotMatch(inbox, /Old one/);
  assert.match(inbox, /Recent one/);
  assert.match(inbox, /Still open/);
  assert.ok(ymd(now));
});

test('idea ids are stable across edits and list respects limit', () => {
  const { ctx, vault: v } = makeVault();
  const f = join(v, '00_Inbox', 'Ideas.md');
  write(f, '# Ideas\n\nmy own intro text\n\n## alpha\n\n- [ ] hand written idea\n- [ ] another one\n- [ ] third\n');
  const first = ideas.listIdeas(ctx, { limit: 2 });
  assert.equal(first.length, 2);
  assert.match(read(f), /hand written idea 🆔 [a-z0-9]{6}/);
  assert.match(read(f), /my own intro text/);
  write(f, read(f).replace('another one', 'another one, reworded'));
  const again = ideas.listIdeas(ctx, {});
  assert.equal(again[0].id, first[0].id);
  assert.equal(again[1].id, first[1].id);
  assert.equal(again[1].text, 'another one, reworded');
  assert.equal(new Set(again.map((i) => i.id)).size, 3);
});

test('split project ideas go to its own file', () => {
  const { ctx, vault: v } = makeVault();
  write(join(v, '00_Inbox', 'alpha', 'alpha Plan.md'), require('../scripts/lib/board').emptyBoard());
  ideas.addIdea(ctx, 'Alpha thing', { project: 'alpha', now: new Date(2026, 9, 22) });
  assert.match(read(join(v, '00_Inbox', 'alpha', 'alpha Ideas.md')), /## alpha\n\n- \[ \] Alpha thing/);
  assert.equal(fs.existsSync(join(v, '00_Inbox', 'Ideas.md')), false);
  assert.equal(ideas.listIdeas(ctx, { project: 'alpha' }).length, 1);
});
