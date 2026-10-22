'use strict';
// brain bootstrap: the git repos under a workspace's folders become project hubs, re-runnable.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');
const { read, write, io } = require('./helpers');
const { main } = require('../scripts/brain');
const { defaults, saveConfig } = require('../scripts/lib/config');
const frontmatter = require('../scripts/lib/frontmatter');

const g = (dir, args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function repo(dir, { remote, files = {} } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  g(dir, ['init', '-q', '-b', 'main']);
  g(dir, ['config', 'user.name', 'T']);
  g(dir, ['config', 'user.email', 't@example.invalid']);
  write(join(dir, 'README.md'), '# repo\n');
  for (const [f, s] of Object.entries(files)) write(join(dir, f), s);
  g(dir, ['add', '-A']);
  g(dir, ['commit', '-q', '-m', 'init']);
  if (remote) g(dir, ['remote', 'add', 'origin', remote]);
}

// A workspace folder with repos of every kind the bootstrap meets, and the vault inside it.
async function workspace() {
  const t = fs.mkdtempSync(join(os.tmpdir(), 'sb-boot-'));
  const code = join(t, 'code');
  repo(join(code, 'app'), { remote: 'https://someone:s3cr3t@github.com/me/app.git', files: { 'package.json': '{"scripts":{"build":"x","test":"y"}}' } });
  repo(join(code, 'site-src'), { files: { 'scripts/build.js': "const out = path.resolve(ROOT, '..', 'site');\nconst old = path.resolve(ROOT, '..', 'old-name');\n" } });
  repo(join(code, 'site'));
  repo(join(code, 'tmpl'));
  repo(join(code, 'content'));
  g(join(code, 'content'), ['remote', 'add', 'template', join(code, 'tmpl')]);
  repo(join(code, 'legacy'));
  repo(join(code, 'tools'));
  fs.mkdirSync(join(code, 'plain-folder'));
  const cfgFile = join(t, 'cfg', 'config.json');
  const cfg = defaults();
  cfg.root = join(t, 'root');
  cfg.ignore = [join(code, 'legacy')];
  saveConfig(cfg, cfgFile);
  const env = { MDV_SECOND_BRAIN_CONFIG: cfgFile };
  const vault = join(code, 'Brain');
  const brain = async (...args) => {
    const o = { cwd: code, env, ...io() };
    const code_ = await main(['--session', 's-boot', ...args], o);
    return { code: code_, text: o.text(), err: o.errText(), json: () => JSON.parse(o.text()) };
  };
  assert.equal((await brain('init', 'w', '--path', code, '--vault', vault, '--language', 'en', '--git-mode', 'per-workspace')).code, 0);
  return { t, code, vault, brain, hub: (p) => join(vault, '20_Projects', `${p}.md`) };
}

const byProject = (plan) => Object.fromEntries(plan.repos.map((r) => [r.project, r]));

test('bootstrap --dry-run lists new, existing and excluded repos and writes nothing', async () => {
  const w = await workspace();
  assert.equal((await w.brain('project', 'add', 'site')).code, 0);
  const r = await w.brain('--json', 'bootstrap', '--dry-run');
  assert.equal(r.code, 0, r.err);
  const plan = r.json();
  const repos = byProject(plan);
  assert.equal(repos.app.status, 'new');
  assert.equal(repos.site.status, 'existing');
  assert.deepEqual([repos.legacy.status, repos.legacy.reason], ['excluded', 'ignore']);
  assert.deepEqual([repos.Brain.status, repos.Brain.reason], ['excluded', 'vault']);
  assert.equal(repos.tools.status, 'name-taken');
  assert.equal(repos['plain-folder'], undefined);
  assert.ok(!fs.existsSync(w.hub('app')));
  assert.doesNotMatch(r.text, /s3cr3t/);
  const text = await w.brain('bootstrap', '--dry-run');
  assert.match(text.text, /app — new/);
  assert.match(text.text, /legacy — excluded \(ignore\)/);
});

test('bootstrap creates the missing hubs with a generated Repo section and keeps prose on re-runs', async () => {
  const w = await workspace();
  assert.equal((await w.brain('project', 'add', 'site')).code, 0);
  const first = await w.brain('--json', 'bootstrap');
  assert.equal(first.code, 0, first.err);
  assert.ok(first.json().created.includes('app'));
  const hub = read(w.hub('app'));
  assert.match(hub, /<!-- brain:repo -->\n## Repo\n[\s\S]*<!-- \/brain:repo -->\n\n<!-- brain:project-index -->/);
  assert.match(hub, /origin https:\/\/github\.com\/me\/app\.git/);
  assert.doesNotMatch(hub, /s3cr3t/);
  assert.match(hub, /branch main · 1 commit · last \d{4}-\d{2}-\d{2}/);
  assert.match(hub, /Working tree: clean/);
  assert.match(hub, /package\.json \(scripts: build, test\)/);
  assert.match(read(w.hub('site')), /<!-- brain:repo -->/);
  assert.match(read(w.hub('content')), /template \.\.\/tmpl/);
  assert.ok(!fs.existsSync(w.hub('legacy')));
  assert.match(read(join(w.vault, 'Home.md')), /\[\[app\]\]/);

  fs.writeFileSync(w.hub('app'), read(w.hub('app')).replace('# app', '# app\n\nHand-written prose.'));
  write(join(w.code, 'app', 'new.txt'), 'x');
  const again = await w.brain('--json', 'bootstrap');
  assert.deepEqual(again.json().created, []);
  assert.match(read(w.hub('app')), /Hand-written prose\./);
  assert.match(read(w.hub('app')), /Working tree: uncommitted changes/);
  assert.equal(read(w.hub('app')).match(/<!-- brain:repo -->/g).length, 1);
});

test('bootstrap proposes relations with their evidence and reports broken sibling references', async () => {
  const w = await workspace();
  const plan = (await w.brain('--json', 'bootstrap', '--dry-run')).json();
  const has = (a, rel, b) => plan.candidates.some((c) => c.a === a && c.rel === rel && c.b === b);
  assert.ok(has('site-src', 'source_of', 'site'), JSON.stringify(plan.candidates));
  assert.ok(has('tmpl', 'source_of', 'content'), JSON.stringify(plan.candidates));
  assert.equal(plan.candidates.filter((c) => [c.a, c.b].sort().join() === 'site,site-src').length, 1);
  assert.deepEqual(plan.broken.map((b) => [b.project, b.file, b.ref]), [['site-src', 'scripts/build.js:2', '../old-name']]);

  assert.equal((await w.brain('bootstrap')).code, 0);
  assert.equal((await w.brain('project', 'relate', 'site-src', '--source-of', 'site')).code, 0);
  const later = (await w.brain('--json', 'bootstrap', '--dry-run')).json();
  assert.ok(!later.candidates.some((c) => c.a === 'site-src' && c.b === 'site'));
});

test('bootstrap is refused in project mode', async () => {
  const t = fs.mkdtempSync(join(os.tmpdir(), 'sb-boot-local-'));
  const proj = join(t, 'app');
  fs.mkdirSync(proj, { recursive: true });
  const env = { MDV_SECOND_BRAIN_CONFIG: join(t, 'cfg', 'config.json') };
  const o = { cwd: proj, env, ...io() };
  assert.equal(await main(['--session', 's1', 'init', '--here', '--language', 'en', '--git-mode', 'none'], o), 0, o.errText());
  const b = { cwd: proj, env, ...io() };
  assert.equal(await main(['--session', 's1', 'bootstrap'], b), 2);
  assert.match(b.errText(), /project mode/);
});

test('a hub frontmatter stays readable after bootstrap', async () => {
  const w = await workspace();
  await w.brain('bootstrap');
  assert.equal(frontmatter.parse(read(w.hub('app'))).data.type, 'project');
});
