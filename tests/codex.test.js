'use strict';
// Codex host: plugin manifest, hooks wiring, apply_patch paths, session id from the environment, twin skill.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const { defaults, saveConfig } = require('../scripts/lib/config');
const frontmatter = require('../scripts/lib/frontmatter');
const { run } = require('../scripts/hook');
const { main } = require('../scripts/brain');
const state = require('../scripts/lib/state');
const { patchPaths, toolPaths } = require('../scripts/lib/patch');

const repo = join(__dirname, '..');
const read = (f) => fs.readFileSync(join(repo, f), 'utf8');
const json = (f) => JSON.parse(read(f));
const SID = 'thr-0001-abcdef';

function env() {
  const t = fs.mkdtempSync(join(os.tmpdir(), 'sb-codex-'));
  const cfgFile = join(t, 'cfg', 'config.json');
  const cfg = defaults();
  cfg.root = join(t, 'root');
  cfg.workspaces.alpha = { paths: [join(t, 'alpha-code')], language: 'en', git: { mode: 'none' } };
  cfg.workspaces.beta = { paths: [join(t, 'beta-code')], language: 'en', git: { mode: 'none' } };
  saveConfig(cfg, cfgFile);
  for (const d of ['alpha-code/repo', 'beta-code/other', 'loose']) fs.mkdirSync(join(t, d), { recursive: true });
  const now = new Date(2026, 9, 21, 10, 0);
  const call = (event, input, min = 0) => run(event, { session_id: SID, ...input }, { now: new Date(now.getTime() + min * 60000), cli: '/x/brain.js', cfgFile }).stdout;
  return { t, cfgFile, call, alphaVault: join(t, 'root', 'alpha'), stateDir: join(t, 'cfg', 'state') };
}

const patch = (...lines) => ['*** Begin Patch', ...lines, '*** End Patch'].join('\n');

test('patchPaths reads every file an apply_patch adds, updates, moves or deletes', () => {
  const p = ['*** Begin Patch', '*** Add File: a.txt', '+hi', '*** Update File: src/b.js', '*** Move to: src/c.js', '@@', '-x', '+y', '*** Delete File: old.md', '*** End Patch'].join('\r\n');
  assert.deepEqual(patchPaths(p), ['a.txt', 'src/b.js', 'src/c.js', 'old.md']);
});

test('patchPaths ignores content lines and non-patch input', () => {
  assert.deepEqual(patchPaths(patch('*** Add File: a.txt', '+*** Add File: not-a-header.txt')), ['a.txt']);
  assert.deepEqual(patchPaths('echo hello'), []);
  assert.deepEqual(patchPaths(undefined), []);
});

test('toolPaths: Claude file_path, Codex apply_patch command (string or argv array)', () => {
  const names = (input) => toolPaths(input).map((f) => f.path);
  assert.deepEqual(names({ tool_name: 'Edit', tool_input: { file_path: 'a.js' } }), ['a.js']);
  assert.deepEqual(names({ tool_name: 'NotebookEdit', tool_input: { notebook_path: 'n.ipynb' } }), ['n.ipynb']);
  assert.deepEqual(names({ tool_name: 'apply_patch', tool_input: { command: patch('*** Add File: x.md', '+x') } }), ['x.md']);
  assert.deepEqual(names({ tool_name: 'apply_patch', tool_input: { command: ['apply_patch', patch('*** Update File: y.md')] } }), ['y.md']);
  assert.deepEqual(names({ tool_name: 'Bash', tool_input: { command: 'ls -la' } }), []);
  assert.deepEqual(names({}), []);
});

test('toolPaths marks deleted files and move sources as gone', () => {
  const p = patch('*** Delete File: old.md', '*** Update File: a.md', '*** Move to: b.md', '@@', '+x', '*** Add File: c.md', '+c');
  assert.deepEqual(toolPaths({ tool_name: 'apply_patch', tool_input: { command: p } }), [
    { path: 'old.md', gone: true },
    { path: 'a.md', gone: true },
    { path: 'b.md', gone: false },
    { path: 'c.md', gone: false },
  ]);
});

test('post-tool: a deleted or moved-away plan is never captured; its destination is', () => {
  const e = env();
  const cwd = join(e.t, 'alpha-code', 'repo');
  e.call('session-start', { cwd, source: 'startup' });
  const del = e.call('post-tool', { cwd, tool_name: 'apply_patch', tool_input: { command: patch('*** Delete File: docs/superpowers/plans/old.md') } }, 1);
  assert.equal(del, '');
  assert.ok(state.load(e.alphaVault, SID).dirtyAt);
  const mv = e.call('post-tool', { cwd, tool_name: 'apply_patch', tool_input: { command: patch('*** Update File: docs/superpowers/plans/a.md', '*** Move to: docs/superpowers/specs/b.md', '@@', '+x') } }, 2);
  const c = JSON.parse(mv).hookSpecificOutput.additionalContext;
  assert.match(c, /capture: summarise .*b\.md/);
  assert.doesNotMatch(c, /a\.md/);
});

test('hook.js with no config drains a large stdin and exits cleanly', () => {
  const t = fs.mkdtempSync(join(os.tmpdir(), 'sb-codex-nocfg-'));
  const input = JSON.stringify({ hook_event_name: 'PostToolUse', session_id: SID, cwd: t, tool_name: 'apply_patch', tool_input: { command: 'x'.repeat(4 * 1024 * 1024) } });
  const r = spawnSync(process.execPath, [join(repo, 'scripts', 'hook.js')], { input, env: { ...process.env, MDV_SECOND_BRAIN_CONFIG: join(t, 'none.json') }, encoding: 'utf8' });
  assert.equal(r.error, undefined, String(r.error));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.ok(!fs.existsSync(join(t, 'none.json')));
});

test('post-tool: a Codex apply_patch on workspace files marks the session dirty and Stop blocks', () => {
  const e = env();
  const cwd = join(e.t, 'alpha-code', 'repo');
  e.call('session-start', { cwd, source: 'startup' });
  e.call('prompt', { cwd, prompt: 'go' }, 1);
  const p = patch('*** Add File: a.js', '+x', `*** Update File: ${join(cwd, 'b.js')}`, '@@', '-y', '+z');
  assert.equal(e.call('post-tool', { cwd, tool_name: 'apply_patch', tool_input: { command: p } }, 2), '');
  assert.ok(state.load(e.alphaVault, SID).dirtyAt);
  assert.equal(JSON.parse(e.call('stop', { cwd }, 3)).decision, 'block');
});

test('post-tool: an apply_patch that only touches the vault flushes, so Stop stays quiet', () => {
  const e = env();
  const cwd = join(e.t, 'alpha-code', 'repo');
  e.call('session-start', { cwd, source: 'startup' });
  e.call('prompt', { cwd, prompt: 'go' }, 1);
  e.call('post-tool', { cwd, tool_name: 'apply_patch', tool_input: { command: patch('*** Add File: a.js', '+x') } }, 2);
  e.call('prompt', { cwd, prompt: 'more' }, 3);
  e.call('post-tool', { cwd, tool_name: 'apply_patch', tool_input: { command: patch('*** Add File: c.js', '+x') } }, 4);
  e.call('post-tool', { cwd, tool_name: 'apply_patch', tool_input: { command: patch(`*** Update File: ${join(e.alphaVault, 'MEMORY.md')}`, '@@', '+m') } }, 5);
  assert.equal(e.call('stop', { cwd }, 6), '');
});

test('post-tool: an apply_patch into another workspace announces the switch once', () => {
  const e = env();
  const cwd = join(e.t, 'alpha-code', 'repo');
  e.call('session-start', { cwd, source: 'startup' });
  const other = join(e.t, 'beta-code', 'other');
  const out = e.call('post-tool', { cwd, tool_name: 'apply_patch', tool_input: { command: patch(`*** Add File: ${join(other, 'a.js')}`, '+x', `*** Add File: ${join(other, 'b.js')}`, '+y') } }, 2);
  const c = JSON.parse(out).hookSpecificOutput.additionalContext;
  assert.equal(c.match(/now working in workspace=beta/g).length, 1);
});

test('hook.js without an event argument takes it from hook_event_name', () => {
  const e = env();
  const input = { hook_event_name: 'SessionStart', session_id: SID, cwd: join(e.t, 'alpha-code', 'repo'), source: 'startup' };
  const r = spawnSync(process.execPath, [join(repo, 'scripts', 'hook.js')], { input: JSON.stringify(input), env: { ...process.env, MDV_SECOND_BRAIN_CONFIG: e.cfgFile }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /workspace=alpha/);
});

test('hooks/codex.json wires the four events to scripts/hook.js through PLUGIN_ROOT', () => {
  const hooks = json('hooks/codex.json').hooks;
  assert.deepEqual(Object.keys(hooks).sort(), ['PostToolUse', 'SessionStart', 'Stop', 'UserPromptSubmit']);
  for (const event of Object.keys(hooks)) {
    const h = hooks[event][0].hooks[0];
    assert.equal(h.type, 'command');
    assert.match(h.command, /PLUGIN_ROOT/);
    assert.match(h.command, /'scripts','hook\.js'/);
    assert.ok(h.timeout > 0 && h.timeout <= 10);
  }
  assert.match('apply_patch', new RegExp(hooks.PostToolUse[0].matcher));
  assert.doesNotMatch('Bash', new RegExp(`^(${hooks.PostToolUse[0].matcher})$`));
});

function shells() {
  const list = [{ name: 'default shell', run: (cmd, opts) => spawnSync(cmd, { ...opts, shell: true }) }];
  if (process.platform === 'win32') list.push({ name: 'powershell', run: (cmd, opts) => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], opts) });
  else list.push({ name: 'bash', run: (cmd, opts) => spawnSync('bash', ['-c', cmd], opts) });
  return list;
}

test('the Codex hook command runs unchanged in every shell Codex may use', () => {
  const e = env();
  const cmd = json('hooks/codex.json').hooks.SessionStart[0].hooks[0].command;
  const input = JSON.stringify({ hook_event_name: 'SessionStart', session_id: SID, cwd: join(e.t, 'alpha-code', 'repo'), source: 'startup' });
  for (const sh of shells()) {
    const r = sh.run(cmd, { input, cwd: join(e.t, 'loose'), env: { ...process.env, PLUGIN_ROOT: repo, MDV_SECOND_BRAIN_CONFIG: e.cfgFile }, encoding: 'utf8' });
    assert.equal(r.status, 0, `${sh.name}: ${r.stderr}`);
    assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /workspace=alpha/, sh.name);
  }
});

function io(cwd, envVars) {
  const out = [];
  const err = [];
  return { cwd, env: envVars, stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) }, out, err };
}

test('CLI takes the session from CODEX_THREAD_ID when --session is missing', async () => {
  const e = env();
  const loose = join(e.t, 'loose');
  const a = io(loose, { CODEX_THREAD_ID: 'thr-env-1' });
  assert.equal(await main(['--config', e.cfgFile, 'attach', 'alpha'], a), 0, a.err.join(''));
  assert.equal(state.readIndex(e.stateDir, 'thr-env-1').attached, true);
  const b = io(loose, { CODEX_THREAD_ID: 'thr-env-2' });
  assert.equal(await main(['--config', e.cfgFile, '--session', 'explicit-1', 'attach', 'alpha'], b), 0, b.err.join(''));
  assert.ok(state.readIndex(e.stateDir, 'explicit-1'));
  assert.equal(state.readIndex(e.stateDir, 'thr-env-2'), null);
  assert.equal(await main(['--config', e.cfgFile, 'attach', 'alpha'], io(loose, {})), 2);
});

test('.codex-plugin/plugin.json matches the Claude manifest and points to files that exist', () => {
  const codex = json('.codex-plugin/plugin.json');
  const claude = json('.claude-plugin/plugin.json');
  for (const k of ['name', 'version', 'license', 'repository', 'homepage']) assert.equal(codex[k], claude[k], k);
  assert.equal(codex.version, json('package.json').version);
  assert.ok(fs.existsSync(join(repo, codex.skills, 'second-brain', 'SKILL.md')));
  assert.ok(fs.existsSync(join(repo, codex.hooks)));
  assert.ok(codex.interface && codex.interface.displayName);
});

test('the Codex marketplace lists the plugin from the repository root', () => {
  const m = json('.agents/plugins/marketplace.json');
  const p = m.plugins.find((x) => x.name === 'mdv-second-brain');
  assert.deepEqual(p.source, { source: 'local', path: './' });
});

const CLI_LINE = /^CLI: .*$/m;

test('the Codex skill is the Claude skill with only the CLI line changed', () => {
  const claude = frontmatter.parse(read('skills/second-brain/SKILL.md'));
  const codex = frontmatter.parse(read('codex/skills/second-brain/SKILL.md'));
  assert.equal(codex.data.name, claude.data.name);
  assert.equal(codex.data.description, claude.data.description);
  assert.equal(codex.body.replace(CLI_LINE, 'CLI'), claude.body.replace(CLI_LINE, 'CLI'));
  const line = codex.body.match(CLI_LINE)[0];
  assert.doesNotMatch(codex.body, /\$\{CLAUDE_/);
  assert.match(line, /scripts\/brain\.js/);
  assert.match(line, /CODEX_THREAD_ID/);
  assert.ok(codex.body.length <= 8000, String(codex.body.length));
});

test('the shared skill text names the Codex invocations and question tool too', () => {
  const body = frontmatter.parse(read('codex/skills/second-brain/SKILL.md')).body;
  for (const s of ['$second-brain init', '$second-brain init --quick', '$second-brain distill', 'request_user_input']) assert.ok(body.includes(s), s);
  assert.match(body, /subagent/i);
});
