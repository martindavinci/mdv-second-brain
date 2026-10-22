'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function expandHome(p) {
  if (typeof p !== 'string') return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

// Comparison form only: never write it to disk or show it to the user.
function normalize(p) {
  let s = path.resolve(expandHome(p)).replace(/\\/g, '/');
  if (s.length > 1 && s.endsWith('/') && !/^[A-Za-z]:\/$/.test(s)) s = s.slice(0, -1);
  return process.platform === 'win32' ? s.toLowerCase() : s;
}

function isInside(child, parent) {
  const c = normalize(child);
  const p = normalize(parent);
  if (c === p) return true;
  return c.startsWith(p.endsWith('/') ? p : p + '/');
}

function defaultRoot(home = os.homedir()) {
  const docs = path.join(home, 'Documents');
  return fs.existsSync(docs) ? path.join(docs, 'SecondBrain') : path.join(home, 'SecondBrain');
}

module.exports = { expandHome, normalize, isInside, defaultRoot };
