'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');
const { read, write, makeVault } = require('./helpers');
const git = require('../scripts/lib/git');
const stale = require('../scripts/lib/stale');
const { buildSessionContext } = require('../scripts/lib/context');

const hasGit = git.available();

function commit(dir, n, date) {
  const env = { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.invalid' };
  if (date) Object.assign(env, { GIT_AUTHOR_DATE: `${date}T12:00:00Z`, GIT_COMMITTER_DATE: `${date}T12:00:00Z` });
  for (let i = 0; i < n; i++) execFileSync('git', ['commit', '-q', '--allow-empty', '-m', `c${i}`], { cwd: dir, env });
}
const tag = (dir, name) => execFileSync('git', ['tag', name], { cwd: dir });

function setup({ updated = '2026-02-01' } = {}) {
  const m = makeVault();
  const dir = join(m.code, 'app');
  fs.mkdirSync(dir, { recursive: true });
  git.init(dir);
  commit(dir, 2, '2026-01-10');
  const hub = join(m.vault, '20_Projects', 'app.md');
  write(hub, `---\ntype: project\nupdated: ${updated}\n---\n# app\n\n## Summary\nWhat app is.\n\n<!-- brain:repo -->\n## Repo\n- 2 commits\n<!-- /brain:repo -->\n`);
  return { ...m, dir, hub, repo: { project: 'app', dir } };
}

test('a hub is stale after a new tag or more than 20 commits since its text changed', { skip: !hasGit }, () => {
  const s = setup();
  stale.track(s.vault, [s.repo]);
  assert.equal(stale.check(s.vault, s.repo), null);
  commit(s.dir, 20, '2026-03-01');
  assert.equal(stale.check(s.vault, s.repo), null, '20 commits are not enough');
  commit(s.dir, 1, '2026-03-02');
  assert.deepEqual(stale.check(s.vault, s.repo), { project: 'app', hub: '20_Projects/app.md', commits: 21, tags: [] });
  // the text changes: fresh again, even before the next index
  write(s.hub, read(s.hub).replace('What app is.', 'What app is now.'));
  assert.equal(stale.check(s.vault, s.repo), null);
  stale.track(s.vault, [s.repo]);
  commit(s.dir, 3, '2026-03-03');
  tag(s.dir, 'v1.0.0');
  assert.deepEqual(stale.check(s.vault, s.repo), { project: 'app', hub: '20_Projects/app.md', commits: 3, tags: ['v1.0.0'] });
});

test('generated sections and the frontmatter never make a hub look fresh', { skip: !hasGit }, () => {
  const s = setup();
  stale.track(s.vault, [s.repo]);
  commit(s.dir, 21, '2026-03-01');
  write(s.hub, read(s.hub).replace('- 2 commits', '- 23 commits').replace('updated: 2026-02-01', 'updated: 2026-03-05'));
  stale.track(s.vault, [s.repo]);
  assert.equal(stale.check(s.vault, s.repo).commits, 21);
});

test('a hub never tracked starts from the repo as it was on its updated day', { skip: !hasGit }, () => {
  const s = setup({ updated: '2026-02-01' });
  commit(s.dir, 21, '2026-03-01');
  assert.equal(stale.check(s.vault, s.repo).commits, 21);
  stale.track(s.vault, [s.repo]);
  assert.equal(stale.check(s.vault, s.repo).commits, 21);
  const fresh = setup({ updated: '2026-04-01' });
  commit(fresh.dir, 21, '2026-03-01');
  assert.equal(stale.check(fresh.vault, fresh.repo), null);
});

test('no hub, no repo, an unreadable repo or a rewritten history give no warning', { skip: !hasGit }, () => {
  const s = setup();
  assert.equal(stale.check(s.vault, { project: 'other', dir: s.dir }), null);
  assert.equal(stale.check(s.vault, { project: 'app', dir: join(s.code, 'missing') }), null);
  stale.track(s.vault, [s.repo]);
  const rec = JSON.parse(read(join(s.vault, '.brain', 'hubs.json')));
  rec.app.head = '0123456789abcdef0123456789abcdef01234567';
  write(join(s.vault, '.brain', 'hubs.json'), JSON.stringify(rec));
  assert.equal(stale.check(s.vault, s.repo), null);
});

test('the warning names the hub, what changed and what to do', () => {
  const line = stale.message({ project: 'app', hub: '20_Projects/app.md', commits: 52, tags: ['v0.4.0', 'v0.5.0', 'v0.6.0'] });
  assert.match(line, /20_Projects\/app\.md/);
  assert.match(line, /3 new tags \(v0\.4\.0 … v0\.6\.0\)/);
  assert.match(line, /52 commits/);
  assert.match(line, /rewrite/);
  assert.match(stale.message({ project: 'app', hub: 'h.md', commits: 21, tags: [] }), /^stale hub: h\.md — 21 commits since/);
  const ctx = buildSessionContext({ ws: 'w', vault: 'v', lang: 'en', cli: 'c', sid: 's', dailyFile: 'd', marker: 'm', project: 'app', projectNoteExists: true, staleHub: line });
  assert.ok(ctx.includes(line));
});
