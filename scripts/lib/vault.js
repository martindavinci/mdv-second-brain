'use strict';
const fs = require('node:fs');
const path = require('node:path');
const git = require('./git');
const templates = require('./templates');
const { normalize, isInside } = require('./paths');
const { vaultPathFor, boardPathFor, saveConfig } = require('./config');

const GITIGNORE = ['.brain/', '*.local.md', '.obsidian/workspace*.json', '.obsidian/cache', '.trash/', '.DS_Store', 'Thumbs.db'].join('\n') + '\n';

const GITATTRIBUTES = [
  '* text=auto eol=lf',
  '*.md diff=markdown',
  ...['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'pdf', 'zip', '7z', 'mp3', 'mp4', 'mov', 'wav', 'woff', 'woff2', 'ttf', 'otf'].map((e) => `*.${e} binary`),
].join('\n') + '\n';

const DIRS = ['00_Inbox', '00_Inbox/Daily', '10_Notes', '10_Notes/Features', '10_Notes/Tasks', '10_Notes/Issues', '20_Projects', '80_Assets', '90_Archive', '90_Archive/Daily', '.brain/state'];
const ROOT_FILES = ['AGENTS.md', 'WORKFLOW.md', 'TOOLS.md', 'DECISIONS.md', 'MEMORY.md', 'Home.md'];

// Replaced by board.emptyBoard() once the board module exists.
let emptyBoard = () => '---\n\nkanban-plugin: board\n\n---\n\n## ToDo\n\n## In Progress\n\n## Completed\n\n## Discarded\n\n%% kanban:settings\n```\n{"kanban-plugin":"board"}\n```\n%%\n';
try {
  emptyBoard = require('./board').emptyBoard;
} catch {}

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

function ensureVault(cfg, name, { language, cfgFile } = {}) {
  let lang = languageFor(cfg, name);
  if (!lang) {
    if (!language) throw new Error('language-required');
    lang = language;
    cfg.workspaces[name] = { paths: [], ...wsOf(cfg, name), language };
    saveConfig(cfg, cfgFile);
  }
  const vault = vaultPathFor(cfg, name);
  const created = !fs.existsSync(path.join(vault, 'Home.md'));
  for (const d of DIRS) fs.mkdirSync(path.join(vault, d), { recursive: true });
  writeIfMissing(path.join(vault, '.gitignore'), GITIGNORE);
  writeIfMissing(path.join(vault, '.gitattributes'), GITATTRIBUTES);
  for (const f of ROOT_FILES) writeIfMissing(path.join(vault, f), templates.fill(templates.load(lang, f), { workspace: name }));
  writeIfMissing(path.join(vault, boardPathFor(cfg, name)), emptyBoard());
  setupGit(cfg, name, vault);
  return { vault, created };
}

function gitModeFor(cfg, name) {
  const mode = (wsOf(cfg, name).git && wsOf(cfg, name).git.mode) || (cfg.git && cfg.git.mode) || 'per-workspace';
  if (mode === 'single' && !isInside(vaultPathFor(cfg, name), cfg.root)) return 'per-workspace';
  return mode;
}

const samePath = (a, b) => a && b && normalize(a) === normalize(b);

function setupGit(cfg, name, vaultDir) {
  if (!git.available()) return;
  const mode = gitModeFor(cfg, name);
  if (mode === 'none' || mode === 'host') return;
  const repo = mode === 'single' ? cfg.root : vaultDir;
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
  for (const [key, value] of Object.entries(conf)) {
    let current = null;
    try {
      current = git.run(repo, ['config', '--local', '--get', key]);
    } catch {}
    if (current !== String(value)) {
      git.run(repo, ['config', '--local', key, String(value)]);
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
  if (mode === 'single') return { repo: cfg.root, pathspec: path.relative(cfg.root, vaultDir).replace(/\\/g, '/') || '.' };
  return { repo: vaultDir, pathspec: '.' };
}

module.exports = { GITIGNORE, GITATTRIBUTES, DIRS, ROOT_FILES, languageFor, ensureVault, gitModeFor, setupGit, applyGitConfig, repoFor };
