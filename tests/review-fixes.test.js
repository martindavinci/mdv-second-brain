'use strict';
// Regression tests for the final review findings (C = critical, I = important).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');
const { read, write, makeVault, io, daysAgo, ymd } = require('./helpers');
const tasks = require('../scripts/lib/tasks');
const boards = require('../scripts/lib/boards');
const ideas = require('../scripts/lib/ideas');
const secrets = require('../scripts/lib/secrets');
const budget = require('../scripts/lib/budget');
const daily = require('../scripts/lib/daily');
const retrieve = require('../scripts/lib/retrieve');
const git = require('../scripts/lib/git');
const { main } = require('../scripts/brain');
const { run } = require('../scripts/hook');
const { defaults, saveConfig, loadConfig } = require('../scripts/lib/config');

const hasGit = git.available();
const gitOut = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const cardCount = (text, name) => (text.match(new RegExp(`\\[\\[${name}(\\|[^\\]]*)?\\]\\]`, 'g')) || []).length;
const cli = async (cfgFile, cwd, ...args) => {
  const o = io();
  const code = await main(['--config', cfgFile, ...args], { cwd, ...o });
  return { code, out: o.text(), err: o.errText() };
};

// --- C1: sync never overwrites an existing note ---

test('C1 sync resolves a non-canonical link instead of wiping the note', () => {
  const { ctx, board: b } = makeVault();
  const r = tasks.addItem(ctx, 'task', { title: 'Fix Login' });
  write(r.file, read(r.file) + '- precious content\n');
  write(b, read(b).replace('[[Fix Login]]', '[[Fix  Login]]'));
  tasks.syncFromBoard(ctx);
  assert.match(read(r.file), /precious content/);
  assert.equal(cardCount(read(b), 'Fix Login'), 1);
});

test('C1 an NFD link resolves to the NFC note', () => {
  const { ctx, board: b } = makeVault();
  const r = tasks.addItem(ctx, 'task', { title: 'Perché 2' });
  write(r.file, read(r.file) + '- keep me\n');
  write(b, read(b).replace('[[Perché 2]]', `[[${'Perché 2'.normalize('NFD')}]]`));
  tasks.syncFromBoard(ctx);
  assert.match(read(r.file), /keep me/);
});

test('C1 a link with illegal characters creates its note once and never wipes it', () => {
  const { ctx, vault: v, board: b } = makeVault();
  write(b, read(b).replace('## ToDo\n', '## ToDo\n\n- [ ] [[Server: fix?]]\n'));
  assert.equal(tasks.syncFromBoard(ctx).notesCreated, 1);
  const f = join(v, '10_Notes', 'Tasks', 'Server fix.md');
  write(f, read(f) + '- written later\n');
  assert.equal(tasks.syncFromBoard(ctx).notesCreated, 0);
  assert.match(read(f), /written later/);
});

// --- C2: secrets never committed, even with a pre-existing .gitignore ---

test('C2 adopted vault with its own .gitignore never commits secrets or .brain', { skip: !hasGit }, async () => {
  const t = fs.mkdtempSync(join(os.tmpdir(), 'sb-c2-'));
  const src = join(t, 'Old');
  write(join(src, '.gitignore'), '.obsidian/\n');
  write(join(src, '10_Notes', 'A.md'), '# A\n');
  git.init(src);
  git.run(src, ['config', 'user.name', 'Old Owner']);
  git.run(src, ['config', 'user.email', 'old@example.invalid']);
  git.run(src, ['add', '-A']);
  git.run(src, ['commit', '-q', '-m', 'old']);
  const cfgFile = join(t, 'cfg', 'config.json');
  const cfg = defaults();
  cfg.root = join(t, 'root');
  saveConfig(cfg, cfgFile);
  assert.equal((await cli(cfgFile, t, 'adopt', src, '--as', 'old', '--apply', '--language', 'en')).code, 0);
  await cli(cfgFile, src, 'secret', 'set', 'DB_PASSWORD', 'p4ssw0rd-real');
  const c = await cli(cfgFile, src, 'commit', '-m', 'x');
  assert.match(c.out, /committed/, c.err);
  assert.equal(gitOut(src, ['ls-files', 'secrets.local.md']), '');
  assert.equal(gitOut(src, ['ls-files', '.brain']), '');
  assert.match(read(join(src, '.gitignore')), /^\*\.local\.md$/m);
  assert.match(read(join(src, '.gitignore')), /^\.obsidian\/$/m);
});

// --- C3: identity include path follows the repo that is committed ---

test('C3 single mode: include path is relative to the root repo', { skip: !hasGit }, async () => {
  const t = fs.mkdtempSync(join(os.tmpdir(), 'sb-c3-'));
  write(join(t, 'home', '.gitconfig'), '[user]\n\tname = File Person\n\temail = file@example.invalid\n');
  fs.mkdirSync(join(t, 'home', 'work'), { recursive: true });
  const cfgFile = join(t, 'cfg', 'config.json');
  const cfg = defaults();
  cfg.root = join(t, 'root');
  saveConfig(cfg, cfgFile);
  const r = await cli(cfgFile, t, 'init', 'work', '--path', join(t, 'home', 'work'), '--git-mode', 'single', '--language', 'en');
  assert.equal(r.code, 0, r.err);
  await cli(cfgFile, join(t, 'home', 'work'), 'task', 'add', 'Something');
  const c = await cli(cfgFile, join(t, 'home', 'work'), 'commit', '-m', 'x');
  assert.match(c.out, /committed/, c.err);
  assert.equal(gitOut(join(t, 'root'), ['log', '-1', '--format=%ae']), 'file@example.invalid');
});

test('C3 host mode keeps the identity the project repo already has', { skip: !hasGit }, async () => {
  const t = fs.mkdtempSync(join(os.tmpdir(), 'sb-c3h-'));
  write(join(t, 'top', '.gitconfig'), '[user]\n\tname = Repo Person\n\temail = repo@example.invalid\n');
  const proj = join(t, 'top', 'proj');
  fs.mkdirSync(proj, { recursive: true });
  git.init(proj);
  const cfgFile = join(t, 'cfg', 'config.json');
  const cfg = defaults();
  cfg.root = join(t, 'root');
  saveConfig(cfg, cfgFile);
  const r = await cli(cfgFile, proj, 'init', 'proj', '--vault', join(proj, 'SecondBrain'), '--git-mode', 'host', '--language', 'en');
  assert.equal(r.code, 0, r.err);
  git.run(proj, ['config', 'include.path', '../../.gitconfig']);
  await cli(cfgFile, proj, 'task', 'add', 'Hosted');
  const c = await cli(cfgFile, proj, 'commit', '-m', 'x');
  assert.match(c.out, /committed/, c.err);
  assert.deepEqual(gitOut(proj, ['config', '--local', '--get-all', 'include.path']).split('\n'), ['../../.gitconfig']);
  assert.equal(gitOut(proj, ['log', '-1', '--format=%ae']), 'repo@example.invalid');
});

test('C3 applyGitConfig adds an include.path instead of replacing one', { skip: !hasGit }, () => {
  const { vault: v, cfg } = makeVault({ gitMode: 'per-workspace' });
  git.run(v, ['config', 'include.path', '../mine.gitconfig']);
  cfg.workspaces.w.git.config = { 'include.path': '../other.gitconfig' };
  require('../scripts/lib/vault').applyGitConfig(cfg, 'w', v);
  require('../scripts/lib/vault').applyGitConfig(cfg, 'w', v);
  assert.deepEqual(gitOut(v, ['config', '--local', '--get-all', 'include.path']).split('\n'), ['../mine.gitconfig', '../other.gitconfig']);
});

// --- C4: merge keeps hand-written content ---

test('C4 merge keeps free-text cards, sub-lines and extra lanes', () => {
  const { ctx, vault: v, board: b } = makeVault();
  tasks.addItem(ctx, 'task', { title: 'Alpha One', project: 'alpha' });
  boards.splitProject(ctx, 'alpha');
  const pf = join(v, '00_Inbox', 'alpha', 'alpha Plan.md');
  write(pf, read(pf).replace('## ToDo\n\n', '## ToDo\n\n- [ ] Call the vendor about alpha\n\t- ask for the invoice\n').replace('## Discarded\n', '## Parking\n\nsome prose the user wrote\n\n## Discarded\n'));
  boards.mergeProject(ctx, 'alpha');
  const all = [read(b), ...fs.readdirSync(join(v, '90_Archive'), { recursive: true }).filter((f) => f.endsWith('.md')).map((f) => read(join(v, '90_Archive', f)))].join('\n');
  assert.match(all, /Call the vendor about alpha/);
  assert.match(all, /ask for the invoice/);
  assert.match(all, /some prose the user wrote/);
});

// --- I1: no duplicate cards ---

test('I1 cards in user lanes and in the Kanban archive are not duplicated', () => {
  const { ctx, board: b } = makeVault();
  tasks.addItem(ctx, 'task', { title: 'Export PDF' });
  tasks.addItem(ctx, 'task', { title: 'Old Done', status: 'completed' });
  write(b, read(b).replace('- [ ] [[Export PDF]]\n', '').replace('- [x] [[Old Done]]\n', '').replace('## Discarded\n', '## Review\n\n- [ ] [[Export PDF]]\n\n## Discarded\n').replace('%% kanban:settings', '***\n\n## Archive\n\n- [x] [[Old Done]]\n\n%% kanban:settings'));
  tasks.syncFromBoard(ctx);
  assert.equal(cardCount(read(b), 'Export PDF'), 1);
  assert.equal(cardCount(read(b), 'Old Done'), 1);
});

test('I1 a path-qualified link resolves by basename', () => {
  const { ctx, vault: v, board: b } = makeVault();
  tasks.addItem(ctx, 'task', { title: 'Export PDF', project: 'alpha' });
  write(b, read(b).replace('[[Export PDF]]', '[[20_Projects/alpha/Tasks/Export PDF|the export]]'));
  tasks.syncFromBoard(ctx);
  assert.equal(cardCount(read(b), 'Export PDF'), 1);
  assert.ok(!fs.readdirSync(join(v, '10_Notes', 'Tasks')).length);
});

// --- I2: CRLF files ---

test('I2 a CRLF board syncs without duplicates and stays CRLF', () => {
  const { ctx, board: b } = makeVault();
  tasks.addItem(ctx, 'task', { title: 'One' });
  tasks.addItem(ctx, 'task', { title: 'Two' });
  write(b, read(b).replace(/\n/g, '\r\n'));
  assert.equal(tasks.syncFromBoard(ctx).cardsAdded, 0);
  assert.equal(cardCount(read(b), 'One'), 1);
  assert.ok(!/[^\r]\n/.test(read(b)));
});

test('I2 CRLF ideas and secrets files are read', () => {
  const { ctx, vault: v } = makeVault();
  write(join(v, '00_Inbox', 'Ideas.md'), '# Ideas\r\n\r\n## General\r\n\r\n- [ ] crlf idea 🆔 abc123 ➕ 2026-10-01\r\n');
  assert.equal(ideas.listIdeas(ctx, {})[0].text, 'crlf idea');
  write(join(v, 'secrets.local.md'), '# Secrets\r\n\r\n```env\r\nKEY_A=1\r\n```\r\n');
  assert.deepEqual(secrets.readSecrets(v), { KEY_A: '1' });
});

// --- I3: user frontmatter survives CLI writes ---

test('I3 status and block writes keep user frontmatter lines', () => {
  const { ctx, board: b } = makeVault();
  const r = tasks.addItem(ctx, 'task', { title: 'Rich' });
  const text = read(r.file).replace('---\n# Rich', 'tags: ops\ndescription: |\n  line one\n  line two\nlinks:\n  repo: x\n# a comment\n---\n# Rich');
  write(r.file, text);
  write(b, read(b).replace('## ToDo\n\n- [ ] [[Rich]]\n', '## ToDo\n').replace('## In Progress\n', '## In Progress\n\n- [ ] [[Rich]]\n'));
  tasks.syncFromBoard(ctx);
  tasks.setBlocked(ctx, 'Rich', true);
  const out = read(r.file);
  assert.match(out, /description: \|\n  line one\n  line two\n/);
  assert.match(out, /links:\n  repo: x\n/);
  assert.match(out, /# a comment\n/);
  assert.match(out, /tags: \[ops, status\/blocked\]/);
  assert.match(out, /status: in-progress/);
});

// --- I4: rotation with $ patterns ---

test('I4 log rotation with $& in the log does not corrupt the note', () => {
  const { ctx } = makeVault();
  ctx.budgets = { log: 300 };
  const r = tasks.addItem(ctx, 'task', { title: 'Dollar' });
  const entries = Array.from({ length: 12 }, (_, i) => `- 2026-10-${String(i + 1).padStart(2, '0')} — entry ${i} padding words here`);
  write(r.file, read(r.file).replace(/## Log\n[\s\S]*$/, () => `## Log\n${entries.join('\n')}\n- 2026-10-20 — use $& here\n`));
  const before = read(r.file).length;
  budget.rotateLogs(ctx);
  assert.ok(read(r.file).length < before);
  assert.match(read(r.file), /use \$& here/);
});

// --- I5: archived dailies are never overwritten ---

test('I5 rollover keeps an archived daily of the same date', () => {
  const { vault: v } = makeVault();
  const d = daysAgo(20);
  write(join(v, '90_Archive', 'Daily', `${ymd(d)}.md`), 'ALL SESSIONS\n');
  write(daily.dailyPath(v, d), 'resumed later\n');
  daily.rollover(v, new Date(), 7);
  const files = fs.readdirSync(join(v, '90_Archive', 'Daily')).map((f) => read(join(v, '90_Archive', 'Daily', f))).join('\n');
  assert.match(files, /ALL SESSIONS/);
  assert.match(files, /resumed later/);
});

test('I5 git.moveFile refuses an existing destination', () => {
  const t = fs.mkdtempSync(join(os.tmpdir(), 'sb-mv-'));
  write(join(t, 'a.md'), 'a');
  write(join(t, 'b.md'), 'b');
  assert.throws(() => git.moveFile(join(t, 'a.md'), join(t, 'b.md')), /dest-exists/);
  assert.equal(read(join(t, 'b.md')), 'b');
});

// --- I6: search never returns secrets ---

test('I6 search skips .local.md files', () => {
  const { ctx, vault: v } = makeVault();
  secrets.setSecret(v, 'API_TOKEN', 'hunter2-super-secret-value');
  write(join(v, '10_Notes', 'Private.local.md'), '# private API_TOKEN notes\n');
  assert.deepEqual(retrieve.search(ctx, 'API_TOKEN', { archive: true }), []);
});

// --- I7: Stop blocks every turn in a non-origin workspace ---

test('I7 stop blocks each turn for work in another workspace', () => {
  const t = fs.mkdtempSync(join(os.tmpdir(), 'sb-i7-'));
  const cfgFile = join(t, 'cfg', 'config.json');
  const cfg = defaults();
  cfg.root = join(t, 'root');
  cfg.workspaces.alpha = { paths: [join(t, 'a')], language: 'en', git: { mode: 'none' } };
  cfg.workspaces.beta = { paths: [join(t, 'b')], language: 'en', git: { mode: 'none' } };
  saveConfig(cfg, cfgFile);
  fs.mkdirSync(join(t, 'a'));
  fs.mkdirSync(join(t, 'b'));
  const base = new Date(2026, 9, 21, 10, 0).getTime();
  const call = (event, input, min) => run(event, { session_id: 'sess-i7', cwd: join(t, 'a'), ...input }, { now: new Date(base + min * 60000), cfgFile }).stdout;
  call('session-start', { source: 'startup' }, 0);
  for (let turn = 0; turn < 3; turn++) {
    const m = 1 + turn * 10;
    call('prompt', {}, m);
    call('post-tool', { tool_name: 'Edit', tool_input: { file_path: join(t, 'b', `f${turn}.js`) } }, m + 1);
    assert.match(call('stop', {}, m + 2), /block/, `turn ${turn}`);
  }
});

// --- I8: quick init never merges into a same-named workspace ---

test('I8 init --quick in a same-named folder creates a new workspace', async () => {
  const t = fs.mkdtempSync(join(os.tmpdir(), 'sb-i8-'));
  const cfgFile = join(t, 'cfg', 'config.json');
  const cfg = defaults();
  cfg.root = join(t, 'root');
  cfg.git = { mode: 'none' };
  saveConfig(cfg, cfgFile);
  fs.mkdirSync(join(t, 'clientA', 'app'), { recursive: true });
  fs.mkdirSync(join(t, 'clientB', 'app'), { recursive: true });
  await cli(cfgFile, join(t, 'clientA', 'app'), 'init', '--quick', '--git-mode', 'none', '--language', 'en');
  await cli(cfgFile, join(t, 'clientB', 'app'), 'init', '--quick', '--git-mode', 'none', '--language', 'en');
  const ws = loadConfig(cfgFile).workspaces;
  assert.deepEqual(Object.keys(ws).sort(), ['app', 'app-2']);
  assert.equal(ws.app.paths.length, 1);
});

// --- I9: hand-written Bugs.md / Features.md are kept ---

test('I9 a hand-written Bugs.md is kept as legacy before indexes are generated', () => {
  const { ctx, vault: v } = makeVault();
  write(join(v, '00_Inbox', 'Bugs.md'), '# My bugs\n\n- Safari crashes\n');
  require('../scripts/lib/indexes').rebuildIndexes(ctx);
  assert.match(read(join(v, '00_Inbox', 'Bugs (legacy).md')), /Safari crashes/);
  assert.match(read(join(v, '00_Inbox', 'Bugs.md')), /Generated by mdv-second-brain/);
});

// --- I10: "only this chat" never maps the folder ---

test('I10 SKILL.md activates "only this chat" without init', () => {
  const skill = fs.readFileSync(join(__dirname, '..', 'skills', 'second-brain', 'SKILL.md'), 'utf8');
  const line = skill.split('\n').find((l) => /only this chat/.test(l) && /attach/.test(l));
  assert.ok(line, 'no attach line');
  assert.doesNotMatch(line, /brain init/);
  assert.match(line, /brain workspace add/);
});

// --- M1 (re-graded): the injected `show` command exists ---

test('M1 top-level show works for any note', async () => {
  const { cfgFile, code, vault: v } = makeVault();
  write(join(v, '10_Notes', 'Tooling.md'), '---\ntype: note\n---\n# Tooling\n\n## Setup\nnpm i\n');
  const r = await cli(cfgFile, code, 'show', 'Tooling', '--section', 'Setup');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /npm i/);
});

