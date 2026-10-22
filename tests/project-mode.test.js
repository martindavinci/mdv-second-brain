'use strict';
// Project mode: one folder, one vault in <folder>/SecondBrain, nothing outside the folder.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const { join } = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { defaults, saveConfig, loadConfig, localConfigFile } = require('../scripts/lib/config');
const { findLocal, locate } = require('../scripts/lib/locate');
const { main } = require('../scripts/brain');
const { run } = require('../scripts/hook');
const state = require('../scripts/lib/state');

const HOOK = join(__dirname, '..', 'scripts', 'hook.js');
const gitIn = (dir, args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();

function project({ repo = true } = {}) {
  const t = fs.mkdtempSync(join(os.tmpdir(), 'sb-proj-'));
  const proj = join(t, 'work', 'my-app');
  fs.mkdirSync(join(proj, 'src', 'deep'), { recursive: true });
  if (repo) {
    gitIn(proj, ['init', '-q']);
    gitIn(proj, ['config', 'user.name', 'Repo Person']);
    gitIn(proj, ['config', 'user.email', 'repo@example.invalid']);
  }
  return { t, proj, globalFile: join(t, 'global', 'config.json'), vault: join(proj, 'SecondBrain') };
}

function io(cwd, env) {
  const out = [];
  const err = [];
  return { cwd, env, stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) }, out, err };
}

async function initHere(p, ...extra) {
  const o = io(p.proj, { MDV_SECOND_BRAIN_CONFIG: p.globalFile });
  const code = await main(['--session', 's-proj-1', 'init', '--here', '--language', 'en', ...extra], o);
  assert.equal(code, 0, o.err.join(''));
  return o;
}

test('init --here creates the whole brain inside the folder and nothing global', async () => {
  const p = project();
  await initHere(p);
  const file = localConfigFile(p.proj);
  assert.ok(fs.existsSync(file));
  assert.ok(fs.existsSync(join(p.vault, 'Home.md')));
  assert.ok(fs.existsSync(join(p.vault, '.git')));
  assert.ok(!fs.existsSync(p.globalFile));
  assert.ok(!fs.existsSync(join(p.t, 'global')));
  assert.match(fs.readFileSync(join(p.proj, '.git', 'info', 'exclude'), 'utf8'), /SecondBrain/);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.local, true);
  assert.equal(saved.root, undefined);
  const ws = Object.values(saved.workspaces)[0];
  assert.equal(ws.paths, undefined);
  assert.equal(ws.vault, undefined);
  assert.equal(ws.git.identity.email, 'repo@example.invalid');
  assert.equal(Object.keys(saved.workspaces)[0], 'my-app');
  assert.equal(state.readIndex(join(p.vault, '.brain', 'local', 'state'), 's-proj-1').origin, 'my-app');
});

test('the project config follows the folder when it moves', async () => {
  const p = project({ repo: false });
  await initHere(p, '--git-mode', 'none');
  const moved = join(p.t, 'moved-app');
  fs.renameSync(p.proj, moved);
  const cfg = loadConfig(localConfigFile(moved));
  const ws = cfg.workspaces['my-app'];
  assert.deepEqual(ws.paths, [moved]);
  assert.equal(ws.vault, join(moved, 'SecondBrain'));
  saveConfig(cfg, localConfigFile(moved));
  assert.equal(JSON.parse(fs.readFileSync(localConfigFile(moved), 'utf8')).workspaces['my-app'].paths, undefined);
});

test('findLocal finds the project config from any subfolder or the vault, and nothing elsewhere', async () => {
  const p = project({ repo: false });
  await initHere(p, '--git-mode', 'none');
  const file = localConfigFile(p.proj);
  assert.equal(findLocal(join(p.proj, 'src', 'deep')), file);
  assert.equal(findLocal(p.proj), file);
  assert.equal(findLocal(join(p.vault, '00_Inbox')), file);
  assert.equal(findLocal(join(p.t, 'work')), null);
});

test('locate: global only, project only, neither, and the nearest mapping wins', async () => {
  const p = project({ repo: false });
  const deep = join(p.proj, 'src', 'deep');
  assert.equal(locate(deep, { globalFile: p.globalFile }), null);
  const g = defaults();
  g.root = join(p.t, 'root');
  g.workspaces.outer = { paths: [join(p.t, 'work')], language: 'en', git: { mode: 'none' } };
  saveConfig(g, p.globalFile);
  assert.equal(locate(deep, { globalFile: p.globalFile }), p.globalFile);
  await initHere(p, '--git-mode', 'none');
  const file = localConfigFile(p.proj);
  assert.equal(locate(deep, { globalFile: p.globalFile }), file, 'project inside a wider workspace: the project wins');
  assert.equal(locate(join(p.t, 'work'), { globalFile: p.globalFile }), p.globalFile);
  g.workspaces.inner = { paths: [join(p.proj, 'src')], language: 'en', git: { mode: 'none' } };
  saveConfig(g, p.globalFile);
  assert.equal(locate(deep, { globalFile: p.globalFile }), p.globalFile, 'a workspace mapped inside the project wins there');
  assert.equal(locate(p.proj, { globalFile: p.globalFile }), file);
});

test('CLI in a subfolder finds the project without --config; subfolders are not projects', async () => {
  const p = project({ repo: false });
  await initHere(p, '--git-mode', 'none');
  const o = io(join(p.proj, 'src', 'deep'), { MDV_SECOND_BRAIN_CONFIG: p.globalFile });
  assert.equal(await main(['--session', 's-proj-1', 'task', 'add', 'Login flow'], o), 0, o.err.join(''));
  assert.ok(fs.existsSync(join(p.vault, '10_Notes', 'Tasks', 'Login flow.md')));
  assert.ok(!fs.existsSync(join(p.vault, '20_Projects', 'src')));
  assert.ok(!fs.existsSync(p.globalFile));
});

test('workspace commands are refused in project mode', async () => {
  const p = project({ repo: false });
  await initHere(p, '--git-mode', 'none');
  const o = io(p.proj, { MDV_SECOND_BRAIN_CONFIG: p.globalFile });
  assert.equal(await main(['workspace', 'add', 'other', '--language', 'en'], o), 2);
  assert.match(o.err.join(''), /project mode/);
});

test('hooks find the project config: context names the CLI with --config', async () => {
  const p = project({ repo: false });
  await initHere(p, '--git-mode', 'none');
  const cwd = join(p.proj, 'src');
  const out = run('session-start', { session_id: 's-proj-2', cwd, source: 'startup' }, { globalFile: p.globalFile, cli: '/x/brain.js' }).stdout;
  const c = JSON.parse(out).hookSpecificOutput.additionalContext;
  assert.match(c, /workspace=my-app/);
  assert.ok(c.includes(`--config "${localConfigFile(p.proj)}"`), c);
  assert.equal(run('session-start', { session_id: 's-proj-3', cwd: join(p.t, 'work'), source: 'startup' }, { globalFile: p.globalFile }).stdout, '');
});

test('hook.js process with no global config activates inside a project', async () => {
  const p = project({ repo: false });
  await initHere(p, '--git-mode', 'none');
  const input = { hook_event_name: 'SessionStart', session_id: 's-proj-4', cwd: join(p.proj, 'src'), source: 'startup' };
  const r = spawnSync(process.execPath, [HOOK], { cwd: join(p.proj, 'src'), input: JSON.stringify(input), env: { ...process.env, MDV_SECOND_BRAIN_CONFIG: p.globalFile }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /workspace=my-app/);
  assert.ok(!fs.existsSync(p.globalFile));
});
