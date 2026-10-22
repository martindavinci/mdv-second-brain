'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const { join } = require('node:path');
const { read, write, makeVault, io } = require('./helpers');
const { main } = require('../scripts/brain');
const { defaults, saveConfig } = require('../scripts/lib/config');

test('cli task add uses the project of the cwd and prints the note', async () => {
  const { cfgFile, code, vault: v } = makeVault();
  fs.mkdirSync(join(code, 'repo-a', 'src'), { recursive: true });
  const o = io();
  assert.equal(await main(['--config', cfgFile, 'task', 'add', 'Make', 'it', 'work'], { cwd: join(code, 'repo-a', 'src'), ...o }), 0);
  assert.ok(fs.existsSync(join(v, '20_Projects', 'repo-a', 'Tasks', 'Make it work.md')));
  assert.match(o.text(), /Make it work/);
});

test('cli name taken exits 6 with the existing path', async () => {
  const { cfgFile, code } = makeVault();
  await main(['--config', cfgFile, 'issue', 'add', 'Same'], { cwd: code, ...io() });
  const o = io();
  assert.equal(await main(['--config', cfgFile, 'task', 'add', 'same'], { cwd: code, ...o }), 6);
  assert.match(o.errText(), /name taken: .*Same\.md/);
});

test('cli list --json and move', async () => {
  const { cfgFile, code } = makeVault();
  await main(['--config', cfgFile, 'task', 'add', 'Alpha'], { cwd: code, ...io() });
  assert.equal(await main(['--config', cfgFile, 'task', 'move', 'Alpha', 'in-progress'], { cwd: code, ...io() }), 0);
  const o = io();
  await main(['--config', cfgFile, '--json', 'task', 'list'], { cwd: code, ...o });
  assert.deepEqual(JSON.parse(o.text()).map((i) => [i.name, i.status]), [['Alpha', 'in-progress']]);
});

test('cli delete refuses without --yes', async () => {
  const { cfgFile, code } = makeVault();
  await main(['--config', cfgFile, 'task', 'add', 'X'], { cwd: code, ...io() });
  const o = io();
  assert.equal(await main(['--config', cfgFile, 'task', 'delete', 'X'], { cwd: code, ...o }), 3);
  assert.match(o.errText(), /refusing to delete without --yes/);
  assert.equal(await main(['--config', cfgFile, 'task', 'delete', 'X', '--yes'], { cwd: code, ...io() }), 0);
});

test('cli asks for init when language is auto', async () => {
  const t = fs.mkdtempSync(join(os.tmpdir(), 'sb-cli-'));
  const cfgFile = join(t, 'config.json');
  const cfg = defaults();
  cfg.root = join(t, 'root');
  cfg.workspaces.w = { paths: [t] };
  saveConfig(cfg, cfgFile);
  const o = io();
  assert.equal(await main(['--config', cfgFile, 'task', 'list'], { cwd: t, ...o }), 4);
  assert.match(o.errText(), /run: brain init w --language <code>/);
  assert.equal(await main(['--config', cfgFile, 'init', 'w', '--language', 'it'], { cwd: t, ...io() }), 0);
  assert.equal(await main(['--config', cfgFile, 'task', 'list'], { cwd: t, ...io() }), 0);
});

test('cli outside any workspace exits 2', async () => {
  const { cfgFile, t } = makeVault();
  const o = io();
  assert.equal(await main(['--config', cfgFile, 'task', 'list'], { cwd: t, ...o }), 2);
  assert.match(o.errText(), /not in a workspace/);
});

test('cli --session stamps the write for that session only', async () => {
  const { cfgFile, code, vault: v } = makeVault();
  await main(['--config', cfgFile, '--session', 'sid1', 'task', 'add', 'Stamp'], { cwd: code, ...io() });
  assert.ok(fs.existsSync(join(v, '.brain', 'state', 'sid1.cli')));
});

test('cli show prints a section', async () => {
  const { cfgFile, code } = makeVault();
  await main(['--config', cfgFile, 'task', 'add', 'Shown'], { cwd: code, ...io() });
  const o = io();
  await main(['--config', cfgFile, 'task', 'show', 'Shown', '--section', 'Status'], { cwd: code, ...o });
  assert.match(o.text(), /^Shown · task · todo/);
});

test('cli feature add creates a proposed feature without a card', async () => {
  const { cfgFile, code, vault: v } = makeVault();
  assert.equal(await main(['--config', cfgFile, 'feature', 'add', 'Refunds', '--project', 'pay'], { cwd: code, ...io() }), 0);
  const f = join(v, '20_Projects', 'pay', 'Features', 'Refunds.md');
  assert.match(read(f), /lifecycle: proposed/);
  assert.doesNotMatch(read(join(v, '00_Inbox', 'Plan.md')), /Refunds/);
});

test('cli project add creates the hub from the template, once', async () => {
  const { cfgFile, code, vault: v } = makeVault();
  assert.equal(await main(['--config', cfgFile, 'project', 'add', 'alpha'], { cwd: code, ...io() }), 0);
  const hub = join(v, '20_Projects', 'alpha.md');
  assert.ok(!fs.existsSync(join(v, '20_Projects', 'alpha')), 'no project folder until there is something to put in it');
  assert.match(read(hub), /^---\ntype: project\nstatus: active\ndepends_on: \[\]\nused_by: \[\]\nsource_of: \[\]\nbuilt_from: \[\]\nrelated: \[\]/);
  assert.match(read(hub), /<!-- brain:project-index -->/);
  const o = io();
  assert.equal(await main(['--config', cfgFile, 'project', 'add', 'alpha'], { cwd: code, ...o }), 6);
});

test('cli index moves a hub still inside its project folder next to it, and reads either layout before that', async () => {
  const { cfgFile, code, vault: v } = makeVault();
  write(join(v, '20_Projects', 'alpha', 'alpha.md'), '---\ntype: project\n---\n# alpha\n\nLegacy hub.\n\n<!-- brain:project-index -->\n<!-- /brain:project-index -->\n');
  write(join(v, '20_Projects', 'alpha', 'Issues', 'Broken.md'), '---\ntype: issue\nstatus: todo\n---\n# Broken\n');
  write(join(v, '20_Projects', 'beta', 'beta.md'), '---\ntype: project\n---\n# beta\n');
  let o = io();
  assert.equal(await main(['--config', cfgFile, 'context', '--project', 'alpha'], { cwd: code, ...o }), 0);
  assert.match(o.text(), /hub 20_Projects\/alpha\/alpha\.md/);
  o = io();
  assert.equal(await main(['--config', cfgFile, 'index'], { cwd: code, ...o }), 0, o.errText());
  assert.match(o.text(), /2 hubs moved/);
  assert.match(read(join(v, '20_Projects', 'alpha.md')), /Legacy hub\.[\s\S]*\[\[Broken\]\]/);
  assert.ok(fs.existsSync(join(v, '20_Projects', 'alpha', 'Issues', 'Broken.md')));
  assert.ok(!fs.existsSync(join(v, '20_Projects', 'alpha', 'alpha.md')));
  assert.ok(!fs.existsSync(join(v, '20_Projects', 'beta')), 'an emptied project folder goes away');
  assert.match(read(join(v, 'Home.md')), /\[\[alpha\]\][\s\S]*\[\[beta\]\]/);
  o = io();
  assert.equal(await main(['--config', cfgFile, 'context', '--project', 'alpha'], { cwd: code, ...o }), 0);
  assert.match(o.text(), /hub 20_Projects\/alpha\.md/);
});

test('cli index reports a project with a hub in both places and moves neither', async () => {
  const { cfgFile, code, vault: v } = makeVault();
  write(join(v, '20_Projects', 'alpha.md'), '---\ntype: project\n---\n# alpha\n\nNew hub.\n');
  write(join(v, '20_Projects', 'alpha', 'alpha.md'), '---\ntype: project\n---\n# alpha\n\nOld hub.\n');
  const o = io();
  assert.equal(await main(['--config', cfgFile, 'index'], { cwd: code, ...o }), 0, o.errText());
  assert.match(o.text(), /hub conflict: alpha/);
  assert.match(read(join(v, '20_Projects', 'alpha.md')), /New hub\./);
  assert.match(read(join(v, '20_Projects', 'alpha', 'alpha.md')), /Old hub\./);
});

test('cli postmortem add writes the dated note in the project folder', async () => {
  const { cfgFile, code, vault: v } = makeVault();
  fs.mkdirSync(join(code, 'alpha'), { recursive: true });
  const o = io();
  assert.equal(await main(['--config', cfgFile, 'postmortem', 'add', 'Lost', 'uploads'], { cwd: join(code, 'alpha'), ...o }), 0);
  const dir = join(v, '20_Projects', 'alpha');
  const f = fs.readdirSync(dir).find((n) => n.startsWith('alpha — Post Mortem '));
  assert.ok(f, fs.readdirSync(dir).join(','));
  assert.match(read(join(dir, f)), /type: postmortem[\s\S]*# Lost uploads[\s\S]*## Lessons/);
});
