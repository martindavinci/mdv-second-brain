'use strict';
// brain attention in the hooks: Stop starts a detached refresh at most every two minutes per workspace; SessionStart
// adds one line read from the cache, never from git.
const cp = require('node:child_process');

// counted before any module of the plugin takes its own reference to execFileSync
const gitCalls = [];
const realExecFileSync = cp.execFileSync;
cp.execFileSync = (cmd, ...rest) => {
  if (cmd === 'git') gitCalls.push(rest[0]);
  return realExecFileSync(cmd, ...rest);
};

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const { join } = require('node:path');
const { write } = require('./helpers');
const { defaults, saveConfig, localConfigFile } = require('../scripts/lib/config');
const { run } = require('../scripts/hook');
const { main } = require('../scripts/brain');
const { attentionLine } = require('../scripts/lib/context');

function env({ attention } = {}) {
  const t = fs.mkdtempSync(join(os.tmpdir(), 'sb-atthook-'));
  const cfgFile = join(t, 'cfg', 'config.json');
  const cfg = defaults();
  cfg.root = join(t, 'root');
  cfg.workspaces.alpha = { paths: [join(t, 'alpha-code')], language: 'en', git: { mode: 'none' }, ...(attention ? { attention } : {}) };
  saveConfig(cfg, cfgFile);
  fs.mkdirSync(join(t, 'alpha-code', 'repo'), { recursive: true });
  const now = new Date(2026, 10, 22, 10, 0);
  const spawned = [];
  const spawn = (cmd, args, options) => spawned.push({ cmd, args, options });
  const call = (event, input, min = 0, opts = {}) => run(event, { session_id: 'sess-att-0001', cwd: join(t, 'alpha-code', 'repo'), ...input }, { now: new Date(now.getTime() + min * 60000), cli: '/x/brain.js', cfgFile, home: join(t, 'home'), spawn, ...opts }).stdout;
  return { t, cfgFile, call, spawned, vault: join(t, 'root', 'alpha') };
}

const ctxOf = (out) => (out ? JSON.parse(out).hookSpecificOutput.additionalContext : '');

function cacheWith(vault, items, extra = {}) {
  const full = items.map((it, i) => ({ id: `id${i}`.padEnd(12, '0'), severity: 'action', repo: null, ref: '', project: null, title: it.kind, detail: '', actions: [], firstSeen: '2026-11-21T10:00:00.000Z', ...it }));
  write(join(vault, '.brain', 'attention.json'), JSON.stringify({ version: 1, at: '2026-11-22T09:00:00.000Z', remote: { ok: true }, items: full, snoozed: {}, done: [], episodes: {}, ...extra }));
  return full;
}

test('stop_spawns_once_per_two_minutes', () => {
  const e = env();
  e.call('session-start', { source: 'startup' });
  assert.equal(e.call('stop', {}), '');
  assert.equal(e.spawned.length, 1);
  const [s] = e.spawned;
  assert.equal(s.cmd, process.execPath);
  assert.deepEqual(s.args, ['/x/brain.js', '--config', e.cfgFile, '--workspace', 'alpha', 'attention', '--refresh', '--quiet']);
  assert.equal(s.options.detached, true);
  assert.equal(s.options.stdio, 'ignore');
  assert.equal(s.options.windowsHide, true);
  e.call('stop', {}, 1);
  // a parallel session in the same workspace, seconds later
  e.call('session-start', { session_id: 'sess-att-0002', source: 'startup' }, 1);
  e.call('stop', { session_id: 'sess-att-0002' }, 1.5);
  assert.equal(e.spawned.length, 1);
  e.call('stop', {}, 3);
  assert.equal(e.spawned.length, 2);
  // the continuation of a blocked stop is not a new turn
  e.call('stop', { stop_hook_active: true }, 10);
  assert.equal(e.spawned.length, 2);
});

test('stop in project mode or outside the brain spawns nothing', () => {
  const e = env();
  e.call('stop', { cwd: join(e.t, 'elsewhere') });
  assert.equal(e.spawned.length, 0);
  const local = join(e.t, 'proj');
  fs.mkdirSync(local, { recursive: true });
  const lcfg = { ...defaults(), local: true, workspaces: { proj: { language: 'en', git: { mode: 'none' } } } };
  saveConfig(lcfg, localConfigFile(local));
  const spawned = [];
  const o = { now: new Date(2026, 10, 22, 10), cli: '/x/brain.js', cfgFile: localConfigFile(local), home: join(e.t, 'home'), spawn: (...a) => spawned.push(a) };
  run('session-start', { session_id: 'sess-local-1', cwd: local, source: 'startup' }, o);
  run('stop', { session_id: 'sess-local-1', cwd: local }, o);
  assert.equal(spawned.length, 0);
});

test('session_start_line_from_cache_only', () => {
  const e = env();
  e.call('session-start', { session_id: 'sess-warm', source: 'startup' });
  cacheWith(e.vault, [
    { kind: 'unpushed', repo: join(e.t, 'gone', 'a'), project: 'a' },
    { kind: 'unpushed', repo: join(e.t, 'gone', 'b'), project: 'b' },
    { kind: 'draft-release', project: 'a' },
    { kind: 'question' },
  ]);
  const before = gitCalls.length;
  const c = ctxOf(e.call('session-start', { source: 'startup' }));
  assert.equal(gitCalls.length, before, 'no git at session start');
  const line = c.split('\n').find((l) => l.startsWith('waiting for the user:'));
  assert.equal(line, 'waiting for the user: 2 to push, 1 draft release, 1 question — `attention` lists them');
  assert.ok(line.length <= 200);
});

test('line_excludes_current_project_hub_and_checks', () => {
  const e = env();
  cacheWith(e.vault, [
    { kind: 'stale-hub', project: 'repo', severity: 'info' },
    { kind: 'playbook', project: 'repo' },
    { kind: 'playbook-suggestion', project: 'repo', severity: 'info' },
    { kind: 'unpushed', project: 'repo' },
    { kind: 'stale-hub', project: 'other', severity: 'info' },
  ]);
  const c = ctxOf(e.call('session-start', { source: 'startup' }));
  assert.match(c, /^waiting for the user: 1 to push, 1 outgrown hub — `attention` lists them$/m);
  // a long queue stays one line
  const many = Array.from({ length: 13 }, (_, i) => ({ kind: ['unpushed', 'no-upstream', 'tag-not-pushed', 'dirty', 'draft-release', 'ci-failed', 'playbook', 'plugin-behind', 'question', 'stale-hub', 'playbook-suggestion', 'stalled', 'vault-unpushed'][i], project: `p${i}` }));
  const line = attentionLine({ items: many.map((x, i) => ({ ...x, id: String(i) })), snoozed: {}, done: [] }, { now: new Date(), project: null });
  assert.ok(line.length <= 200, String(line.length));
  assert.match(line, /^waiting for the user: 1 to push, /);
  assert.match(line, /more — `attention` lists them$/);
});

test('no_line_when_empty', () => {
  const e = env();
  assert.doesNotMatch(ctxOf(e.call('session-start', { source: 'startup' })), /waiting for the user/, 'no cache yet');
  const [it] = cacheWith(e.vault, [{ kind: 'unpushed', project: 'a' }]);
  write(join(e.vault, '.brain', 'attention.json'), JSON.stringify({ items: [it], snoozed: { [it.id]: '2026-11-30T00:00:00.000Z' }, done: [] }));
  assert.doesNotMatch(ctxOf(e.call('session-start', { session_id: 'sess-2', source: 'startup' })), /waiting for the user/, 'only snoozed items');
  cacheWith(e.vault, [{ kind: 'stale-hub', project: 'repo' }]);
  assert.doesNotMatch(ctxOf(e.call('session-start', { session_id: 'sess-3', source: 'startup' })), /waiting for the user/, 'only what the project lines say');
  write(join(e.vault, '.brain', 'attention.json'), '{broken');
  assert.doesNotMatch(ctxOf(e.call('session-start', { session_id: 'sess-4', source: 'startup' })), /waiting for the user/, 'a broken cache');
});

test('hook_silent_when_feed_dir_unwritable', async () => {
  const e = env({ attention: { outputs: [{ type: 'feed', dir: join(os.tmpdir(), 'sb-no-such-folder', String(process.pid)) }] } });
  e.call('session-start', { source: 'startup' });
  assert.equal(e.call('stop', {}), '');
  assert.equal(e.spawned.length, 1);
  // the detached run, here in-process: it prints nothing, writes the cache and logs the feed error once
  const refresh = async () => {
    const out = [];
    const code = await main(e.spawned[0].args.slice(1), { cwd: e.spawned[0].options.cwd, home: join(e.t, 'home'), run: () => assert.fail('no network'), stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => out.push(s) } });
    assert.equal(code, 0);
    assert.equal(out.join(''), '');
  };
  await refresh();
  await refresh();
  assert.ok(fs.existsSync(join(e.vault, '.brain', 'attention.json')));
  const log = fs.readFileSync(join(e.t, 'cfg', 'error.log'), 'utf8').trim().split('\n');
  assert.equal(log.length, 1);
  assert.match(log[0], /attention feed .*feed folder missing/);
});

test('a background refresh that fails logs once and prints nothing', async () => {
  const e = env({ attention: { outputs: [{ type: 'feed', dir: 'not/absolute' }] } });
  e.call('session-start', { source: 'startup' });
  e.call('stop', {});
  for (let i = 0; i < 2; i++) {
    const out = [];
    const code = await main(e.spawned[0].args.slice(1), { cwd: e.vault, home: join(e.t, 'home'), run: () => assert.fail('no network'), stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => out.push(s) } });
    assert.equal(code, 0);
    assert.equal(out.join(''), '');
  }
  const log = fs.readFileSync(join(e.t, 'cfg', 'error.log'), 'utf8').trim().split('\n');
  assert.equal(log.length, 1);
  assert.match(log[0], /attention --refresh: invalid attention block for workspace alpha: outputs\[0\]\.dir/);
});
