'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const { join, dirname } = require('node:path');
const { execFileSync } = require('node:child_process');
const { read, write, makeVault, io, daysAgo, ymd } = require('./helpers');
const { main } = require('../scripts/brain');
const { defaults, saveConfig, loadConfig } = require('../scripts/lib/config');
const { resolveWorkspace } = require('../scripts/lib/resolve');
const git = require('../scripts/lib/git');
const state = require('../scripts/lib/state');
const frontmatter = require('../scripts/lib/frontmatter');

const hasGit = git.available();
const ID = { 'user.name': 'Test Brain', 'user.email': 'brain@example.invalid' };
const gitOut = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function blank() {
  const t = fs.mkdtempSync(join(os.tmpdir(), 'sb-ws-'));
  const cfgFile = join(t, 'cfg', 'config.json');
  const cfg = defaults();
  cfg.root = join(t, 'root');
  cfg.git = { mode: 'none' };
  saveConfig(cfg, cfgFile);
  return { t, cfgFile, stateDir: join(t, 'cfg', 'state') };
}

const cli = async (cfgFile, cwd, ...args) => {
  const o = io();
  const code = await main(['--config', cfgFile, ...args], { cwd, ...o });
  return { code, out: o.text(), err: o.errText() };
};

test('commit in none mode reports git disabled', async () => {
  const { cfgFile, code } = makeVault();
  const r = await cli(cfgFile, code, 'commit', '-m', 'x');
  assert.equal(r.code, 0);
  assert.match(r.out, /git disabled/);
});

test('commit only stages the active workspace in single mode', { skip: !hasGit }, async () => {
  const { t, cfgFile } = blank();
  const cfg = loadConfig(cfgFile);
  cfg.git = { mode: 'single' };
  cfg.workspaces.a = { paths: [join(t, 'a')], language: 'en', git: { mode: 'single', config: ID } };
  cfg.workspaces.b = { paths: [join(t, 'b')], language: 'en', git: { mode: 'single', config: ID } };
  saveConfig(cfg, cfgFile);
  fs.mkdirSync(join(t, 'a'));
  fs.mkdirSync(join(t, 'b'));
  await cli(cfgFile, join(t, 'b'), 'task', 'add', 'B task');
  const r = await cli(cfgFile, join(t, 'a'), 'task', 'add', 'A task');
  assert.equal(r.code, 0, r.err);
  const c = await cli(cfgFile, join(t, 'a'), 'commit', '-m', 'first');
  assert.match(c.out, /committed/, c.err);
  const files = gitOut(join(t, 'root'), ['show', '--name-only', '--format=', 'HEAD']).split('\n');
  assert.ok(files.every((f) => f.startsWith('a/')), files.join(','));
  assert.equal(gitOut(join(t, 'root'), ['log', '-1', '--format=%s']), 'brain: first');
});

test('commit applies workspace identity to a pre-existing vault repo', { skip: !hasGit }, async () => {
  const { cfgFile, code, vault: v, cfg } = makeVault({ gitMode: 'per-workspace' });
  git.run(v, ['config', 'user.name', 'Someone Else']);
  cfg.workspaces.w.git.config = ID;
  saveConfig(cfg, cfgFile);
  await cli(cfgFile, code, 'task', 'add', 'Identity check');
  const c = await cli(cfgFile, code, 'commit', '-m', 'id');
  assert.match(c.out, /committed/, c.err);
  assert.equal(gitOut(v, ['log', '-1', '--format=%an <%ae>']), 'Test Brain <brain@example.invalid>');
  assert.match((await cli(cfgFile, code, 'commit', '-m', 'again')).out, /nothing to commit/);
});

test('commit refuses secrets outside .local.md, allows them inside', { skip: !hasGit }, async () => {
  const { cfgFile, code, vault: v } = makeVault({ gitMode: 'per-workspace', ws: { git: { mode: 'per-workspace', config: ID } } });
  write(join(v, '10_Notes', 'Server.md'), '# Server\n\npassword = hunter2222\n');
  const bad = await cli(cfgFile, code, 'commit', '-m', 'leak');
  assert.equal(bad.code, 5);
  assert.match(bad.err, /secrets found: 10_Notes\/Server\.md:3 \(assignment\) — move to secrets\.local\.md/);
  assert.equal((await cli(cfgFile, code, 'secret', 'set', 'SERVER_PASSWORD', 'hunter2222')).code, 0);
  write(join(v, '10_Notes', 'Server.md'), '# Server\n\npassword = {{secret:SERVER_PASSWORD}}\n');
  const ok = await cli(cfgFile, code, 'commit', '-m', 'clean');
  assert.match(ok.out, /committed/, ok.err);
  assert.equal(gitOut(v, ['ls-files', 'secrets.local.md']), '');
});

test('secret list shows keys only', async () => {
  const { cfgFile, code } = makeVault();
  await cli(cfgFile, code, 'secret', 'set', 'TOKEN_A', 'value-one');
  const r = await cli(cfgFile, code, 'secret', 'list');
  assert.match(r.out, /TOKEN_A/);
  assert.doesNotMatch(r.out, /value-one/);
  assert.equal((await cli(cfgFile, code, 'secret', 'get', 'TOKEN_A')).out.trim(), 'value-one');
});

test('index archives old Completed cards, closed ideas and old dailies', async () => {
  const { cfgFile, code, vault: v } = makeVault();
  await cli(cfgFile, code, 'task', 'add', 'Ancient', '--status', 'completed');
  const f = join(v, '10_Notes', 'Tasks', 'Ancient.md');
  const d = frontmatter.parse(read(f));
  d.data.completed_at = ymd(daysAgo(30));
  write(f, frontmatter.stringify(d.data, d.body));
  write(join(v, '00_Inbox', 'Daily', `${ymd(daysAgo(20))}.md`), '# old\n');
  write(join(v, '00_Inbox', 'Ideas.md'), `# Ideas\n\n## General\n\n- [-] ~~stale~~ 🆔 aaaaaa ➕ ${ymd(daysAgo(40))} ❌ ${ymd(daysAgo(30))}\n`);
  const r = await cli(cfgFile, code, 'index');
  assert.equal(r.code, 0, r.err);
  assert.ok(fs.existsSync(join(v, '90_Archive', 'Tasks', 'Ancient.md')));
  assert.ok(fs.existsSync(join(v, '90_Archive', 'Daily', `${ymd(daysAgo(20))}.md`)));
  assert.match(read(join(v, '90_Archive', 'Ideas Archive.md')), /stale/);
  assert.ok(fs.existsSync(join(v, '.brain', 'oversize.json')));
  assert.match(read(join(v, 'Home.md')), /<!-- brain:projects -->/);
});

test('init from an unmapped cwd creates and maps the workspace; init <existing> appends the path', async () => {
  const { t, cfgFile } = blank();
  const a = join(t, 'proj-a');
  const b = join(t, 'proj-b');
  fs.mkdirSync(a);
  fs.mkdirSync(b);
  const r = await cli(cfgFile, a, 'init', 'work', '--language', 'en');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /brain active: work → /);
  assert.equal(resolveWorkspace(loadConfig(cfgFile), a).name, 'work');
  await cli(cfgFile, b, 'init', 'work');
  assert.equal(resolveWorkspace(loadConfig(cfgFile), b).name, 'work');
  assert.equal(loadConfig(cfgFile).workspaces.work.paths.length, 2);
});

test('init --quick needs no other flag and binds the session', async () => {
  const { t, cfgFile, stateDir } = blank();
  const dir = join(t, '_My Folder');
  fs.mkdirSync(dir);
  const r = await cli(cfgFile, dir, '--session', 'sess-q', 'init', '--quick', '--language', 'it');
  assert.equal(r.code, 0, r.err);
  const cfg = loadConfig(cfgFile);
  assert.deepEqual(Object.keys(cfg.workspaces), ['my-folder']);
  assert.equal(cfg.workspaces['my-folder'].git.mode, 'per-workspace');
  assert.deepEqual(state.readIndex(stateDir, 'sess-q').origin, 'my-folder');
  assert.equal(state.readIndex(stateDir, 'sess-q').contextSent, false);
});

test('init with a literal session placeholder leaves a pending activation', async () => {
  const { t, cfgFile, stateDir } = blank();
  const r = await cli(cfgFile, t, '--session', '${CLAUDE_SESSION_ID}', 'init', 'lit', '--language', 'en');
  assert.equal(r.code, 0, r.err);
  assert.equal(fs.readdirSync(join(stateDir, 'pending')).length, 1);
  assert.equal(state.consumePending(stateDir, t), 'lit');
});

test('init --plan reports folder, parent, workspaces and detected identity', async () => {
  const { t, cfgFile } = blank();
  const parent = join(t, 'parent');
  fs.mkdirSync(join(parent, 'child', '.git'), { recursive: true });
  await cli(cfgFile, join(t), 'init', 'other', '--language', 'en', '--path', join(t, 'elsewhere'));
  const r = await cli(cfgFile, join(parent, 'child'), '--json', 'init', '--plan');
  const p = JSON.parse(r.out);
  assert.equal(p.folderName, 'child');
  assert.equal(p.parentDir, parent);
  assert.equal(p.parentHasRepos, true);
  assert.equal(p.mapped, null);
  assert.deepEqual(p.workspaces, ['other']);
  assert.equal(p.defaultName, 'child');
  assert.equal(p.insideVault, join(parent, 'child', 'SecondBrain'));
  assert.ok('identity' in p);
});

test('detectIdentity prefers a parent .gitconfig file and returns a relative include path', { skip: !hasGit }, () => {
  const t = fs.mkdtempSync(join(os.tmpdir(), 'sb-id-'));
  write(join(t, 'ws', '.gitconfig'), '[user]\n\tname = File Person\n\temail = file@example.invalid\n');
  fs.mkdirSync(join(t, 'ws', 'repo'), { recursive: true });
  const id = git.detectIdentity(join(t, 'ws', 'repo'), { vaultDir: join(t, 'brain', 'ws') });
  assert.equal(id.source, 'gitconfig-file');
  assert.equal(id.email, 'file@example.invalid');
  assert.equal(id.includePath, '../../../ws/.gitconfig');
});

test('init applies the detected .gitconfig identity through include.path', { skip: !hasGit }, async () => {
  const { t, cfgFile } = blank();
  write(join(t, 'ws', '.gitconfig'), '[user]\n\tname = File Person\n\temail = file@example.invalid\n');
  const r = await cli(cfgFile, join(t, 'ws'), 'init', 'ws', '--language', 'en', '--git-mode', 'per-workspace');
  assert.equal(r.code, 0, r.err);
  const v = join(t, 'root', 'ws');
  assert.equal(gitOut(v, ['config', 'user.email']), 'file@example.invalid');
});

test('attach binds without mapping; resolve of the cwd stays unmapped', async () => {
  const { t, cfgFile, stateDir } = blank();
  await cli(cfgFile, t, 'init', 'main', '--language', 'en', '--path', join(t, 'main'));
  const loose = join(t, 'loose');
  fs.mkdirSync(loose);
  const r = await cli(cfgFile, loose, '--session', 's-att', 'attach', 'main');
  assert.equal(r.code, 0, r.err);
  assert.equal(state.readIndex(stateDir, 's-att').attached, true);
  assert.equal(resolveWorkspace(loadConfig(cfgFile), loose).status, 'unmapped');
  await cli(cfgFile, loose, '--session', 's-att', 'detach');
  assert.equal(state.readIndex(stateDir, 's-att').detached, true);
  assert.equal((await cli(cfgFile, loose, 'attach', 'main')).code, 2);
});

test('workspace map then resolve; list and ignore', async () => {
  const { t, cfgFile } = blank();
  await cli(cfgFile, t, 'workspace', 'add', 'zed', '--path', join(t, 'z1'), '--path', join(t, 'z2'), '--language', 'en');
  await cli(cfgFile, t, 'workspace', 'map', join(t, 'z3'), 'zed');
  await cli(cfgFile, t, 'workspace', 'ignore', join(t, 'z3', 'tmp'));
  const cfg = loadConfig(cfgFile);
  assert.equal(resolveWorkspace(cfg, join(t, 'z2', 'x')).name, 'zed');
  assert.equal(resolveWorkspace(cfg, join(t, 'z3')).name, 'zed');
  assert.equal(resolveWorkspace(cfg, join(t, 'z3', 'tmp')).status, 'ignored');
  assert.match((await cli(cfgFile, t, 'workspace', 'list')).out, /zed → /);
});

test('idea, context, search, project and status commands', async () => {
  const { cfgFile, code } = makeVault();
  fs.mkdirSync(join(code, 'alpha'), { recursive: true });
  const cwd = join(code, 'alpha');
  await cli(cfgFile, cwd, 'idea', 'add', 'Export', 'EPUB');
  const list = JSON.parse((await cli(cfgFile, cwd, '--json', 'idea', 'list')).out);
  assert.equal(list[0].project, 'alpha');
  assert.equal((await cli(cfgFile, cwd, 'idea', 'promote', list[0].id, '--to', 'EPUB Export')).code, 0);
  await cli(cfgFile, cwd, 'task', 'add', 'EPUB Export');
  assert.match((await cli(cfgFile, cwd, 'context')).out, /EPUB Export/);
  assert.match((await cli(cfgFile, cwd, 'search', 'epub')).out, /EPUB Export/);
  assert.equal((await cli(cfgFile, cwd, 'project', 'split', 'alpha')).code, 0);
  assert.match((await cli(cfgFile, cwd, 'project', 'list')).out, /alpha .*split/);
  assert.equal((await cli(cfgFile, cwd, 'project', 'merge', 'alpha')).code, 0);
  assert.match((await cli(cfgFile, cwd, 'status')).out, /workspace w/);
});
