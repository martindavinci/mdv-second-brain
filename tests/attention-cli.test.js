'use strict';
// brain attention from the CLI: the queue, snooze and done, questions queued with checkpoint --ask, the config block.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');
const { makeVault } = require('./helpers');
const { main } = require('../scripts/brain');
const config = require('../scripts/lib/config');
const git = require('../scripts/lib/git');

const hasGit = git.available();

// git is real (the repos are temp folders), gh is never there
const noGh = (cmd, args, cwd) => {
  if (cmd === 'gh') throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' });
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
};

function cliFor(m, { cwd = m.code, home = join(m.t, 'home') } = {}) {
  return async (args, { now } = {}) => {
    const out = [];
    const err = [];
    const code = await main(['--config', m.cfgFile, ...args], { cwd, home, run: noGh, now, stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) } });
    return { code, out: out.join(''), err: err.join(''), json: () => JSON.parse(out.join('')) };
  };
}

function g(dir, args) {
  const env = { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.invalid' };
  execFileSync('git', args, { cwd: dir, env, stdio: 'ignore' });
}

// A repo with one commit not pushed to its (local, bare) remote.
function ahead(m, name = 'app') {
  const dir = join(m.code, name);
  const bare = join(m.t, 'remotes', `${name}.git`);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(bare, { recursive: true });
  g(bare, ['init', '-q', '--bare', '-b', 'main']);
  g(dir, ['init', '-q', '-b', 'main']);
  g(dir, ['commit', '-q', '--allow-empty', '-m', 'one']);
  g(dir, ['remote', 'add', 'origin', bare]);
  g(dir, ['push', '-q', '-u', 'origin', 'main']);
  g(dir, ['commit', '-q', '--allow-empty', '-m', 'two']);
  return dir;
}

test('attention_json_lists_items', { skip: !hasGit }, async () => {
  const m = makeVault();
  const dir = ahead(m);
  const cli = cliFor(m);
  const r = await cli(['--json', 'attention']);
  assert.equal(r.code, 0, r.err);
  const feed = r.json();
  assert.equal(feed.format, 'attention-feed');
  assert.equal(feed.version, 1);
  assert.equal(feed.workspace, 'w');
  assert.deepEqual(feed.remote, { ok: true, at: feed.remote.at });
  const [it] = feed.items.filter((i) => i.kind === 'unpushed');
  assert.deepEqual(Object.keys(it).sort(), ['actions', 'detail', 'firstSeen', 'id', 'kind', 'project', 'severity', 'title']);
  assert.equal(it.actions[0].value, `git -C "${dir}" push origin main`);
  assert.ok(fs.existsSync(join(m.vault, '.brain', 'attention.json')));
  const human = await cli(['attention']);
  assert.match(human.out, new RegExp(`- ${it.id} app: 1 commit to push`));
  // from the cache: a pushed repo still shows until the next refresh
  g(dir, ['push', '-q']);
  assert.equal((await cli(['--json', 'attention'])).json().items.filter((i) => i.kind === 'unpushed').length, 1);
  assert.equal((await cli(['--json', 'attention', '--refresh'])).json().items.filter((i) => i.kind === 'unpushed').length, 0);
  assert.equal((await cli(['attention', '--refresh', '--quiet'])).out, '');
});

test('snooze_hides_until_date', { skip: !hasGit }, async () => {
  const m = makeVault();
  ahead(m);
  const cli = cliFor(m);
  const now = new Date(2026, 10, 22, 12);
  const id = (await cli(['--json', 'attention'], { now })).json().items[0].id;
  assert.equal((await cli(['attention', 'snooze', id, '--until', '2026-11-20'], { now })).code, 2, 'a date in the past');
  assert.equal((await cli(['attention', 'snooze', 'nope', '--until', '2026-11-25'], { now })).code, 2);
  const s = await cli(['attention', 'snooze', id, '--until', '2026-11-25'], { now });
  assert.equal(s.code, 0, s.err);
  assert.match(s.out, /until 2026-11-25/);
  assert.deepEqual((await cli(['--json', 'attention'], { now })).json().items, []);
  assert.deepEqual((await cli(['--json', 'attention', '--refresh'], { now: new Date(2026, 10, 24, 9) })).json().items, []);
  const back = (await cli(['--json', 'attention'], { now: new Date(2026, 10, 25, 9) })).json().items;
  assert.deepEqual(back.map((i) => i.id), [id]);
  // without a date: hidden until tomorrow
  const t = await cli(['attention', 'snooze', id], { now: new Date(2026, 10, 25, 9) });
  assert.match(t.out, /until 2026-11-26/);
});

test('done_refused_for_detectable_kinds', { skip: !hasGit }, async () => {
  const m = makeVault();
  ahead(m);
  const cli = cliFor(m);
  const id = (await cli(['--json', 'attention'])).json().items[0].id;
  const r = await cli(['attention', 'done', id]);
  assert.equal(r.code, 2);
  assert.match(r.err, /only for questions/);
  assert.match(r.err, /snooze/);
});

test('checkpoint_ask_then_done', async () => {
  const m = makeVault();
  const cli = cliFor(m);
  assert.equal((await cli(['checkpoint', '--ask', 'no session'])).code, 2);
  const a = await cli(['--json', '--session', 'sess-ask-1', 'checkpoint', '--ask', 'Publish the 0.9.0 draft release now?']);
  assert.equal(a.code, 0, a.err);
  const qid = a.json().question.id;
  const human = await cli(['--session', 'sess-ask-1', 'checkpoint', '--ask', 'Rename the repo?']);
  assert.match(human.out, /question queued: [0-9a-f]{12} — once the user answers: brain attention done [0-9a-f]{12}/);
  // the daily is untouched by a question
  assert.equal(fs.existsSync(join(m.vault, '.brain', 'state', 'sess-ask-1.cli')), false);
  const list = (await cli(['--json', 'attention'])).json().items.filter((i) => i.kind === 'question');
  assert.deepEqual(list.map((i) => i.title), ['Publish the 0.9.0 draft release now?', 'Rename the repo?']);
  assert.equal(list[0].id, qid);
  assert.equal((await cli(['attention', 'done', qid])).code, 0);
  assert.deepEqual((await cli(['--json', 'attention'])).json().items.map((i) => i.title), ['Rename the repo?']);
  assert.equal((await cli(['attention', 'done', qid])).code, 2);
});

test('config_rejects_bad_attention_block', async () => {
  const ok = { workspaces: { w: { attention: { outputs: [{ type: 'feed', dir: os.tmpdir() }], remoteTtlHours: 2 } } } };
  assert.deepEqual(config.attentionFor(ok, 'w'), { outputs: [{ type: 'feed', dir: os.tmpdir() }], remoteTtlHours: 2 });
  assert.deepEqual(config.attentionFor({ workspaces: { w: {} } }, 'w'), { outputs: [], remoteTtlHours: 6 });
  for (const bad of [
    'yes',
    { outputs: {} },
    { outputs: [{ type: 'mail', dir: os.tmpdir() }] },
    { outputs: [{ type: 'feed' }] },
    { outputs: [{ type: 'feed', dir: 'relative/folder' }] },
    { outputs: [{ type: 'feed', path: os.tmpdir() }] },
    { remoteTtlHours: -1 },
    { remoteTtlHours: '6' },
    { output: [] },
  ]) assert.throws(() => config.attentionFor({ workspaces: { w: { attention: bad } } }, 'w'), /invalid-attention/, JSON.stringify(bad));
  const m = makeVault({ ws: { attention: { outputs: [{ type: 'feed', dir: 'relative' }] } } });
  const r = await cliFor(m)(['attention']);
  assert.equal(r.code, 2);
  assert.match(r.err, /attention.*outputs\[0\]\.dir/);
});

test('project_mode_says_unsupported', async () => {
  const t = fs.mkdtempSync(join(os.tmpdir(), 'sb-attproj-'));
  const proj = join(t, 'my-app');
  fs.mkdirSync(proj);
  const run = async (args) => {
    const out = [];
    const err = [];
    const code = await main(args, { cwd: proj, env: { MDV_SECOND_BRAIN_CONFIG: join(t, 'global', 'config.json') }, home: join(t, 'home'), run: noGh, stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) } });
    return { code, err: err.join('') };
  };
  assert.equal((await run(['--session', 's-p-1', 'init', '--here', '--language', 'en', '--git-mode', 'none'])).code, 0);
  const r = await run(['attention']);
  assert.equal(r.code, 2);
  assert.match(r.err, /project mode/);
  assert.equal((await run(['--session', 's-p-1', 'checkpoint', '--ask', 'q?'])).code, 2);
  assert.equal(fs.existsSync(join(proj, 'SecondBrain', '.brain', 'attention.json')), false);
});

test('workspace_attention_sets_and_clears_the_feed_folder', async () => {
  const m = makeVault();
  const cli = cliFor(m);
  const dir = join(m.t, 'feeds');
  assert.equal((await cli(['workspace', 'attention', 'w', '--feed-dir', dir])).code, 2, 'a missing folder is refused');
  fs.mkdirSync(dir);
  const set = await cli(['workspace', 'attention', 'w', '--feed-dir', dir, '--remote-ttl', '3']);
  assert.equal(set.code, 0, set.err);
  let a = config.attentionFor(config.loadConfig(m.cfgFile), 'w');
  assert.deepEqual(a, { outputs: [{ type: 'feed', dir }], remoteTtlHours: 3 });
  assert.match((await cli(['workspace', 'attention', 'w'])).out, /feeds/);
  assert.equal((await cli(['workspace', 'attention', 'w', '--remote-ttl', 'soon'])).code, 2);
  assert.equal((await cli(['workspace', 'attention', 'nope', '--feed-dir', dir])).code, 2);
  assert.equal((await cli(['workspace', 'attention', 'w', '--no-feed'])).code, 0);
  a = config.attentionFor(config.loadConfig(m.cfgFile), 'w');
  assert.deepEqual(a.outputs, []);
  assert.equal(a.remoteTtlHours, 3, 'the other setting is kept');
});
