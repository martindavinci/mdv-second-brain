'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function run(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim();
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

function commitPath(repo, pathspec, message) {
  if (!available()) return { committed: false, reason: 'git-unavailable' };
  run(repo, ['add', '-A', '--', pathspec]);
  try {
    run(repo, ['diff', '--cached', '--quiet', '--', pathspec]);
    return { committed: false, reason: 'no-changes' };
  } catch {
    run(repo, ['commit', '-q', '-m', message, '--', pathspec]);
    return { committed: true };
  }
}

// git mv when the file is tracked, plain rename otherwise. Never overwrites: dest must not exist.
function moveFile(src, dest) {
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

module.exports = { run, available, toplevel, init, excludeInParent, commitPath, moveFile };
