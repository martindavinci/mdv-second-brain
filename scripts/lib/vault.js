'use strict';
const fs = require('node:fs');
const path = require('node:path');
const git = require('./git');
const templates = require('./templates');
const { emptyBoard } = require('./board');
const { normalize, isInside } = require('./paths');
const { vaultPathFor, boardPathFor, saveConfig } = require('./config');

const GITIGNORE = [
  '# Second brain: session state and private notes',
  '.brain/',
  '*.local.md',
  '',
  '# Obsidian local state (machine/user specific)',
  '.obsidian/workspace.json',
  '.obsidian/workspace-mobile.json',
  '.obsidian/cache/',
  '.obsidian/.trash/',
  '.trash/',
  '',
  '# Plugin local data (often noisy/user-specific)',
  '.obsidian/plugins/*/data.json',
  '',
  '# OS files',
  '.DS_Store',
  'Thumbs.db',
].join('\n') + '\n';

const GITATTRIBUTES = [
  '* text=auto eol=lf',
  '*.md diff=markdown',
  ...['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'pdf', 'zip', '7z', 'mp3', 'mp4', 'mov', 'wav', 'woff', 'woff2', 'ttf', 'otf'].map((e) => `*.${e} binary`),
].join('\n') + '\n';

const DIRS = ['00_Inbox', '00_Inbox/Daily', '10_Notes', '10_Notes/Features', '10_Notes/Tasks', '10_Notes/Issues', '20_Projects', '80_Assets', '90_Archive', '90_Archive/Daily', '.brain/state'];
const ROOT_FILES = ['AGENTS.md', 'WORKFLOW.md', 'TOOLS.md', 'DECISIONS.md', 'MEMORY.md', 'Home.md'];


const wsOf = (cfg, name) => cfg.workspaces[name] || {};

function languageFor(cfg, name) {
  const own = wsOf(cfg, name).language;
  if (own && own !== 'auto') return own;
  const def = cfg.defaults && cfg.defaults.language;
  return def && def !== 'auto' ? def : null;
}

function writeIfMissing(file, content) {
  if (fs.existsSync(file)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return true;
}

// An existing .gitignore (adopted vault, custom folder) keeps its lines and gains the missing rules, without the
// comments that group them in a new vault.
function ensureGitignore(file) {
  if (writeIfMissing(file, GITIGNORE)) return;
  const text = fs.readFileSync(file, 'utf8');
  const have = new Set(text.split(/\r?\n/).map((l) => l.trim()));
  const missing = GITIGNORE.split('\n').filter((l) => l && !l.startsWith('#') && !have.has(l));
  if (missing.length) fs.writeFileSync(file, text + (text && !text.endsWith('\n') ? '\n' : '') + missing.join('\n') + '\n');
}

// repair: also redo the structural part (folders, .gitignore lines, board, git) of a vault already born.
function ensureVault(cfg, name, { language, cfgFile, repair = false } = {}) {
  let lang = languageFor(cfg, name);
  if (!lang) {
    if (!language) throw new Error('language-required');
    lang = language;
    cfg.workspaces[name] = { paths: [], ...wsOf(cfg, name), language };
    saveConfig(cfg, cfgFile);
  }
  const vault = vaultPathFor(cfg, name);
  const marker = path.join(vault, '.brain', 'initialized');
  // after birth the vault belongs to the user: hooks only check the marker (one stat), nothing is re-created
  if (fs.existsSync(marker) && !repair) return { vault, created: false };
  const born = fs.existsSync(marker);
  const created = !born && !fs.existsSync(path.join(vault, 'Home.md'));
  for (const d of DIRS) fs.mkdirSync(path.join(vault, d), { recursive: true });
  ensureGitignore(path.join(vault, '.gitignore'));
  writeIfMissing(path.join(vault, '.gitattributes'), GITATTRIBUTES);
  if (!born) for (const f of ROOT_FILES) writeIfMissing(path.join(vault, f), templates.fill(templates.load(lang, f), { workspace: name }));
  writeIfMissing(path.join(vault, boardPathFor(cfg, name)), emptyBoard());
  setupGit(cfg, name, vault);
  fs.writeFileSync(marker, new Date().toISOString() + '\n');
  return { vault, created };
}

// Real path, following junctions/symlinks of the part that exists.
function realish(p) {
  let head = path.resolve(p);
  const tail = [];
  while (!fs.existsSync(head)) {
    const up = path.dirname(head);
    if (up === head) break;
    tail.unshift(path.basename(head));
    head = up;
  }
  try {
    head = fs.realpathSync.native(head);
  } catch {}
  return path.join(head, ...tail);
}

// Two workspaces never share a vault, and no vault lives inside another one.
function assertNoOverlap(cfg, name, vaultDir) {
  const mine = realish(vaultDir);
  for (const other of Object.keys(cfg.workspaces || {})) {
    if (other === name) continue;
    const theirs = realish(vaultPathFor(cfg, other));
    if (isInside(mine, theirs) || isInside(theirs, mine)) {
      const e = new Error('vault-overlap');
      e.other = other;
      throw e;
    }
  }
}

function gitModeFor(cfg, name) {
  const mode = (wsOf(cfg, name).git && wsOf(cfg, name).git.mode) || (cfg.git && cfg.git.mode) || 'per-workspace';
  if (mode === 'single' && !isInside(vaultPathFor(cfg, name), cfg.root)) return 'per-workspace';
  return mode;
}

const samePath = (a, b) => a && b && normalize(a) === normalize(b);

// The vault's own repo (per-workspace or single), trusted even when another account owns it (see git.trust); a host
// repo is the user's project and keeps git's ownership check.
function ownRepo(cfg, name, vaultDir) {
  const repo = gitModeFor(cfg, name) === 'single' ? cfg.root : vaultDir;
  git.trust(repo);
  return repo;
}

function setupGit(cfg, name, vaultDir) {
  const mode = gitModeFor(cfg, name);
  if (mode === 'none' || mode === 'host') return;
  if (!git.available()) return;
  const repo = ownRepo(cfg, name, vaultDir);
  const top = git.toplevel(repo);
  if (!samePath(top, repo)) {
    git.init(repo);
    if (top) git.excludeInParent(top, repo);
  }
  applyGitConfig(cfg, name, repo);
}

function applyGitConfig(cfg, name, repo) {
  const changed = [];
  const conf = (wsOf(cfg, name).git && wsOf(cfg, name).git.config) || {};
  // only the vault's own repo is configured; shared repos (single, host) get the identity per commit
  if (gitModeFor(cfg, name) !== 'per-workspace') return changed;
  const get = (args) => {
    try {
      return git.run(repo, args);
    } catch {
      return null;
    }
  };
  for (const [key, raw] of Object.entries(conf)) {
    const value = String(raw);
    if (key === 'include.path') {
      const all = (get(['config', '--local', '--get-all', 'include.path']) || '').split('\n').filter(Boolean);
      if (!all.includes(value)) {
        git.run(repo, ['config', '--local', '--add', 'include.path', value]);
        changed.push(key);
      }
      continue;
    }
    // effective value, includes followed
    if (get(['config', '--get', key]) !== value) {
      git.run(repo, ['config', '--local', key, value]);
      changed.push(key);
    }
  }
  return changed;
}

function repoFor(cfg, name, vaultDir) {
  const mode = gitModeFor(cfg, name);
  if (mode === 'none') return null;
  if (mode === 'host') {
    const top = git.toplevel(vaultDir);
    if (!top) return null;
    return { repo: top, pathspec: path.relative(top, vaultDir).replace(/\\/g, '/') || '.' };
  }
  const repo = ownRepo(cfg, name, vaultDir);
  return { repo, pathspec: path.relative(repo, vaultDir).replace(/\\/g, '/') || '.' };
}

module.exports = { GITIGNORE, GITATTRIBUTES, DIRS, ROOT_FILES, languageFor, ensureVault, gitModeFor, setupGit, applyGitConfig, repoFor, assertNoOverlap };
