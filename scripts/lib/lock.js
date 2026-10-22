'use strict';
// One writer at a time per vault (two sessions, or a hook and the CLI): <vault>/.brain/lock.
const fs = require('node:fs');
const path = require('node:path');
const { normalize } = require('./paths');

const held = new Map();

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Re-entrant within a process; a lock older than staleMs (crashed writer) is broken.
function withLock(vault, fn, { timeoutMs = 5000, staleMs = 30000 } = {}) {
  const key = normalize(vault);
  if (held.get(key)) {
    held.set(key, held.get(key) + 1);
    try {
      return fn();
    } finally {
      held.set(key, held.get(key) - 1);
    }
  }
  const file = path.join(vault, '.brain', 'lock');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const start = Date.now();
  for (;;) {
    try {
      fs.writeFileSync(file, String(process.pid), { flag: 'wx' });
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        if (Date.now() - fs.statSync(file).mtimeMs > staleMs) {
          fs.rmSync(file, { force: true });
          continue;
        }
      } catch {}
      if (Date.now() - start > timeoutMs) throw new Error('vault-locked');
      sleep(25);
    }
  }
  held.set(key, 1);
  try {
    return fn();
  } finally {
    held.delete(key);
    fs.rmSync(file, { force: true });
  }
}

module.exports = { withLock };
