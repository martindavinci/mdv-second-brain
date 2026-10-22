'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const { join } = require('node:path');
const { resolveWorkspace, projectFor, relatedCandidates } = require('../scripts/lib/resolve');
const { defaults } = require('../scripts/lib/config');

const t = fs.mkdtempSync(join(os.tmpdir(), 'sb-resolve-'));

function cfgWith(workspaces, ignore = []) {
  const cfg = defaults();
  cfg.root = join(t, 'root');
  cfg.workspaces = workspaces;
  cfg.ignore = ignore;
  return cfg;
}

const cfg = cfgWith({
  work: { paths: [join(t, 'work')] },
  blog: { paths: [join(t, 'work', 'Blog')] },
  side: { paths: [join(t, 'side')], vault: join(t, 'work', 'notes-vault') },
}, [join(t, 'work', 'tmp')]);

test('longest path prefix wins', () => {
  const a = resolveWorkspace(cfg, join(t, 'work', 'repo', 'x.js'));
  assert.equal(a.status, 'mapped');
  assert.equal(a.name, 'work');
  assert.equal(a.via, 'path');
  assert.equal(a.mappedDir, join(t, 'work'));
  assert.equal(a.vault, join(t, 'root', 'work'));
  assert.equal(resolveWorkspace(cfg, join(t, 'work', 'Blog', 'a')).name, 'blog');
});

test('prefix match respects path boundaries', () => {
  assert.equal(resolveWorkspace(cfg, join(t, 'work-old')).status, 'unmapped');
  assert.equal(resolveWorkspace(cfg, join(t, 'work-old', 'f.md')).status, 'unmapped');
});

test('vault maps to its own workspace even inside another mapped path', () => {
  const r = resolveWorkspace(cfg, join(t, 'work', 'notes-vault', '10_Notes', 'a.md'));
  assert.equal(r.status, 'mapped');
  assert.equal(r.name, 'side');
  assert.equal(r.via, 'vault');
});

test('ignored folder', () => {
  assert.equal(resolveWorkspace(cfg, join(t, 'work', 'tmp', 'x')).status, 'ignored');
});

test('unmapped folder', () => {
  assert.equal(resolveWorkspace(cfg, join(t, 'elsewhere')).status, 'unmapped');
});

test('resolves across separator and case differences on win32', { skip: process.platform !== 'win32' }, () => {
  const p = join(t, 'work', 'Repo').replace(/\\/g, '/').toUpperCase() + '/';
  const r = resolveWorkspace(cfg, p);
  assert.equal(r.status, 'mapped');
  assert.equal(r.name, 'work');
});

test('projectFor returns first segment with original casing', () => {
  assert.equal(projectFor(cfg, 'work', join(t, 'work', 'My-Repo', 'src', 'a.js')), 'My-Repo');
  assert.equal(projectFor(cfg, 'work', join(t, 'work')), null);
  assert.equal(projectFor(cfg, 'side', join(t, 'work', 'notes-vault', 'x.md')), null);
  assert.equal(projectFor(cfg, 'work', join(t, 'elsewhere', 'a')), null);
});

test('relatedCandidates finds -suffix siblings both ways', () => {
  const d = join(t, 'siblings');
  for (const n of ['game', 'game-src', 'gamex', 'other']) fs.mkdirSync(join(d, n), { recursive: true });
  fs.writeFileSync(join(d, 'game-notes'), 'a file, not a dir');
  assert.deepEqual(relatedCandidates(d, 'game'), ['game-src']);
  assert.deepEqual(relatedCandidates(d, 'game-src'), ['game']);
  assert.deepEqual(relatedCandidates(d, 'other'), []);
  assert.deepEqual(relatedCandidates(join(d, 'missing'), 'game'), []);
});
