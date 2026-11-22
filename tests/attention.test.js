'use strict';
// brain attention: the local queue of what waits for the user, its episodes and its cache.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');
const { write, makeVault } = require('./helpers');
const git = require('../scripts/lib/git');
const attention = require('../scripts/lib/attention');

const hasGit = git.available();
const DAY = 86400000;

function g(dir, args, date) {
  const env = { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.invalid' };
  if (date) Object.assign(env, { GIT_AUTHOR_DATE: date.toISOString(), GIT_COMMITTER_DATE: date.toISOString() });
  return execFileSync('git', args, { cwd: dir, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
const commit = (dir, msg = 'c', date) => g(dir, ['commit', '-q', '--allow-empty', '-m', msg], date);

// A repo under the workspace's code folder, optionally with a bare remote it tracks.
function repo(m, name, { remote = false, track = true, branch = 'main' } = {}) {
  const dir = join(m.code, name);
  fs.mkdirSync(dir, { recursive: true });
  g(dir, ['init', '-q', '-b', branch]);
  commit(dir, 'first');
  if (remote) {
    const bare = join(m.t, 'remotes', `${name}.git`);
    fs.mkdirSync(bare, { recursive: true });
    g(bare, ['init', '-q', '--bare', '-b', branch]);
    g(dir, ['remote', 'add', 'origin', bare]);
    if (track) g(dir, ['push', '-q', '-u', 'origin', branch]);
  }
  return dir;
}

const collect = (m, opts = {}) => attention.collectLocal({ ...m.ctx, ws: 'w' }, m.cfg, 'w', { now: new Date(), home: join(m.t, 'home'), ...opts });
const ofKind = (items, kind) => items.filter((i) => i.kind === kind);

test('reports_commits_ahead_with_push_command', { skip: !hasGit }, () => {
  const m = makeVault();
  const dir = repo(m, 'app', { remote: true });
  assert.deepEqual(ofKind(collect(m), 'unpushed'), []);
  commit(dir, 'a');
  commit(dir, 'b');
  const [it] = ofKind(collect(m), 'unpushed');
  assert.equal(it.project, 'app');
  assert.equal(it.severity, 'action');
  assert.match(it.title, /app: 2 commits to push/);
  assert.deepEqual(it.actions.find((a) => a.type === 'copy'), { type: 'copy', label: 'Push', value: `git -C "${dir}" push origin main` });
  assert.deepEqual(it.actions.find((a) => a.type === 'open-folder'), { type: 'open-folder', label: 'Open folder', path: dir });
});

test('no_upstream_only_on_main', { skip: !hasGit }, () => {
  const m = makeVault();
  const main = repo(m, 'onmain', { remote: true, track: false });
  repo(m, 'feature', { remote: true, track: false, branch: 'feature' });
  repo(m, 'local-only');
  const detached = repo(m, 'detached', { remote: true });
  commit(detached, 'x');
  g(detached, ['checkout', '-q', '--detach', 'HEAD~1']);
  const empty = join(m.code, 'empty');
  fs.mkdirSync(empty);
  g(empty, ['init', '-q', '-b', 'main']);
  const items = collect(m);
  const nu = ofKind(items, 'no-upstream');
  assert.deepEqual(nu.map((i) => i.project), ['onmain']);
  assert.equal(nu[0].actions.find((a) => a.type === 'copy').value, `git -C "${main}" push -u origin main`);
  assert.deepEqual(items.filter((i) => ['detached', 'empty', 'feature', 'local-only'].includes(i.project)), []);
});

test('dirty_only_after_three_days', { skip: !hasGit }, () => {
  const m = makeVault();
  const dir = repo(m, 'app');
  const now = new Date();
  const f = join(dir, 'notes.txt');
  write(f, 'x');
  const at = (days) => new Date(now.getTime() - days * DAY);
  fs.utimesSync(f, at(2), at(2));
  assert.deepEqual(ofKind(collect(m, { now }), 'dirty'), []);
  fs.utimesSync(f, at(4), at(4));
  const [it] = ofKind(collect(m, { now }), 'dirty');
  assert.equal(it.project, 'app');
  assert.match(it.title, /uncommitted/);
  assert.match(it.detail, /4 days/);
});

test('vault_unpushed_after_three_days_is_info', { skip: !hasGit }, () => {
  const m = makeVault({ gitMode: 'per-workspace' });
  const now = new Date();
  commit(m.vault, 'base', new Date(now.getTime() - 10 * DAY));
  const bare = join(m.t, 'vault.git');
  fs.mkdirSync(bare);
  const branch = g(m.vault, ['branch', '--show-current']).trim();
  g(bare, ['init', '-q', '--bare']);
  g(m.vault, ['remote', 'add', 'origin', bare]);
  g(m.vault, ['push', '-q', '-u', 'origin', branch]);
  commit(m.vault, 'recent', new Date(now.getTime() - 1 * DAY));
  assert.deepEqual(ofKind(collect(m, { now }), 'vault-unpushed'), []);
  g(m.vault, ['commit', '-q', '--amend', '--allow-empty', '-m', 'older'], new Date(now.getTime() - 5 * DAY));
  const [it] = ofKind(collect(m, { now }), 'vault-unpushed');
  assert.equal(it.severity, 'info');
  assert.match(it.title, /vault: 1 commit to push/);
  assert.equal(it.actions.find((a) => a.type === 'copy').value, `git -C "${m.vault}" push origin ${branch}`);
});

test('plugin_behind_only_for_released_version', { skip: !hasGit }, () => {
  const m = makeVault();
  const dir = repo(m, 'plug');
  const home = join(m.t, 'home');
  write(join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'plug@mkt': [{ scope: 'user', installPath: join(home, 'cache'), version: '0.7.1' }], 'other@mkt': [{ scope: 'user', version: '0.1.0' }] } }));
  write(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'plug', version: '0.7.1' }));
  commit(dir, 'unreleased work');
  assert.deepEqual(ofKind(collect(m, { home }), 'plugin-behind'), []);
  write(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'plug', version: '0.10.0' }));
  const [it] = ofKind(collect(m, { home }), 'plugin-behind');
  assert.equal(it.project, 'plug');
  assert.match(it.detail, /0\.7\.1.*0\.10\.0/);
  assert.equal(it.actions.find((a) => a.type === 'copy').value, 'claude plugin update plug@mkt');
});

const unpushed = (repoDir = '/r/app') => ({ kind: 'unpushed', severity: 'action', repo: repoDir, ref: 'main', project: 'app', title: 'app: 1 commit to push', detail: '', actions: [] });

test('resolved_then_back_is_new_episode', () => {
  const t0 = new Date(2026, 10, 1, 10);
  const t1 = new Date(2026, 10, 2, 10);
  const t2 = new Date(2026, 10, 3, 10);
  const first = attention.computeEpisodes(null, [unpushed()], t0);
  assert.match(first[0].id, /^[0-9a-f]{12}$/);
  assert.equal(first[0].firstSeen, t0.toISOString());
  const c0 = attention.buildCache(null, first, t0);
  const again = attention.computeEpisodes(c0, [unpushed()], t1);
  assert.equal(again[0].id, first[0].id, 'still there: same episode');
  const c1 = attention.buildCache(c0, attention.computeEpisodes(c0, [], t1), t1);
  const back = attention.computeEpisodes(c1, [unpushed()], t2);
  assert.notEqual(back[0].id, first[0].id);
  assert.equal(back[0].firstSeen, t2.toISOString());
});

test('snoozed_until_date_then_back_same_id', () => {
  const m = makeVault();
  const t0 = new Date(2026, 10, 1, 10);
  const items = attention.computeEpisodes(null, [unpushed()], t0);
  attention.writeCache(m.vault, attention.buildCache(null, items, t0));
  const id = items[0].id;
  attention.snooze(m.vault, id, new Date(2026, 10, 3));
  assert.deepEqual(attention.visible(attention.readCache(m.vault), new Date(2026, 10, 2, 10)), []);
  // a refresh while snoozed keeps the episode and the snooze
  const t1 = new Date(2026, 10, 2, 12);
  const prev = attention.readCache(m.vault);
  attention.writeCache(m.vault, attention.buildCache(prev, attention.computeEpisodes(prev, [unpushed()], t1), t1));
  assert.deepEqual(attention.visible(attention.readCache(m.vault), new Date(2026, 10, 2, 23)), []);
  const shown = attention.visible(attention.readCache(m.vault), new Date(2026, 10, 3, 1));
  assert.deepEqual(shown.map((i) => i.id), [id]);
  assert.throws(() => attention.snooze(m.vault, 'nope', new Date(2026, 10, 9)), /unknown-item/);
});

test('done_only_for_questions', () => {
  const m = makeVault();
  const now = new Date(2026, 10, 1, 10);
  const q = attention.addQuestion(m.vault, { session: 'sess-1', text: 'Publish the draft release?', now });
  assert.match(q.id, /^[0-9a-f]{12}$/);
  const items = attention.computeEpisodes(null, [unpushed(), ...attention.questionItems(m.vault)], now);
  attention.writeCache(m.vault, attention.buildCache(null, items, now));
  const question = items.find((i) => i.kind === 'question');
  assert.equal(question.id, q.id);
  assert.equal(question.firstSeen, now.toISOString());
  assert.throws(() => attention.done(m.vault, items.find((i) => i.kind === 'unpushed').id), /not-a-question/);
  attention.done(m.vault, q.id);
  assert.deepEqual(attention.visible(attention.readCache(m.vault), now).map((i) => i.kind), ['unpushed']);
  assert.deepEqual(attention.readQuestions(m.vault), []);
  assert.throws(() => attention.done(m.vault, q.id), /unknown-item/);
});

test('ignored_repos_skipped', { skip: !hasGit }, () => {
  const m = makeVault();
  const keep = repo(m, 'keep', { remote: true });
  const skip = repo(m, 'skip', { remote: true });
  commit(keep, 'k');
  commit(skip, 's');
  m.cfg.ignore.push(skip);
  assert.deepEqual(ofKind(collect(m), 'unpushed').map((i) => i.project), ['keep']);
});

test('the cache file is written whole (temp file and rename)', () => {
  const m = makeVault();
  const now = new Date(2026, 10, 1, 10);
  attention.writeCache(m.vault, attention.buildCache(null, attention.computeEpisodes(null, [unpushed()], now), now));
  const dir = join(m.vault, '.brain');
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes('attention')), ['attention.json']);
  assert.equal(attention.readCache(m.vault).items.length, 1);
  fs.writeFileSync(join(dir, 'attention.json'), '{half');
  assert.equal(attention.readCache(m.vault), null);
});
