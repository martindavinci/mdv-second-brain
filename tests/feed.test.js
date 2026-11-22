'use strict';
// The attention feed: one file per workspace, written whole and only when its content changed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const { join } = require('node:path');
const { defaults, saveConfig } = require('../scripts/lib/config');
const { main } = require('../scripts/brain');
const feed = require('../scripts/lib/feed');
const attention = require('../scripts/lib/attention');

const T0 = new Date(2026, 10, 22, 10);
const item = (over = {}) => ({ kind: 'unpushed', severity: 'action', repo: '/r/app', ref: 'main', project: 'app', title: 'app: 1 commit to push (main)', detail: 'main is 1 ahead of origin/main', actions: [{ type: 'copy', label: 'Push', value: 'git -C "/r/app" push origin main' }], ...over });

function cacheOf(items, now = T0, remote = { ok: true, at: T0.toISOString(), tried: T0.toISOString() }) {
  return attention.buildCache(null, attention.computeEpisodes(null, items, now), now, remote);
}

test('build: the v1 envelope and public item fields only; snoozed and done items left out', () => {
  const c = cacheOf([item(), item({ kind: 'dirty', ref: '' })]);
  c.snoozed[c.items[1].id] = new Date(T0.getTime() + 86400000).toISOString();
  const f = feed.build(c, 'w', T0);
  assert.deepEqual(Object.keys(f), ['format', 'version', 'source', 'workspace', 'generatedAt', 'remote', 'items']);
  assert.equal(f.format, 'attention-feed');
  assert.equal(f.version, 1);
  assert.equal(f.source, 'mdv-second-brain');
  assert.equal(f.generatedAt, T0.toISOString());
  assert.deepEqual(f.remote, { ok: true, at: T0.toISOString() });
  assert.equal(f.items.length, 1);
  assert.deepEqual(Object.keys(f.items[0]), ['id', 'kind', 'severity', 'title', 'detail', 'project', 'firstSeen', 'actions']);
  assert.deepEqual(feed.build(cacheOf([], T0, { ok: false, reason: 'gh not found', tried: T0.toISOString() }), 'w', T0).remote, { ok: false, reason: 'gh not found' });
});

test('feed_written_atomically_only_on_change', () => {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'sb-feed-'));
  const c = cacheOf([item()]);
  const first = feed.write(dir, 'w', feed.build(c, 'w', T0));
  assert.deepEqual(first, { written: true, file: join(dir, 'brain-w.json') });
  const old = new Date(2020, 0, 1);
  fs.utimesSync(first.file, old, old);
  // only the generation time differs: the file stays as it is
  assert.equal(feed.write(dir, 'w', feed.build(c, 'w', new Date(T0.getTime() + 60000))).written, false);
  assert.equal(fs.statSync(first.file).mtimeMs, old.getTime());
  const changed = cacheOf([item({ title: 'app: 2 commits to push (main)' })]);
  assert.equal(feed.write(dir, 'w', feed.build(changed, 'w', T0)).written, true);
  assert.match(fs.readFileSync(first.file, 'utf8'), /2 commits/);
  assert.deepEqual(fs.readdirSync(dir), ['brain-w.json'], 'no temp file left behind');
  assert.throws(() => feed.write(join(dir, 'missing'), 'w', feed.build(c, 'w', T0)), /feed folder missing/);
  assert.equal(fs.existsSync(join(dir, 'missing')), false);
});

test('feed_never_mixes_workspaces', async () => {
  const t = fs.mkdtempSync(join(os.tmpdir(), 'sb-feeds-'));
  const shared = join(t, 'feeds');
  fs.mkdirSync(shared);
  const cfgFile = join(t, 'cfg', 'config.json');
  const cfg = defaults();
  cfg.root = join(t, 'root');
  for (const ws of ['alpha', 'beta']) {
    fs.mkdirSync(join(t, `${ws}-code`));
    cfg.workspaces[ws] = { paths: [join(t, `${ws}-code`)], language: 'en', git: { mode: 'none' }, attention: { outputs: [{ type: 'feed', dir: shared }] } };
  }
  saveConfig(cfg, cfgFile);
  const cli = async (ws, ...args) => {
    const err = [];
    const code = await main(['--config', cfgFile, '--session', `s-${ws}`, ...args], { cwd: join(t, `${ws}-code`), home: join(t, 'home'), run: () => assert.fail('no network'), stdout: { write() {} }, stderr: { write: (s) => err.push(s) } });
    assert.equal(code, 0, err.join(''));
  };
  await cli('alpha', 'checkpoint', '--ask', 'Alpha question?');
  await cli('beta', 'checkpoint', '--ask', 'Beta question?');
  await cli('alpha', 'attention', '--refresh', '--quiet');
  await cli('beta', 'attention', '--refresh', '--quiet');
  assert.deepEqual(fs.readdirSync(shared).sort(), ['brain-alpha.json', 'brain-beta.json']);
  const a = JSON.parse(fs.readFileSync(join(shared, 'brain-alpha.json'), 'utf8'));
  const b = JSON.parse(fs.readFileSync(join(shared, 'brain-beta.json'), 'utf8'));
  assert.equal(a.workspace, 'alpha');
  assert.deepEqual(a.items.map((i) => i.title), ['Alpha question?']);
  assert.equal(b.workspace, 'beta');
  assert.deepEqual(b.items.map((i) => i.title), ['Beta question?']);
  assert.doesNotMatch(JSON.stringify(a), /beta/i);
  assert.doesNotMatch(JSON.stringify(b), /alpha/i);
});
