'use strict';
// brain attention, the network part: GitHub drafts and CI through `gh`, tags missing on the remote, at most once per TTL.
// `gh` is always faked through the injected runner; git is real only where a test builds its own repos.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');
const git = require('../scripts/lib/git');
const attention = require('../scripts/lib/attention');

const hasGit = git.available();
const NOW = new Date(2026, 10, 22, 12);
const HOUR = 3600000;

// A fake runner: answers by command line, records every call, throws for what it does not know.
function fakeRun(answers) {
  const calls = [];
  const run = (cmd, args, cwd) => {
    calls.push([cmd, ...args]);
    const line = [cmd, ...args].join(' ');
    for (const [re, out] of answers) {
      if (!re.test(line)) continue;
      if (out instanceof Error) throw out;
      return typeof out === 'function' ? out(args, cwd) : out;
    }
    throw Object.assign(new Error(`unexpected: ${line}`), { status: 1 });
  };
  return { run, calls };
}

const GITHUB = [
  [/^git remote -v$/, 'origin\thttps://github.com/acme/app.git (fetch)\norigin\thttps://github.com/acme/app.git (push)\n'],
  [/^git tag --list$/, ''],
  [/^git ls-remote --tags origin$/, ''],
  [/^git symbolic-ref --short refs\/remotes\/origin\/HEAD$/, 'origin/main\n'],
  [/^gh auth status$/, ''],
];
const repos = [{ dir: join(os.tmpdir(), 'nowhere', 'app'), project: 'app' }];

test('gh_missing_skips_with_reason', () => {
  const { run, calls } = fakeRun([[/^gh /, Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' })], ...GITHUB]);
  const r = attention.collectRemote(repos, { run, now: NOW });
  assert.equal(r.ok, false);
  assert.match(r.reason, /gh not found/);
  assert.deepEqual(r.items, []);
  assert.deepEqual(calls.filter((c) => c[0] === 'gh').map((c) => c.join(' ')), ['gh auth status']);
  const unauth = fakeRun([[/^gh auth status$/, Object.assign(new Error('not logged in'), { status: 1 })], ...GITHUB]);
  const u = attention.collectRemote(repos, { run: unauth.run, now: NOW });
  assert.equal(u.ok, false);
  assert.match(u.reason, /not authenticated/);
});

test('draft_release_item_with_url', () => {
  const { run, calls } = fakeRun([
    [/^gh release list/, JSON.stringify([{ tagName: 'v1.2.0', isDraft: true, name: 'Spring' }, { tagName: 'v1.1.0', isDraft: false, name: 'v1.1.0' }])],
    [/^gh run list/, '[]'],
    ...GITHUB,
  ]);
  const r = attention.collectRemote(repos, { run, now: NOW });
  assert.equal(r.ok, true);
  const drafts = r.items.filter((i) => i.kind === 'draft-release');
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].project, 'app');
  assert.equal(drafts[0].severity, 'action');
  assert.match(drafts[0].title, /draft release Spring/);
  assert.deepEqual(drafts[0].actions.find((a) => a.type === 'open-url'), { type: 'open-url', label: 'Open releases', url: 'https://github.com/acme/app/releases' });
  assert.ok(calls.some((c) => c.join(' ') === 'gh release list -R acme/app --json tagName,isDraft,name -L 20'));
});

test('ci_failure_only_latest_run', () => {
  const failing = fakeRun([
    [/^gh release list/, '[]'],
    [/^gh run list/, JSON.stringify([{ conclusion: 'failure', status: 'completed', workflowName: 'CI', url: 'https://github.com/acme/app/actions/runs/7' }])],
    ...GITHUB,
  ]);
  const [ci] = attention.collectRemote(repos, { run: failing.run, now: NOW }).items.filter((i) => i.kind === 'ci-failed');
  assert.match(ci.title, /app: CI failed on main \(CI\)/);
  assert.deepEqual(ci.actions.find((a) => a.type === 'open-url').url, 'https://github.com/acme/app/actions/runs/7');
  const call = failing.calls.find((c) => c[0] === 'gh' && c[1] === 'run');
  assert.deepEqual(call, ['gh', 'run', 'list', '-R', 'acme/app', '--branch', 'main', '-L', '1', '--json', 'conclusion,status,workflowName,url']);
  // only the latest run counts: an older failure under a green run is history
  const green = fakeRun([
    [/^gh release list/, '[]'],
    [/^gh run list/, JSON.stringify([{ conclusion: 'success', status: 'completed', workflowName: 'CI', url: 'u2' }, { conclusion: 'failure', workflowName: 'CI', url: 'u1' }])],
    ...GITHUB,
  ]);
  assert.deepEqual(attention.collectRemote(repos, { run: green.run, now: NOW }).items.filter((i) => i.kind === 'ci-failed'), []);
});

test('tags_compared_with_remote', { skip: !hasGit }, () => {
  const t = fs.mkdtempSync(join(os.tmpdir(), 'sb-tags-'));
  const env = { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.invalid' };
  const g = (cwd, args) => execFileSync('git', args, { cwd, env, stdio: 'ignore' });
  const bare = join(t, 'app.git');
  const dir = join(t, 'app');
  fs.mkdirSync(bare);
  fs.mkdirSync(dir);
  g(bare, ['init', '-q', '--bare']);
  g(dir, ['init', '-q', '-b', 'main']);
  g(dir, ['commit', '-q', '--allow-empty', '-m', 'one']);
  g(dir, ['remote', 'add', 'origin', bare]);
  g(dir, ['tag', 'v1.0.0']);
  g(dir, ['tag', '-a', 'v1.1.0', '-m', 'annotated']);
  g(dir, ['push', '-q', 'origin', 'main', 'v1.0.0', 'v1.1.0']);
  g(dir, ['tag', 'v1.2.0']);
  g(dir, ['tag', 'v1.3.0']);
  // real git, and gh never reached: the remote is not on GitHub
  const real = (cmd, args, cwd) => {
    assert.equal(cmd, 'git');
    return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  };
  const r = attention.collectRemote([{ dir, project: 'app' }], { run: real, now: NOW });
  assert.equal(r.ok, true);
  const [it] = r.items;
  assert.equal(it.kind, 'tag-not-pushed');
  assert.match(it.title, /app: 2 tags not on origin/);
  assert.match(it.detail, /v1\.2\.0, v1\.3\.0/);
  assert.equal(it.actions.find((a) => a.type === 'copy').value, `git -C "${dir}" push origin v1.2.0 v1.3.0`);
  g(dir, ['push', '-q', 'origin', '--tags']);
  assert.deepEqual(attention.collectRemote([{ dir, project: 'app' }], { run: real, now: NOW }).items, []);
});

test('ttl_not_expired_reuses_previous_remote_items', () => {
  const draft = { kind: 'draft-release', severity: 'action', repo: repos[0].dir, ref: 'v1.2.0', project: 'app', title: 'app: draft release v1.2.0 not published', detail: '', actions: [], id: 'abcdefabcdef', firstSeen: new Date(NOW - 5 * HOUR).toISOString() };
  const gone = { ...draft, repo: join(os.tmpdir(), 'nowhere', 'removed'), ref: 'v0.1.0', id: '111111111111' };
  const local = { ...draft, kind: 'unpushed', ref: 'main', id: '222222222222' };
  const prev = { items: [draft, gone, local], remote: { ok: true, at: new Date(NOW - 2 * HOUR).toISOString(), tried: new Date(NOW - 2 * HOUR).toISOString() }, episodes: {}, snoozed: {}, done: [] };
  const never = () => assert.fail('no network within the TTL');
  const fresh = attention.remoteStep(prev, repos, { run: never, now: NOW, ttlHours: 6 });
  assert.deepEqual(fresh.items.map((i) => i.id), ['abcdefabcdef'], 'remote items of the repos still there, nothing local');
  assert.deepEqual(fresh.remote, prev.remote);
  const { run, calls } = fakeRun([[/^gh release list/, '[]'], [/^gh run list/, '[]'], ...GITHUB]);
  const expired = attention.remoteStep(prev, repos, { run, now: new Date(NOW.getTime() + 5 * HOUR), ttlHours: 6 });
  assert.ok(calls.length > 0);
  assert.deepEqual(expired.items, []);
  assert.equal(expired.remote.ok, true);
  assert.equal(expired.remote.at, new Date(NOW.getTime() + 5 * HOUR).toISOString());
  // forced, and gh gone: the remote is marked not ok and the last known GitHub items stay
  const missing = fakeRun([[/^gh /, Object.assign(new Error('ENOENT'), { code: 'ENOENT' })], ...GITHUB]);
  const forced = attention.remoteStep(prev, repos, { run: missing.run, now: NOW, ttlHours: 6, force: true });
  assert.equal(forced.remote.ok, false);
  assert.equal(forced.remote.at, prev.remote.at);
  assert.deepEqual(forced.items.map((i) => i.id), ['abcdefabcdef']);
});
