'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const { join, dirname } = require('node:path');
const config = require('../scripts/lib/config');

const tmp = fs.mkdtempSync(join(os.tmpdir(), 'sb-config-'));

test('missing config returns defaults', () => {
  const cfg = config.loadConfig(join(tmp, 'nope', 'config.json'));
  assert.equal(cfg.version, 1);
  assert.equal(cfg.stopThresholdMinutes, 0);
  assert.equal(cfg.archiveAfterDays, 14);
  assert.equal(cfg.dailyInboxDays, 7);
  assert.equal(cfg.git.mode, 'per-workspace');
  assert.equal(cfg.defaults.language, 'auto');
  assert.equal(cfg.budgets.hub, 4000);
  assert.equal(cfg.budgets.log, 6000);
  assert.deepEqual(cfg.capturePatterns, ['docs/superpowers/specs/', 'docs/superpowers/plans/']);
  assert.deepEqual(cfg.workspaces, {});
  assert.deepEqual(cfg.ignore, []);
});

test('invalid JSON throws invalid-config', () => {
  const bad = join(tmp, 'bad.json');
  fs.writeFileSync(bad, '{oops');
  assert.throws(() => config.loadConfig(bad), /invalid-config/);
});

test('partial config is deep-merged with defaults', () => {
  const f = join(tmp, 'partial.json');
  fs.writeFileSync(f, JSON.stringify({ budgets: { hub: 100 }, git: {} }));
  const cfg = config.loadConfig(f);
  assert.equal(cfg.budgets.hub, 100);
  assert.equal(cfg.budgets.log, 6000);
  assert.equal(cfg.git.mode, 'per-workspace');
});

test('save/load round-trip expands ~', () => {
  const f = join(tmp, 'rt', 'config.json');
  config.saveConfig({ root: '~/Brain', workspaces: { w: { paths: ['~/code'], vault: '~/v' } }, ignore: ['~/skip'] }, f);
  const text = fs.readFileSync(f, 'utf8');
  assert.ok(text.endsWith('\n'));
  assert.match(text, /\n  "root"/);
  const cfg = config.loadConfig(f);
  assert.equal(cfg.root, join(os.homedir(), 'Brain'));
  assert.deepEqual(cfg.workspaces.w.paths, [join(os.homedir(), 'code')]);
  assert.equal(cfg.workspaces.w.vault, join(os.homedir(), 'v'));
  assert.deepEqual(cfg.ignore, [join(os.homedir(), 'skip')]);
});

test('env override', () => {
  const f = join(tmp, 'env', 'c.json');
  const old = process.env.MDV_SECOND_BRAIN_CONFIG;
  process.env.MDV_SECOND_BRAIN_CONFIG = f;
  try {
    assert.equal(config.configPath(), f);
    assert.equal(config.configDir(), dirname(f));
    assert.equal(config.stateDir(), join(dirname(f), 'state'));
  } finally {
    if (old === undefined) delete process.env.MDV_SECOND_BRAIN_CONFIG; else process.env.MDV_SECOND_BRAIN_CONFIG = old;
  }
});

test('default config path lives under ~/.config', () => {
  const old = process.env.MDV_SECOND_BRAIN_CONFIG;
  delete process.env.MDV_SECOND_BRAIN_CONFIG;
  try {
    assert.equal(config.configPath(), join(os.homedir(), '.config', 'mdv-second-brain', 'config.json'));
  } finally {
    if (old !== undefined) process.env.MDV_SECOND_BRAIN_CONFIG = old;
  }
});

test('vaultPathFor and boardPathFor defaults', () => {
  const cfg = config.loadConfig(join(tmp, 'nope.json'));
  cfg.root = join(tmp, 'root');
  cfg.workspaces.a = { paths: [] };
  cfg.workspaces.b = { paths: [], vault: join(tmp, 'custom'), board: '00_Inbox/Board.md' };
  assert.equal(config.vaultPathFor(cfg, 'a'), join(tmp, 'root', 'a'));
  assert.equal(config.vaultPathFor(cfg, 'b'), join(tmp, 'custom'));
  assert.equal(config.boardPathFor(cfg, 'a'), '00_Inbox/Plan.md');
  assert.equal(config.boardPathFor(cfg, 'b'), '00_Inbox/Board.md');
});

test('assertWorkspaceName rejects "../x" and "a b"', () => {
  assert.throws(() => config.assertWorkspaceName('../x'));
  assert.throws(() => config.assertWorkspaceName('a b'));
  assert.throws(() => config.assertWorkspaceName(''));
  assert.doesNotThrow(() => config.assertWorkspaceName('mdv_2-x'));
});
