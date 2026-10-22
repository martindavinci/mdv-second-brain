'use strict';
// A vault repo owned by another account (on Windows the Codex sandbox runs as its own user): git calls it
// "dubious ownership" and refuses it, so the plugin trusts the configured vault's repo for its own commands only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');
const { main } = require('../scripts/brain');
const git = require('../scripts/lib/git');

const gitIn = (dir, args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function io(cwd, env) {
  const out = [];
  const err = [];
  return { cwd, env, stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) }, out, err };
}

// Every git command in the block sees the repos as another account's, like the Codex sandbox user does.
async function asOtherAccount(fn) {
  process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER = '1';
  try {
    return await fn();
  } finally {
    delete process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER;
  }
}

async function setup() {
  const t = fs.mkdtempSync(join(os.tmpdir(), 'sb-owner-'));
  const proj = join(t, 'app');
  fs.mkdirSync(proj, { recursive: true });
  gitIn(proj, ['init', '-q']);
  gitIn(proj, ['config', 'user.name', 'Repo Person']);
  gitIn(proj, ['config', 'user.email', 'repo@example.invalid']);
  const env = { MDV_SECOND_BRAIN_CONFIG: join(t, 'cfg', 'config.json') };
  const vault = join(t, 'vault');
  const o = io(proj, env);
  assert.equal(await main(['--session', 's-own-1', 'init', 'app', '--path', proj, '--vault', vault, '--language', 'en', '--git-mode', 'per-workspace'], o), 0, o.err.join(''));
  return { t, proj, env, vault };
}

test('git refuses a repo owned by another account (the condition the fix is for)', async () => {
  const { vault } = await setup();
  await asOtherAccount(() => assert.throws(() => gitIn(vault, ['status']), /dubious ownership/));
});

test('a vault repo owned by another account still commits, with the workspace identity', async () => {
  const { proj, env, vault } = await setup();
  await asOtherAccount(async () => {
    const add = io(proj, env);
    assert.equal(await main(['--session', 's-own-1', 'task', 'add', 'Login flow'], add), 0, add.err.join(''));
    const again = io(proj, env);
    assert.equal(await main(['--session', 's-own-1', 'init', 'app', '--path', proj, '--vault', vault, '--language', 'en', '--git-mode', 'per-workspace'], again), 0, again.err.join(''));
    const c = io(proj, env);
    assert.equal(await main(['--session', 's-own-1', 'commit', '-m', 'login task'], c), 0, c.err.join(''));
    assert.match(c.out.join(''), /committed/);
  });
  assert.equal(gitIn(vault, ['log', '-1', '--format=%an <%ae>']), 'Repo Person <repo@example.invalid>');
});

test('only the vault is trusted: the project repo beside it stays refused', async () => {
  const { proj, env } = await setup();
  await asOtherAccount(async () => {
    const add = io(proj, env);
    assert.equal(await main(['--session', 's-own-1', 'task', 'add', 'Other'], add), 0, add.err.join(''));
    assert.equal(git.toplevel(proj), null);
  });
});
