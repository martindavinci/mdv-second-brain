'use strict';
const fs = require('node:fs');
const os = require('node:os');
const { join, dirname } = require('node:path');
const { defaults, loadConfig, saveConfig } = require('../scripts/lib/config');
const vault = require('../scripts/lib/vault');

const read = (f) => fs.readFileSync(f, 'utf8');
const write = (f, s) => {
  fs.mkdirSync(dirname(f), { recursive: true });
  fs.writeFileSync(f, s);
};

function makeVault({ gitMode = 'none', lang = 'en', name = 'w', ws = {} } = {}) {
  const t = fs.mkdtempSync(join(os.tmpdir(), 'sb-'));
  const cfgFile = join(t, 'cfg', 'config.json');
  const cfg = defaults();
  cfg.root = join(t, 'root');
  cfg.workspaces[name] = { paths: [join(t, 'code')], language: lang, git: { mode: gitMode }, ...ws };
  saveConfig(cfg, cfgFile);
  const loaded = loadConfig(cfgFile);
  const { vault: v } = vault.ensureVault(loaded, name, { cfgFile });
  fs.mkdirSync(join(t, 'code'), { recursive: true });
  const ctx = { vault: v, boardFile: join(v, '00_Inbox', 'Plan.md'), lang };
  return { t, cfgFile, cfg: loaded, vault: v, ctx, board: ctx.boardFile, code: join(t, 'code') };
}

function daysAgo(n, from = new Date()) {
  const d = new Date(from);
  d.setDate(d.getDate() - n);
  return d;
}

function ymd(d) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function io() {
  const out = [];
  const err = [];
  return { out, err, stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) }, text: () => out.join(''), errText: () => err.join('') };
}

// Every git command in the block sees the repos as another account's, like the Codex sandbox user does. git's own
// config is left out: a safe.directory=* in it (the macOS runner's ~/.gitconfig, many machines) trusts every repo.
async function asOtherAccount(fn) {
  const keys = ['GIT_TEST_ASSUME_DIFFERENT_OWNER', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM'];
  const saved = keys.map((k) => process.env[k]);
  const empty = join(fs.mkdtempSync(join(os.tmpdir(), 'sb-gitcfg-')), 'gitconfig');
  fs.writeFileSync(empty, '');
  Object.assign(process.env, { GIT_TEST_ASSUME_DIFFERENT_OWNER: '1', GIT_CONFIG_GLOBAL: empty, GIT_CONFIG_NOSYSTEM: '1' });
  try {
    return await fn();
  } finally {
    keys.forEach((k, i) => (saved[i] === undefined ? delete process.env[k] : (process.env[k] = saved[i])));
  }
}

module.exports = { read, write, makeVault, daysAgo, ymd, io, asOtherAccount };
