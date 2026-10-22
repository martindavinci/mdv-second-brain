'use strict';
const fs = require('node:fs');
const path = require('node:path');

const stateDirOf = (vault) => path.join(vault, '.brain', 'state');

function markCliWrite(vault, sid, now = new Date()) {
  if (!sid) return;
  fs.mkdirSync(stateDirOf(vault), { recursive: true });
  fs.writeFileSync(path.join(stateDirOf(vault), `${sid}.cli`), now.toISOString());
}

function cliLastWrite(vault, sid) {
  if (!sid) return null;
  try {
    const d = new Date(fs.readFileSync(path.join(stateDirOf(vault), `${sid}.cli`), 'utf8').trim());
    return isNaN(d) ? null : d;
  } catch {
    return null;
  }
}

module.exports = { stateDirOf, markCliWrite, cliLastWrite };
