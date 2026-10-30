'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join } = require('node:path');
const { read, write, makeVault, io } = require('./helpers');
const { main } = require('../scripts/brain');
const health = require('../scripts/lib/health');

const NOW = new Date(2026, 9, 30, 12, 0);
const task = (status, updated, extra = '') => `---\ntype: task\nstatus: ${status}\nproject: "[[alpha]]"\nupdated: ${updated}\n${extra}---\n# x\n`;

function vaultWithProject() {
  const r = makeVault();
  write(join(r.vault, '20_Projects', 'alpha.md'), '---\ntype: project\nstatus: active\n---\n# alpha\n');
  return r;
}

test('health finds broken links, but not links to archived notes, attachments or text in code', () => {
  const { vault: v, ctx } = vaultWithProject();
  write(join(v, '90_Archive', '10_Notes', 'Old.md'), '# old\n');
  write(join(v, '80_Assets', 'diagram.png'), 'png');
  write(join(v, '10_Notes', 'Links.md'), [
    '---', 'type: note', 'related: "[[Ghost in frontmatter]]"', '---',
    'See [[alpha]], [[alpha#Gotcha]], [[alpha|the project]], [[Old]], ![[diagram.png]] and [[Nowhere]].',
    '`[[Inline code]]`', '```', '[[In a fence]]', '```', '',
  ].join('\n'));
  const r = health.check(ctx, { now: NOW });
  assert.deepEqual(r.broken.map((b) => [b.file, b.target]), [['10_Notes/Links.md', 'Ghost in frontmatter'], ['10_Notes/Links.md', 'Nowhere']]);
});

test('health reads a dotted note name as a note and skips links that are only punctuation', () => {
  const { vault: v, ctx } = vaultWithProject();
  write(join(v, '10_Notes', 'Release 0.3.0.md'), '# r\n');
  write(join(v, '10_Notes', 'Links.md'), 'See [[Release 0.3.0]] and broken [[…]] or [[...]], not [[Release 9.9]].\n');
  assert.deepEqual(health.check(ctx, { now: NOW }).broken.map((b) => b.target), ['Release 9.9']);
});

test('health --fix repoints a link with exactly one certain match and keeps the shown text', () => {
  const { vault: v, ctx } = vaultWithProject();
  write(join(v, '10_Notes', 'Payments Refunds.md'), '---\ntype: note\n---\n# p\n');
  write(join(v, '10_Notes', 'Café Notes.md'), '# c\n');
  write(join(v, '10_Notes', 'Twin A.md'), '# a\n');
  write(join(v, '10_Notes', 'Twin-A!.md'), '# b\n');
  write(join(v, '10_Notes', 'Links.md'), 'Go [[payments-refunds]], [[cafe notes|the café]], [[Payments: Refunds]], [[twin+a]], [[Nowhere]].\n```\n[[payments-refunds]]\n```\n');
  const r = health.check(ctx, { now: NOW, fix: true });
  assert.deepEqual(r.fixed.map((f) => [f.target, f.to]), [['payments-refunds', 'Payments Refunds'], ['cafe notes', 'Café Notes'], ['Payments: Refunds', 'Payments Refunds']]);
  assert.equal(read(join(v, '10_Notes', 'Links.md')), 'Go [[Payments Refunds|payments-refunds]], [[Café Notes|the café]], [[Payments Refunds|Payments: Refunds]], [[twin+a]], [[Nowhere]].\n```\n[[payments-refunds]]\n```\n');
  assert.deepEqual(r.broken.map((b) => [b.target, b.candidates]), [['twin+a', ['Twin A', 'Twin-A!']], ['Nowhere', []]]);
});

test('health reports stale in-progress items, notes without frontmatter, duplicate names and orphans', () => {
  const { vault: v, ctx } = vaultWithProject();
  const dir = join(v, '20_Projects', 'alpha', 'Tasks');
  write(join(dir, 'Stale.md'), task('in-progress', '2026-10-01'));
  write(join(dir, 'Fresh.md'), task('in-progress', '2026-10-25'));
  write(join(dir, 'Old but done.md'), task('completed', '2026-01-01'));
  write(join(v, '20_Projects', 'alpha', 'Features', 'Bare.md'), '# no frontmatter\n');
  write(join(v, '10_Notes', 'Same.md'), '# a\n');
  write(join(v, '20_Projects', 'alpha', 'Same.md'), '# b\n');
  write(join(v, '10_Notes', 'Linked.md'), '# l\n');
  write(join(v, '10_Notes', 'Lonely.md'), '# lonely\n');
  write(join(v, 'MEMORY.md'), '# Memory\n- see [[Linked]]\n');
  const r = health.check(ctx, { now: NOW, days: 14 });
  assert.deepEqual(r.stale.map((s) => [s.name, s.days]), [['Stale', 29]]);
  assert.deepEqual(r.noFrontmatter, ['20_Projects/alpha/Features/Bare.md']);
  assert.deepEqual(r.duplicates, [{ name: 'Same', files: ['10_Notes/Same.md', '20_Projects/alpha/Same.md'] }]);
  assert.ok(r.orphans.includes('10_Notes/Lonely.md'));
  assert.ok(!r.orphans.includes('10_Notes/Linked.md'));
  // the vault's own files, inbox and dailies are never orphans
  assert.ok(!r.orphans.some((f) => /^(AGENTS|Home|MEMORY)\.md$|^00_Inbox\//.test(f)), r.orphans.join(', '));
});

test('health --fix removes empty folders, never the vault skeleton', () => {
  const { vault: v, ctx } = vaultWithProject();
  fs.mkdirSync(join(v, '20_Projects', 'alpha', 'Tasks'), { recursive: true });
  let r = health.check(ctx, { now: NOW });
  assert.deepEqual(r.emptyFolders, ['20_Projects/alpha/Tasks', '20_Projects/alpha']);
  r = health.check(ctx, { now: NOW, fix: true });
  assert.ok(!fs.existsSync(join(v, '20_Projects', 'alpha')));
  assert.ok(fs.existsSync(join(v, '10_Notes', 'Tasks')));
  assert.deepEqual(r.removedFolders, ['20_Projects/alpha/Tasks', '20_Projects/alpha']);
});

test('cli health prints a summary and exits 0', async () => {
  const { cfgFile, code, vault: v } = vaultWithProject();
  write(join(v, '10_Notes', 'Payments Refunds.md'), '# p\n');
  write(join(v, '10_Notes', 'Links.md'), '[[Nowhere]] [[alpha]] [[payments-refunds]]\n');
  const o = io();
  assert.equal(await main(['--config', cfgFile, 'health'], { cwd: code, ...o }), 0);
  assert.match(o.text(), /broken links: 2\n- 10_Notes\/Links\.md → \[\[Nowhere\]\]\n- 10_Notes\/Links\.md → \[\[payments-refunds\]\] \(fix: Payments Refunds\)/);
  assert.match(o.text(), /brain health --fix/);
});
