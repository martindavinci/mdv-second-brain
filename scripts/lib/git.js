'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Exact output: porcelain status lines start with a meaningful space, so never trim those.
function runRaw(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
}

function run(cwd, args) {
  return runRaw(cwd, args).trim();
}

// Pathspec matched as a plain path ("team[1]" never globs to "team1").
const literal = (pathspec) => (pathspec === '.' ? '.' : `:(literal)${pathspec}`);

// `-c` options that set the commit identity for one command only.
function identityArgs(identity) {
  return identity && identity.name && identity.email ? ['-c', `user.name=${identity.name}`, '-c', `user.email=${identity.email}`] : [];
}

// Not cached: PATH can change between calls (tests, odd shells).
function available() {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore', windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function existingDir(dir) {
  let d = path.resolve(dir);
  while (!fs.existsSync(d)) {
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
  return d;
}

function toplevel(dir) {
  const d = existingDir(dir);
  if (!d) return null;
  try {
    return run(d, ['rev-parse', '--show-toplevel']) || null;
  } catch {
    return null;
  }
}

function init(dir) {
  fs.mkdirSync(dir, { recursive: true });
  run(dir, ['init', '-q']);
}

function excludeInParent(parentTop, dir) {
  const rel = path.relative(parentTop, dir).replace(/\\/g, '/');
  if (!rel || rel.startsWith('..')) return false;
  const file = path.resolve(parentTop, run(parentTop, ['rev-parse', '--git-path', 'info/exclude']));
  const line = `/${rel}/`;
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (text.split(/\r?\n/).includes(line)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text + (text && !text.endsWith('\n') ? '\n' : '') + line + '\n');
  return true;
}

// Never staged, whatever the vault's .gitignore says.
const NEVER = [':(exclude,glob)**/*.local.md', ':(exclude,glob)**/.brain/**'];

function commitPath(repo, pathspec, message, { identity } = {}) {
  if (!available()) return { committed: false, reason: 'git-unavailable' };
  const spec = ['--', literal(pathspec), ...NEVER];
  try {
    run(repo, ['add', '-A', ...spec]);
  } catch (e) {
    // nothing on disk or in the index under that literal path
    if (/did not match any files/.test(String(e.stderr || ''))) return { committed: false, reason: 'no-changes' };
    throw e;
  }
  try {
    run(repo, ['diff', '--cached', '--quiet', ...spec]);
    return { committed: false, reason: 'no-changes' };
  } catch {
    run(repo, [...identityArgs(identity), 'commit', '-q', '-m', message, ...spec]);
    return { committed: true };
  }
}

// Private files git already tracks under pathspec (they must be untracked before any commit).
function trackedPrivate(repo, pathspec) {
  const out = run(repo, ['ls-files', '--', literal(pathspec)]);
  return out.split('\n').filter((f) => f && (f.endsWith('.local.md') || /(^|\/)\.brain\//.test(f)));
}

// git mv when the file is tracked, plain rename otherwise. Never overwrites: dest must not exist.
function moveFile(src, dest) {
  if (fs.existsSync(dest)) throw new Error('dest-exists');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const top = available() ? toplevel(path.dirname(src)) : null;
  if (top) {
    try {
      run(top, ['ls-files', '--error-unmatch', '--', src]);
      run(top, ['mv', '--', src, dest]);
      return dest;
    } catch {}
  }
  fs.renameSync(src, dest);
  return dest;
}

function tryRun(cwd, args) {
  try {
    return run(cwd, args) || null;
  } catch {
    return null;
  }
}

// Identity set at repo level (local config or a local include), ignoring the global one.
function localIdentity(dir) {
  const scoped = (key) => {
    const out = tryRun(dir, ['config', '--show-scope', '--get', key]);
    if (!out) return null;
    const [scope, ...value] = out.split('\t');
    return scope === 'local' || scope === 'worktree' ? value.join('\t') : null;
  };
  const name = scoped('user.name');
  const email = scoped('user.email');
  return name && email ? { name, email } : null;
}

function detectIdentity(dir, { vaultDir, home = require('node:os').homedir() } = {}) {
  if (!available()) return null;
  const start = existingDir(dir);
  if (!start) return null;
  if (toplevel(start)) {
    const id = localIdentity(start);
    if (id) return { ...id, source: 'repo' };
  }
  const { normalize } = require('./paths');
  for (let d = start; normalize(d) !== normalize(home); d = path.dirname(d)) {
    const file = path.join(d, '.gitconfig');
    if (fs.existsSync(file)) {
      const name = tryRun(d, ['config', '-f', file, '--get', 'user.name']);
      const email = tryRun(d, ['config', '-f', file, '--get', 'user.email']);
      if (name && email) {
        const includePath = vaultDir ? path.relative(path.join(vaultDir, '.git'), file).replace(/\\/g, '/') : file;
        return { name, email, source: 'gitconfig-file', includePath, file };
      }
    }
    if (path.dirname(d) === d) break;
  }
  let children = [];
  try {
    children = fs.readdirSync(start, { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(path.join(start, e.name, '.git')));
  } catch {}
  const ids = children.map((e) => localIdentity(path.join(start, e.name))).filter(Boolean);
  if (ids.length && ids.length === children.length && ids.every((i) => i.email === ids[0].email && i.name === ids[0].name)) return { ...ids[0], source: 'children' };
  // the author of the most recent commit, in the repo itself or in the newest child repo
  const repos = [toplevel(start), ...children.map((e) => path.join(start, e.name))].filter(Boolean);
  let last = null;
  for (const r of repos) {
    const out = tryRun(r, ['log', '-1', '--format=%ct%x09%an%x09%ae']);
    if (!out) continue;
    const [ts, name, email] = out.split('\t');
    if (name && email && (!last || Number(ts) > last.ts)) last = { ts: Number(ts), name, email };
  }
  if (last) return { name: last.name, email: last.email, source: 'log' };
  const name = tryRun(start, ['config', '--global', '--get', 'user.name']);
  const email = tryRun(start, ['config', '--global', '--get', 'user.email']);
  return name && email ? { name, email, source: 'global' } : null;
}

module.exports = { run, runRaw, available, toplevel, init, excludeInParent, commitPath, trackedPrivate, moveFile, detectIdentity, localIdentity, identityArgs, literal };
