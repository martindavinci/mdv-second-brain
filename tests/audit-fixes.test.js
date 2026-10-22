'use strict';
// Regression tests for the Codex audit (F = finding) and the ROI minors (R/M).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');
const { read, write, makeVault, io, daysAgo, ymd } = require('./helpers');
const tasks = require('../scripts/lib/tasks');
const boards = require('../scripts/lib/boards');
const board = require('../scripts/lib/board');
const ideas = require('../scripts/lib/ideas');
const secrets = require('../scripts/lib/secrets');
const budget = require('../scripts/lib/budget');
const daily = require('../scripts/lib/daily');
const git = require('../scripts/lib/git');
const lock = require('../scripts/lib/lock');
const adopt = require('../scripts/lib/adopt');
const markers = require('../scripts/lib/markers');
const { main } = require('../scripts/brain');
const { run } = require('../scripts/hook');
const { defaults, saveConfig, loadConfig } = require('../scripts/lib/config');
const { projectFor } = require('../scripts/lib/resolve');

const hasGit = git.available();
const gitOut = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const cli = async (cfgFile, cwd, ...args) => {
  const o = io();
  const code = await main(['--config', cfgFile, ...args], { cwd, ...o });
  return { code, out: o.text(), err: o.errText() };
};
function blank(extra = {}) {
  const t = fs.mkdtempSync(join(os.tmpdir(), 'sb-au-'));
  const cfgFile = join(t, 'cfg', 'config.json');
  const cfg = { root: join(t, 'root'), ...extra };
  fs.mkdirSync(join(t, 'cfg'), { recursive: true });
  fs.writeFileSync(cfgFile, JSON.stringify(cfg));
  return { t, cfgFile, stateDir: join(t, 'cfg', 'state') };
}

// --- F1: modified tracked files are scanned ---

test('F1 scanChanged sees a modified tracked file', { skip: !hasGit }, () => {
  const t = fs.mkdtempSync(join(os.tmpdir(), 'sb-f1-'));
  git.init(t);
  write(join(t, 'MEMORY.md'), '# m\n');
  git.run(t, ['add', '-A']);
  git.run(t, ['-c', 'user.name=T', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'x']);
  write(join(t, 'MEMORY.md'), '# m\npassword=abcdefgh\n');
  assert.deepEqual(secrets.scanChanged(t, '.'), [{ file: 'MEMORY.md', line: 2, kind: 'assignment' }]);
});

// --- F2: identity per commit, never accumulated in a shared repo ---

test('F2 single mode commits each workspace with its own identity', { skip: !hasGit }, async () => {
  const { t, cfgFile } = blank({ git: { mode: 'single' } });
  for (const [n, who] of [['a', 'Alpha'], ['b', 'Beta']]) {
    write(join(t, n, '.gitconfig'), `[user]\n\tname = ${who}\n\temail = ${n}@example.invalid\n`);
    assert.equal((await cli(cfgFile, join(t, n), 'init', n, '--git-mode', 'single', '--language', 'en')).code, 0);
  }
  await cli(cfgFile, join(t, 'a'), 'task', 'add', 'A work');
  assert.match((await cli(cfgFile, join(t, 'a'), 'commit', '-m', 'a')).out, /committed/);
  assert.equal(gitOut(join(t, 'root'), ['log', '-1', '--format=%ae']), 'a@example.invalid');
  await cli(cfgFile, join(t, 'b'), 'task', 'add', 'B work');
  assert.match((await cli(cfgFile, join(t, 'b'), 'commit', '-m', 'b')).out, /committed/);
  assert.equal(gitOut(join(t, 'root'), ['log', '-1', '--format=%ae']), 'b@example.invalid');
  let includes = '';
  try {
    includes = gitOut(join(t, 'root'), ['config', '--local', '--get-all', 'include.path']);
  } catch {}
  assert.equal(includes, '');
});

test('F2 detectIdentity falls back to the author of the last commit', { skip: !hasGit }, () => {
  const t = fs.mkdtempSync(join(os.tmpdir(), 'sb-f2-'));
  const repo = join(t, 'repo');
  git.init(repo);
  write(join(repo, 'x.txt'), 'x');
  git.run(repo, ['add', '-A']);
  git.run(repo, ['-c', 'user.name=Log Person', '-c', 'user.email=log@example.invalid', 'commit', '-q', '-m', 'x']);
  const id = git.detectIdentity(repo, {});
  assert.deepEqual([id.source, id.name, id.email], ['log', 'Log Person', 'log@example.invalid']);
  const parent = git.detectIdentity(t, {});
  assert.deepEqual([parent.source, parent.email], ['log', 'log@example.invalid']);
});

// --- F3: pathspecs are literal ---

test('F3 the pathspec team[1] is literal and never matches team1', { skip: !hasGit }, () => {
  const t = fs.mkdtempSync(join(os.tmpdir(), 'sb-f3-'));
  git.init(t);
  write(join(t, 'team1', 'b.md'), 'sibling\n');
  const r = git.commitPath(t, 'team[1]', 'x', { identity: { name: 'T', email: 't@example.invalid' } });
  assert.equal(r.committed, false);
  assert.match(gitOut(t, ['status', '--porcelain']), /\?\? team1\//);
});

// --- F4: ideas are archived before they leave the inbox ---

test('F4 a failing archive write keeps the idea in the inbox', () => {
  const { ctx, vault: v } = makeVault();
  const now = new Date();
  ideas.addIdea(ctx, 'Old', { now: daysAgo(40, now) });
  ideas.discardIdea(ctx, ideas.listIdeas(ctx, {})[0].id, daysAgo(30, now));
  const arch = join(v, '90_Archive', 'Ideas Archive.md');
  write(arch, '# Ideas Archive\n');
  fs.chmodSync(arch, 0o444);
  try {
    assert.throws(() => ideas.archiveIdeas(ctx, now, 14));
  } finally {
    fs.chmodSync(arch, 0o644);
  }
  assert.match(read(join(v, '00_Inbox', 'Ideas.md')), /~~Old~~/);
});

// --- F5: vault lock and checkpoint command ---

test('F5 withLock is re-entrant, waits, and breaks stale locks', () => {
  const { vault: v } = makeVault();
  assert.equal(lock.withLock(v, () => lock.withLock(v, () => 7)), 7);
  const f = join(v, '.brain', 'lock');
  fs.writeFileSync(f, 'busy');
  assert.throws(() => lock.withLock(v, () => 1, { timeoutMs: 100 }), /vault-locked/);
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(f, old, old);
  assert.equal(lock.withLock(v, () => 2, { timeoutMs: 100 }), 2);
  assert.ok(!fs.existsSync(f));
});

test('F5 checkpoint rewrites only this session’s section', async () => {
  const { cfgFile, code, vault: v } = makeVault();
  daily.ensureSessionSection(v, 'en', 'aaaaaaaa-1', new Date());
  daily.ensureSessionSection(v, 'en', 'bbbbbbbb-2', new Date());
  const r = await cli(cfgFile, code, '--session', 'aaaaaaaa-1', 'checkpoint', '--status', 'parser done', '--next', 'tests', '--log', 'wired the CLI');
  assert.equal(r.code, 0, r.err);
  const text = read(daily.dailyPath(v, new Date()));
  const mine = markers.getSection(text, 'session:aaaaaaaa');
  assert.match(mine, /- Status: parser done\n- Next: tests\n- Open: —/);
  assert.match(mine, /Log:\n- \d\d:\d\d started\n- \d\d:\d\d wired the CLI/);
  assert.match(markers.getSection(text, 'session:bbbbbbbb'), /- Status: just started/);
  assert.ok(fs.existsSync(join(v, '.brain', 'state', 'aaaaaaaa-1.cli')));
});

// --- F6: merge keeps board head prose and hand-written split indexes ---

test('F6 merge keeps prose above the lanes and a hand-written split Bugs.md', () => {
  const { ctx, vault: v } = makeVault();
  boards.splitProject(ctx, 'alpha');
  const pf = join(v, '00_Inbox', 'alpha', 'alpha Plan.md');
  write(pf, read(pf).replace('---\n\n## ToDo', '---\n\nNotes the user keeps above the lanes.\n\n## ToDo'));
  write(join(v, '00_Inbox', 'alpha', 'alpha Bugs.md'), '# my own alpha bug list\n');
  boards.mergeProject(ctx, 'alpha');
  const everywhere = fs.readdirSync(v, { recursive: true }).filter((f) => f.endsWith('.md')).map((f) => read(join(v, f))).join('\n');
  assert.match(everywhere, /Notes the user keeps above the lanes/);
  assert.match(everywhere, /my own alpha bug list/);
});

// --- F7: multiline secrets ---

test('F7 multiline values are refused and hand-written block lines survive', () => {
  const { vault: v } = makeVault();
  assert.throws(() => secrets.setSecret(v, 'PEM', 'line1\nline2'), /multiline-secret/);
  write(join(v, 'secrets.local.md'), '# Secrets\n\n```env\nKEY_A=1\n# my note\nPEM_KEY=-----BEGIN\n  continued line\n```\n');
  secrets.setSecret(v, 'KEY_B', '2');
  const text = read(join(v, 'secrets.local.md'));
  assert.match(text, /# my note\nPEM_KEY=-----BEGIN\n  continued line\nKEY_B=2\n```/);
  secrets.setSecret(v, 'KEY_A', '9');
  assert.match(read(join(v, 'secrets.local.md')), /^KEY_A=9$/m);
});

// --- F8: overlapping vaults are refused ---

test('F8 a vault equal to or inside another workspace vault is refused', async () => {
  const { t, cfgFile } = blank({ git: { mode: 'none' } });
  fs.mkdirSync(join(t, 'a'));
  fs.mkdirSync(join(t, 'b'));
  await cli(cfgFile, join(t, 'a'), 'init', 'a', '--git-mode', 'none', '--language', 'en');
  const r = await cli(cfgFile, join(t, 'b'), 'init', 'b', '--vault', join(t, 'root', 'a', 'sub'), '--git-mode', 'none', '--language', 'en');
  assert.equal(r.code, 2);
  assert.match(r.err, /vault overlaps workspace a/);
  assert.equal((await cli(cfgFile, t, 'workspace', 'add', 'c', '--vault', join(t, 'root', 'a'))).code, 2);
  assert.equal((await cli(cfgFile, t, 'workspace', 'add', 'd', '--vault', join(t, 'root'))).code, 2);
});

// --- F9 / F10: session binding follows the folder; transitions are announced ---

function hookEnv() {
  const t = fs.mkdtempSync(join(os.tmpdir(), 'sb-hk-'));
  const cfgFile = join(t, 'cfg', 'config.json');
  const cfg = defaults();
  cfg.root = join(t, 'root');
  cfg.workspaces.alpha = { paths: [join(t, 'a')], language: 'en', git: { mode: 'none' } };
  cfg.workspaces.beta = { paths: [join(t, 'b')], language: 'en', git: { mode: 'none' } };
  saveConfig(cfg, cfgFile);
  for (const d of ['a', 'b', 'loose']) fs.mkdirSync(join(t, d));
  const base = new Date(2026, 9, 21, 10, 0).getTime();
  const call = (event, input, min = 0) => run(event, { session_id: 'sess-hk', ...input }, { now: new Date(base + min * 60000), cfgFile, cli: '/x/brain.js' }).stdout;
  return { t, call };
}
const ctxText = (out) => (out ? JSON.parse(out).hookSpecificOutput.additionalContext : '');

test('F9 a session resumed in an unmapped folder goes inert, and back in its folder it is active again', () => {
  const { t, call } = hookEnv();
  assert.match(ctxText(call('session-start', { cwd: join(t, 'a'), source: 'startup' })), /workspace=alpha/);
  assert.equal(call('session-start', { cwd: join(t, 'loose'), source: 'resume' }, 5), '');
  assert.equal(call('prompt', { cwd: join(t, 'loose') }, 6), '');
  call('post-tool', { cwd: join(t, 'loose'), tool_name: 'Edit', tool_input: { file_path: join(t, 'loose', 'x') } }, 7);
  assert.equal(call('stop', { cwd: join(t, 'loose') }, 8), '');
  assert.match(ctxText(call('session-start', { cwd: join(t, 'a'), source: 'resume' }, 9)), /workspace=alpha/);
});

test('F10 every workspace transition is announced, including the way back', () => {
  const { t, call } = hookEnv();
  const cwd = join(t, 'a');
  call('session-start', { cwd, source: 'startup' });
  const edit = (dir, f, min) => ctxText(call('post-tool', { cwd, tool_name: 'Edit', tool_input: { file_path: join(t, dir, f) } }, min));
  assert.match(edit('b', '1.js', 1), /workspace=beta/);
  assert.equal(edit('b', '2.js', 2), '');
  const back = edit('a', '3.js', 3);
  assert.match(back, /back in workspace=alpha/);
  assert.doesNotMatch(back, /--workspace/);
  assert.equal(edit('a', '4.js', 4), '');
  assert.match(edit('b', '5.js', 5), /workspace=beta/);
});

// --- F11: adopt rewrites links into moved folders ---

test('F11 adopt rewrites links to files inside a moved folder', () => {
  const t = fs.mkdtempSync(join(os.tmpdir(), 'sb-f11-'));
  const src = join(t, 'V');
  write(join(src, '00_Work', 'Sub', 'Keep.md'), '# keep\n');
  write(join(src, '10_Notes', 'Link.md'), 'see [[00_Work/Sub/Keep]]\n');
  const cfgFile = join(t, 'cfg.json');
  saveConfig({ ...defaults(), root: join(t, 'root'), git: { mode: 'none' } }, cfgFile);
  adopt.applyAdopt(loadConfig(cfgFile), src, 'v', adopt.planAdopt(src, new Date()), cfgFile, { language: 'en' });
  assert.ok(fs.existsSync(join(src, '00_Inbox', 'Sub', 'Keep.md')));
  assert.match(read(join(src, '10_Notes', 'Link.md')), /\[\[Keep\]\]/);
});

// --- F12 / R6: initialization only at birth ---

test('F12 after birth, hooks never re-create files the user deleted', () => {
  const { t, call } = hookEnv();
  call('session-start', { cwd: join(t, 'a'), source: 'startup' });
  const v = join(t, 'root', 'alpha');
  assert.ok(fs.existsSync(join(v, '.brain', 'initialized')));
  fs.unlinkSync(join(v, 'AGENTS.md'));
  fs.unlinkSync(join(v, 'TOOLS.md'));
  call('prompt', { cwd: join(t, 'a') }, 1);
  call('post-tool', { cwd: join(t, 'a'), tool_name: 'Edit', tool_input: { file_path: join(t, 'a', 'x.js') } }, 2);
  call('session-start', { session_id: 'other-session', cwd: join(t, 'a'), source: 'startup' }, 3);
  assert.equal(fs.existsSync(join(v, 'AGENTS.md')), false);
  assert.equal(fs.existsSync(join(v, 'TOOLS.md')), false);
});

// --- F13 / M4: inert hook entry ---

test('F13 SessionStart prints nothing when Node is missing; M4 malformed stdin is logged', () => {
  const hooks = JSON.parse(fs.readFileSync(join(__dirname, '..', 'hooks', 'hooks.json'), 'utf8')).hooks;
  assert.doesNotMatch(hooks.SessionStart[0].hooks[0].command, /echo/);
  const t = fs.mkdtempSync(join(os.tmpdir(), 'sb-m4-'));
  const cfgFile = join(t, 'config.json');
  saveConfig(defaults(), cfgFile);
  const r = require('node:child_process').spawnSync(process.execPath, [join(__dirname, '..', 'scripts', 'hook.js'), 'prompt'], { cwd: t, input: 'not json', env: { ...process.env, MDV_SECOND_BRAIN_CONFIG: cfgFile }, encoding: 'utf8' });
  assert.equal(r.stdout, '');
  assert.match(read(join(t, 'error.log')), /bad-input/);
});

// --- R3: more secret patterns ---

test('R3 scan detects Stripe, Google, JWT and *_KEY= secrets', () => {
  const lines = [
    'stripe sk_live_abcdefghijklmnop1234',
    'restricted rk_test_abcdefghijklmnop1234',
    'google AIzaSyA-abcdefghijklmnopqrstuvwxyz012345',
    'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop',
    'SECRET_KEY=abcdef123456',
    'PRIVATE_KEY: abcdef123456',
    'aws ACCESS_KEY=abcdef123456',
  ];
  assert.deepEqual(secrets.scan(lines.join('\n')).map((h) => h.line), [1, 2, 3, 4, 5, 6, 7]);
});

// --- R7: old session state is pruned ---

test('R7 index prunes session state older than 30 days', async () => {
  const { cfgFile, code, vault: v, t } = makeVault();
  const st = join(v, '.brain', 'state');
  write(join(st, 'old.json'), '{}');
  write(join(st, 'old.cli'), 'x');
  write(join(st, 'new.json'), '{}');
  write(join(t, 'cfg', 'state', 'sessions', 'old.json'), '{}');
  const old = daysAgo(40);
  for (const f of [join(st, 'old.json'), join(st, 'old.cli'), join(t, 'cfg', 'state', 'sessions', 'old.json')]) fs.utimesSync(f, old, old);
  assert.equal((await cli(cfgFile, code, 'index')).code, 0);
  assert.ok(!fs.existsSync(join(st, 'old.json')));
  assert.ok(!fs.existsSync(join(st, 'old.cli')));
  assert.ok(fs.existsSync(join(st, 'new.json')));
  assert.ok(!fs.existsSync(join(t, 'cfg', 'state', 'sessions', 'old.json')));
});

// --- R8: config keeps only what the user set ---

test('R8 saveConfig writes only values that differ from the defaults', () => {
  const t = fs.mkdtempSync(join(os.tmpdir(), 'sb-r8-'));
  const f = join(t, 'config.json');
  const cfg = loadConfig(f);
  cfg.workspaces.w = { paths: [t], language: 'en' };
  cfg.budgets.hub = 1234;
  saveConfig(cfg, f);
  const raw = JSON.parse(read(f));
  assert.deepEqual(Object.keys(raw).sort(), ['budgets', 'version', 'workspaces']);
  assert.deepEqual(raw.budgets, { hub: 1234 });
  assert.equal(loadConfig(f).budgets.log, 6000);
});

// --- M6: Kanban **Complete** marker ---

test('M6 a card added to an empty completed lane goes below the **Complete** marker', () => {
  const b = board.parseBoard('## Done\n\n**Complete**\n\n## Other\n');
  board.appendCard(b.lanes[0], { checked: true, text: '[[X]]' });
  assert.match(board.serializeBoard(b), /## Done\n\n\*\*Complete\*\*\n- \[x\] \[\[X\]\]\n/);
});

// --- M7: listing ideas is a pure read ---

test('M7 idea list never writes; ids stay stable; struck open lines keep their ~~', () => {
  const { ctx, vault: v } = makeVault();
  const f = join(v, '00_Inbox', 'Ideas.md');
  write(f, '# Ideas\n\n## General\n\n- [ ] plain idea\n- [ ] ~~struck but open~~\n');
  const before = read(f);
  const a = ideas.listIdeas(ctx, {});
  const b = ideas.listIdeas(ctx, {});
  assert.equal(read(f), before);
  assert.deepEqual(a.map((i) => i.id), b.map((i) => i.id));
  ideas.promoteIdea(ctx, a[0].id, 'Plain Task');
  assert.match(read(f), /- \[ \] ~~struck but open~~/);
  assert.match(read(f), new RegExp(`plain idea → \\[\\[Plain Task\\]\\] 🆔 ${a[0].id}`));
});

// --- M9: log rotation keeps blank lines inside entries ---

test('M9 rotateLogs keeps blank lines that belong to an entry', () => {
  const { ctx } = makeVault();
  ctx.budgets = { log: 200 };
  const r = tasks.addItem(ctx, 'task', { title: 'Blanky' });
  const entries = Array.from({ length: 8 }, (_, i) => `- 2026-10-0${i + 1} — entry ${i}\n  detail ${i}\n\n  more ${i}`);
  write(r.file, read(r.file).replace(/## Log\n[\s\S]*$/, () => `## Log\n${entries.join('\n')}\n`));
  budget.rotateLogs(ctx);
  assert.match(read(r.file), /  detail 7\n\n  more 7/);
});

// --- M11: commit validates its message first ---

test('M11 commit without -m changes nothing', async () => {
  const { cfgFile, code, vault: v } = makeVault();
  const r = await cli(cfgFile, code, 'commit');
  assert.equal(r.code, 2);
  assert.ok(!fs.existsSync(join(v, '.brain', 'oversize.json')));
});

// --- M12: adopt ignores PKM statuses ---

test('M12 adopt does not turn evergreen notes into tasks', () => {
  assert.equal(adopt.classify({ status: 'evergreen' }), null);
  assert.equal(adopt.classify({ type: 'note', status: 'todo' }), null);
  assert.equal(adopt.classify({ status: 'in progress' }), 'task');
});

// --- M13: project casing comes from the disk ---

test('M13 projectFor returns the folder name as it is on disk', { skip: process.platform !== 'win32' }, () => {
  const t = fs.mkdtempSync(join(os.tmpdir(), 'sb-m13-'));
  fs.mkdirSync(join(t, 'MyRepo'));
  const cfg = { ...defaults(), workspaces: { w: { paths: [t] } } };
  assert.equal(projectFor(cfg, 'w', join(t, 'myrepo', 'x.js')), 'MyRepo');
});

// --- M14: command description ---

test('M14 /brain description says it is for activated workspaces', () => {
  const text = read(join(__dirname, '..', 'commands', 'brain.md'));
  assert.match(text.split('\n').find((l) => l.startsWith('description:')), /only|activated|init/i);
});

void ymd;
