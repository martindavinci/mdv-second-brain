'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join } = require('node:path');
const frontmatter = require('../scripts/lib/frontmatter');

const repo = join(__dirname, '..');
const read = (f) => fs.readFileSync(join(repo, f), 'utf8');
const MODEL_DRIVEN = new Set(['distill']);
const GROUPS = new Set(['task', 'issue', 'feature', 'idea', 'project', 'workspace', 'secret']);

test('SKILL.md has name and a one-line description; body ≤ 8000 chars', () => {
  const { data, body } = frontmatter.parse(read('skills/second-brain/SKILL.md'));
  assert.equal(data.name, 'second-brain');
  assert.ok(typeof data.description === 'string' && data.description.length > 40 && !data.description.includes('\n'));
  assert.ok(body.length <= 8000, String(body.length));
  assert.match(body, /\$\{CLAUDE_SESSION_ID\}/);
});

test('/brain command has a one-line description and an argument hint', () => {
  const { data } = frontmatter.parse(read('commands/brain.md'));
  assert.ok(typeof data.description === 'string' && !data.description.includes('\n'));
  assert.ok(data['argument-hint']);
});

test('every CLI subcommand named in SKILL.md and brain.md exists in brain.js (except distill)', () => {
  const cli = read('scripts/brain.js');
  const cases = new Set([...cli.matchAll(/case '([a-z-]+)':/g)].map((m) => m[1]));
  for (const f of ['skills/second-brain/SKILL.md', 'commands/brain.md', 'README.md']) {
    for (const m of read(f).matchAll(/`brain ([^`]*)`/g)) {
      const tokens = m[1].split(/\s+/).filter(Boolean);
      let i = 0;
      while (i < tokens.length && tokens[i].startsWith('--')) i += ['--json', '--yes'].includes(tokens[i]) ? 1 : 2;
      const cmd = tokens[i];
      const sub = /^[a-z]+$/.test(tokens[i + 1] || '') ? tokens[i + 1] : undefined;
      if (!cmd || !/^[a-z]+$/.test(cmd) || MODEL_DRIVEN.has(cmd)) continue;
      assert.ok(cases.has(cmd), `${f}: unknown command "${cmd}"`);
      if (GROUPS.has(cmd) && sub) assert.ok(cases.has(sub), `${f}: unknown subcommand "${cmd} ${sub}"`);
    }
  }
});

test('hooks.json wires the four events to scripts/hook.js', () => {
  const hooks = JSON.parse(read('hooks/hooks.json')).hooks;
  assert.deepEqual(Object.keys(hooks).sort(), ['PostToolUse', 'SessionStart', 'Stop', 'UserPromptSubmit']);
  for (const [event, arg] of [['SessionStart', 'session-start'], ['UserPromptSubmit', 'prompt'], ['PostToolUse', 'post-tool'], ['Stop', 'stop']]) {
    assert.match(hooks[event][0].hooks[0].command, new RegExp(`scripts/hook\\.js" ${arg}`));
  }
});
