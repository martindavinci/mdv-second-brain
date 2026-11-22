'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { expandHome, defaultRoot } = require('./paths');
const { LOCAL_VAULT, localConfigFile, projectOfLocal } = require('./locate');

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

function configPath(env = process.env) {
  return env.MDV_SECOND_BRAIN_CONFIG || path.join(os.homedir(), '.config', 'mdv-second-brain', 'config.json');
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
  const cfg = expandPaths(deepMerge(defaults(), data));
  return cfg.local ? deriveLocal(cfg, file) : cfg;
}

// Project mode: the folder and the vault come from where the config lives, so the project can move.
function deriveLocal(cfg, file) {
  const proj = projectOfLocal(file);
  cfg.root = proj;
  for (const ws of Object.values(cfg.workspaces)) {
    ws.paths = [proj];
    ws.vault = path.join(proj, LOCAL_VAULT);
  }
  return cfg;
}

function withoutDerived(cfg) {
  if (!cfg.local) return cfg;
  const c = JSON.parse(JSON.stringify(cfg));
  delete c.root;
  for (const ws of Object.values(c.workspaces || {})) {
    delete ws.paths;
    delete ws.vault;
  }
  return c;
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
  const own = diffDefaults(withoutDerived(cfg), defaults()) || {};
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

const DEFAULT_REMOTE_TTL_HOURS = 6;

// `workspaces.<name>.attention`: { outputs: [{ type: 'feed', dir: '<absolute folder>' }], remoteTtlHours: 6 }.
// Checked where it is used, so a mistake there never stops the rest of the brain.
function attentionFor(cfg, name) {
  const a = ((cfg.workspaces || {})[name] || {}).attention;
  const bad = (detail) => Object.assign(new Error('invalid-attention'), { ws: name, detail });
  if (a === undefined) return { outputs: [], remoteTtlHours: DEFAULT_REMOTE_TTL_HOURS };
  if (!isPlainObject(a)) throw bad('attention must be an object');
  const extra = Object.keys(a).filter((k) => k !== 'outputs' && k !== 'remoteTtlHours');
  if (extra.length) throw bad(`unknown key ${extra[0]} (use outputs, remoteTtlHours)`);
  if (a.outputs !== undefined && !Array.isArray(a.outputs)) throw bad('outputs must be a list');
  const outputs = (a.outputs || []).map((o, i) => {
    const at = `outputs[${i}]`;
    if (!isPlainObject(o) || o.type !== 'feed') throw bad(`${at}.type must be "feed"`);
    const keys = Object.keys(o).filter((k) => k !== 'type' && k !== 'dir');
    if (keys.length) throw bad(`${at}: unknown key ${keys[0]} (a feed has type and dir)`);
    const dir = typeof o.dir === 'string' ? expandHome(o.dir.trim()) : '';
    if (!dir || !path.isAbsolute(dir)) throw bad(`${at}.dir must be an absolute folder`);
    return { type: 'feed', dir };
  });
  const ttl = a.remoteTtlHours === undefined ? DEFAULT_REMOTE_TTL_HOURS : a.remoteTtlHours;
  if (typeof ttl !== 'number' || !Number.isFinite(ttl) || ttl < 0) throw bad('remoteTtlHours must be a number of hours, 0 or more');
  return { outputs, remoteTtlHours: ttl };
}

function assertWorkspaceName(name) {
  if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/i.test(name)) throw new Error('invalid-workspace-name');
}

module.exports = {
  DEFAULT_BOARD, defaults, configPath, configDir, stateDir, loadConfig, saveConfig, localConfigFile,
  vaultPathFor, boardPathFor, assertWorkspaceName, attentionFor, DEFAULT_REMOTE_TTL_HOURS,
};
