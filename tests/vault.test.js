'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');
const vault = require('../scripts/lib/vault');
const git = require('../scripts/lib/git');
const { defaults, loadConfig, saveConfig, vaultPathFor } = require('../scripts/lib/config');

const read = (f) => fs.readFileSync(f, 'utf8');
const hasGit = git.available();

function setup(ws = {}) {
  const t = fs.mkdtempSync(join(os.tmpdir(), 'sb-vault-'));
  const cfgFile = join(t, 'cfg', 'config.json');
  const cfg = defaults();
  cfg.root = join(t, 'root');
  cfg.workspaces.w = { paths: [join(t, 'code')], ...ws };
  saveConfig(cfg, cfgFile);
  return { t, cfgFile, cfg: loadConfig(cfgFile) };
}

test('ensureVault requires language when auto', () => {
  const { cfg } = setup();
  assert.throws(() => vault.ensureVault(cfg, 'w', {}), /language-required/);
});

test('ensureVault creates spec layout and fixes language', () => {
  const { cfg, cfgFile } = setup({ git: { mode: 'none' } });
  const r = vault.ensureVault(cfg, 'w', { language: 'it', cfgFile });
  assert.equal(r.created, true);
  for (const d of vault.DIRS) assert.ok(fs.existsSync(join(r.vault, d)), d);
  for (const f of vault.ROOT_FILES) assert.ok(fs.existsSync(join(r.vault, f)), f);
  assert.equal(read(join(r.vault, '.gitignore')), vault.GITIGNORE);
  assert.equal(read(join(r.vault, '.gitattributes')), vault.GITATTRIBUTES);
  assert.match(read(join(r.vault, '00_Inbox', 'Plan.md')), /## ToDo[\s\S]*## In Progress[\s\S]*## Completed[\s\S]*## Discarded/);
  assert.match(read(join(r.vault, 'Home.md')), /<!-- brain:projects -->/);
  assert.equal(loadConfig(cfgFile).workspaces.w.language, 'it');
  assert.equal(vault.languageFor(loadConfig(cfgFile), 'w'), 'it');
  assert.equal(vault.ensureVault(loadConfig(cfgFile), 'w', {}).created, false);
});

test('the vault .gitignore keeps Obsidian local state and plugin data out of git', { skip: !hasGit }, () => {
  const { cfg, cfgFile } = setup({ git: { mode: 'per-workspace' } });
  const r = vault.ensureVault(cfg, 'w', { language: 'en', cfgFile });
  const ignored = (f) => {
    try {
      execFileSync('git', ['check-ignore', '-q', '--no-index', f], { cwd: r.vault, stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  };
  const local = ['.obsidian/workspace.json', '.obsidian/workspace-mobile.json', '.obsidian/cache/x', '.obsidian/.trash/a.md', '.trash/a.md', '.obsidian/plugins/obsidian-kanban/data.json', 'a.local.md', '.brain/state/s.json'];
  for (const f of local) assert.ok(ignored(f), f);
  for (const f of ['.obsidian/app.json', '.obsidian/plugins/obsidian-kanban/main.js', '00_Inbox/Plan.md']) assert.ok(!ignored(f), f);
});

test('an existing .gitignore gains the missing rules, never the comments', () => {
  const { cfg, cfgFile } = setup({ git: { mode: 'none' } });
  const v = vaultPathFor(cfg, 'w');
  fs.mkdirSync(v, { recursive: true });
  fs.writeFileSync(join(v, '.gitignore'), '.obsidian/\n');
  vault.ensureVault(cfg, 'w', { language: 'en', cfgFile });
  const text = read(join(v, '.gitignore'));
  assert.match(text, /^\.obsidian\/\n/);
  assert.match(text, /^\.obsidian\/plugins\/\*\/data\.json$/m);
  assert.doesNotMatch(text, /^#/m);
  assert.doesNotMatch(text, /\n\n/);
});

test('ensureVault never overwrites user files', () => {
  const { cfg, cfgFile } = setup({ git: { mode: 'none' }, language: 'en' });
  const r = vault.ensureVault(cfg, 'w', { cfgFile });
  fs.writeFileSync(join(r.vault, 'AGENTS.md'), 'mine');
  fs.writeFileSync(join(r.vault, '00_Inbox', 'Plan.md'), 'my board');
  fs.unlinkSync(join(r.vault, 'TOOLS.md'));
  vault.ensureVault(cfg, 'w', { cfgFile });
  vault.ensureVault(cfg, 'w', { cfgFile, repair: true });
  assert.equal(read(join(r.vault, 'AGENTS.md')), 'mine');
  assert.equal(read(join(r.vault, '00_Inbox', 'Plan.md')), 'my board');
  // after birth the rule files are the user's: a deleted one stays deleted
  assert.ok(!fs.existsSync(join(r.vault, 'TOOLS.md')));
});

test('per-workspace vault inside a parent repo gets excluded there', { skip: !hasGit }, () => {
  const { t, cfg, cfgFile } = setup({ language: 'en' });
  const parent = join(t, 'code');
  fs.mkdirSync(parent, { recursive: true });
  git.init(parent);
  cfg.workspaces.w.vault = join(parent, 'brain');
  const r = vault.ensureVault(cfg, 'w', { cfgFile });
  assert.equal(git.toplevel(r.vault).toLowerCase(), r.vault.replace(/\\/g, '/').toLowerCase());
  assert.match(read(join(parent, '.git', 'info', 'exclude')), /^\/?brain\/$/m);
  assert.deepEqual(vault.repoFor(cfg, 'w', r.vault), { repo: r.vault, pathspec: '.' });
  vault.ensureVault(cfg, 'w', { cfgFile });
  assert.equal(read(join(parent, '.git', 'info', 'exclude')).match(/brain\//g).length, 1);
});

test('applyGitConfig sets identity only when different', { skip: !hasGit }, () => {
  const { cfg, cfgFile } = setup({ language: 'en', git: { mode: 'per-workspace', config: { 'user.name': 'Test Brain', 'user.email': 'brain@example.invalid' } } });
  const r = vault.ensureVault(cfg, 'w', { cfgFile });
  assert.equal(execFileSync('git', ['config', '--get', 'user.name'], { cwd: r.vault, encoding: 'utf8' }).trim(), 'Test Brain');
  assert.deepEqual(vault.applyGitConfig(cfg, 'w', r.vault), []);
  execFileSync('git', ['config', 'user.name', 'Other'], { cwd: r.vault });
  assert.deepEqual(vault.applyGitConfig(cfg, 'w', r.vault), ['user.name']);
});

test('repoFor follows the git mode', () => {
  const { t, cfg } = setup({ language: 'en' });
  const v = join(cfg.root, 'w');
  cfg.workspaces.w.git = { mode: 'none' };
  assert.equal(vault.repoFor(cfg, 'w', v), null);
  cfg.workspaces.w.git = { mode: 'single' };
  assert.deepEqual(vault.repoFor(cfg, 'w', v), { repo: cfg.root, pathspec: 'w' });
  cfg.workspaces.w.vault = join(t, 'outside');
  assert.equal(vault.gitModeFor(cfg, 'w'), 'per-workspace');
});

test('vault with spaces and no git', () => {
  const { t, cfg, cfgFile } = setup({ language: 'en' });
  cfg.workspaces.w.vault = join(t, 'my vault');
  const oldPath = process.env.PATH;
  process.env.PATH = '';
  try {
    assert.equal(git.available(), false);
    const r = vault.ensureVault(cfg, 'w', { cfgFile });
    assert.ok(fs.existsSync(join(r.vault, 'Home.md')));
    assert.deepEqual(git.commitPath(r.vault, '.', 'brain: test'), { committed: false, reason: 'git-unavailable' });
  } finally {
    process.env.PATH = oldPath;
  }
});
