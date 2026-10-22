'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { expandHome, defaultRoot } = require('./paths');

const DEFAULT_BOARD = '00_Inbox/Plan.md';

function defaults() {
  return {
    version: 1,
    root: defaultRoot(),
    git: { mode: 'per-workspace' },
    defaults: { language: 'auto' },
    stopThresholdMinutes: 0,
    budgets: { hub: 4000, note: 8000, state: 600, log: 6000, memory: 8000, decisions: 8000, checkpoint: 600 },
    archiveAfterDays: 14,
    dailyInboxDays: 7,
    capturePatterns: ['docs/superpowers/specs/', 'docs/superpowers/plans/'],
    workspaces: {},
    ignore: [],
  };
}

function configPath() {
  return process.env.MDV_SECOND_BRAIN_CONFIG || path.join(os.homedir(), '.config', 'mdv-second-brain', 'config.json');
}

function configDir() {
  return path.dirname(configPath());
}

function stateDir() {
  return path.join(configDir(), 'state');
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = isPlainObject(v) && isPlainObject(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

function expandPaths(cfg) {
  cfg.root = expandHome(cfg.root);
  cfg.ignore = (cfg.ignore || []).map(expandHome);
  for (const ws of Object.values(cfg.workspaces || {})) {
    ws.paths = (ws.paths || []).map(expandHome);
    if (ws.vault) ws.vault = expandHome(ws.vault);
  }
  return cfg;
}

function loadConfig(file = configPath()) {
  if (!fs.existsSync(file)) return expandPaths(defaults());
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Error('invalid-config');
  }
  if (!isPlainObject(data)) throw new Error('invalid-config');
  return expandPaths(deepMerge(defaults(), data));
}

// Only what differs from the defaults: a later version's new defaults still reach this config.
function diffDefaults(value, def) {
  if (isPlainObject(value) && isPlainObject(def)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const d = k in def ? diffDefaults(v, def[k]) : v;
      if (d !== undefined) out[k] = d;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return JSON.stringify(value) === JSON.stringify(def) ? undefined : value;
}

function saveConfig(cfg, file = configPath()) {
  const own = diffDefaults(cfg, defaults()) || {};
  const out = { version: cfg.version || 1, ...own };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
}

function vaultPathFor(cfg, name) {
  const ws = cfg.workspaces[name] || {};
  return ws.vault ?? path.join(cfg.root, name);
}

function boardPathFor(cfg, name) {
  const ws = cfg.workspaces[name] || {};
  return ws.board ?? DEFAULT_BOARD;
}

function assertWorkspaceName(name) {
  if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/i.test(name)) throw new Error('invalid-workspace-name');
}

module.exports = {
  DEFAULT_BOARD, defaults, configPath, configDir, stateDir, loadConfig, saveConfig,
  vaultPathFor, boardPathFor, assertWorkspaceName,
};
