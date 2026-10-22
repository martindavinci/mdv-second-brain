'use strict';
// brain project rename, by hand or after bootstrap recognises a renamed repo folder.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');
const { read, write, makeVault, io } = require('./helpers');
const { main } = require('../scripts/brain');
const { defaults, saveConfig } = require('../scripts/lib/config');
const frontmatter = require('../scripts/lib/frontmatter');

async function vaultWithAlpha({ split = false } = {}) {
  const env = makeVault();
  const brain = async (...a) => {
    const o = io();
    const code = await main(['--config', env.cfgFile, ...a], { cwd: env.code, ...o });
    return { code, text: o.text(), err: o.errText() };
  };
  const v = env.vault;
  for (const p of ['alpha', 'beta']) assert.equal((await brain('project', 'add', p)).code, 0);
  assert.equal((await brain('task', 'add', 'Login', '--project', 'alpha')).code, 0);
  assert.equal((await brain('idea', 'add', 'Dark mode', '--project', 'alpha')).code, 0);
  assert.equal((await brain('project', 'relate', 'beta', '--depends-on', 'alpha')).code, 0);
  if (split) assert.equal((await brain('project', 'split', 'alpha')).code, 0);
  write(join(v, '20_Projects', 'alpha', 'alpha — Architecture.md'), '---\ntype: note\nproject: "[[alpha]]"\n---\n# alpha — Architecture\n\nLayers.\n');
  write(join(v, '90_Archive', 'alpha', 'Tasks', 'Old.md'), '---\ntype: task\nproject: alpha\nstatus: completed\n---\n# Old\n');
  write(join(v, '10_Notes', 'Links.md'), '# Links\n\nSee [[alpha]], [[alpha|the app]], [[Alpha]], [[alpha — Architecture#Build]] and [[alphabet]].\n');
  return { ...env, brain, v };
}

const fm = (file) => frontmatter.parse(read(file)).data;

test('project rename --dry-run lists the moves and changes nothing', async () => {
  const { brain, v } = await vaultWithAlpha();
  const r = await brain('project', 'rename', 'alpha', 'omega', '--dry-run');
  assert.equal(r.code, 0, r.err);
  assert.match(r.text, /20_Projects\/alpha\.md → 20_Projects\/omega\.md/);
  assert.match(r.text, /20_Projects\/alpha\/alpha — Architecture\.md → 20_Projects\/omega\/omega — Architecture\.md/);
  assert.ok(fs.existsSync(join(v, '20_Projects', 'alpha.md')));
  assert.ok(!fs.existsSync(join(v, '20_Projects', 'omega.md')));
});

test('project rename moves the project and rewrites every reference to it', async () => {
  const { brain, v } = await vaultWithAlpha();
  const r = await brain('project', 'rename', 'alpha', 'omega');
  assert.equal(r.code, 0, r.err);
  assert.ok(!fs.existsSync(join(v, '20_Projects', 'alpha.md')));
  assert.ok(!fs.existsSync(join(v, '20_Projects', 'alpha')));
  assert.match(read(join(v, '20_Projects', 'omega.md')), /^# omega$/m);
  assert.equal(fm(join(v, '20_Projects', 'omega', 'Tasks', 'Login.md')).project, '[[omega]]');
  const topic = join(v, '20_Projects', 'omega', 'omega — Architecture.md');
  assert.match(read(topic), /^# omega — Architecture$/m);
  assert.equal(fm(join(v, '90_Archive', 'omega', 'Tasks', 'Old.md')).project, 'omega');
  assert.deepEqual(fm(join(v, '20_Projects', 'beta.md')).depends_on, ['[[omega]]']);
  assert.equal(read(join(v, '10_Notes', 'Links.md')), '# Links\n\nSee [[omega]], [[omega|the app]], [[omega]], [[omega — Architecture#Build]] and [[alphabet]].\n');
  assert.match(read(join(v, '00_Inbox', 'Ideas.md')), /^## omega$/m);
  assert.doesNotMatch(read(join(v, '00_Inbox', 'Ideas.md')), /^## alpha$/m);
  assert.match(read(join(v, 'Home.md')), /\[\[omega\]\]/);
  assert.doesNotMatch(read(join(v, 'Home.md')), /\[\[alpha\]\]/);
  assert.match((await brain('task', 'list', '--project', 'omega')).text, /Login/);
});

test('project rename moves a split board with the project', async () => {
  const { brain, v } = await vaultWithAlpha({ split: true });
  assert.equal((await brain('project', 'rename', 'alpha', 'omega')).code, 0);
  assert.ok(fs.existsSync(join(v, '00_Inbox', 'omega', 'omega Plan.md')));
  assert.ok(!fs.existsSync(join(v, '00_Inbox', 'alpha')));
  assert.match((await brain('project', 'list')).text, /omega — split: yes/);
});

test('project rename refuses an unknown project and a taken name', async () => {
  const { brain } = await vaultWithAlpha();
  const unknown = await brain('project', 'rename', 'ghost', 'other');
  assert.equal(unknown.code, 2);
  assert.match(unknown.err, /unknown project: ghost/);
  assert.equal((await brain('project', 'rename', 'alpha', 'beta')).code, 6);
  assert.equal((await brain('project', 'rename', 'alpha', 'tools')).code, 6);
});

// --- the bootstrap side ---

const g = (dir, args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function repo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  g(dir, ['init', '-q', '-b', 'main']);
  g(dir, ['config', 'user.name', 'T']);
  g(dir, ['config', 'user.email', 't@example.invalid']);
  write(join(dir, 'README.md'), `# ${dir}\n`);
  g(dir, ['add', '-A']);
  g(dir, ['commit', '-q', '-m', 'init']);
}

test('bootstrap recognises a renamed repo folder, holds it back, and the rename settles it', async () => {
  const t = fs.mkdtempSync(join(os.tmpdir(), 'sb-ren-'));
  const code = join(t, 'code');
  repo(join(code, 'old-app'));
  repo(join(code, 'gone'));
  const cfgFile = join(t, 'cfg', 'config.json');
  const cfg = defaults();
  cfg.root = join(t, 'root');
  saveConfig(cfg, cfgFile);
  const env = { MDV_SECOND_BRAIN_CONFIG: cfgFile };
  const brain = async (...a) => {
    const o = { cwd: code, env, ...io() };
    const c = await main(['--session', 's-ren', ...a], o);
    return { code: c, text: o.text(), err: o.errText(), json: () => JSON.parse(o.text()) };
  };
  assert.equal((await brain('init', 'w', '--path', code, '--language', 'en', '--git-mode', 'none')).code, 0);
  assert.equal((await brain('bootstrap')).code, 0);
  fs.renameSync(join(code, 'old-app'), join(code, 'new-app'));
  fs.rmSync(join(code, 'gone'), { recursive: true, force: true });

  const plan = (await brain('--json', 'bootstrap', '--dry-run')).json();
  assert.deepEqual(plan.renames, [{ from: 'old-app', to: 'new-app', by: 'first commit' }]);
  assert.deepEqual(plan.orphans, ['gone']);
  const held = await brain('--json', 'bootstrap');
  assert.deepEqual(held.json().created, []);
  const vault = join(t, 'root', 'w');
  assert.ok(!fs.existsSync(join(vault, '20_Projects', 'new-app.md')));

  assert.equal((await brain('project', 'rename', 'old-app', 'new-app')).code, 0);
  const after = (await brain('--json', 'bootstrap', '--dry-run')).json();
  assert.deepEqual(after.renames, []);
  assert.equal(after.repos.find((r) => r.folder === 'new-app').status, 'existing');
});
