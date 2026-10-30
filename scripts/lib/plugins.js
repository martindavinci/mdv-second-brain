'use strict';
// Obsidian community plugins, fetched the way Obsidian does: the repo from the community registry, the files from the
// release its manifest names.
const fs = require('node:fs');
const path = require('node:path');

const REGISTRY = 'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json';
// the vault's own notes render with these: Home.md has a dataview block, the board is a Kanban board
const NEEDED = ['dataview', 'obsidian-kanban'];
const DEFAULTS = [...NEEDED, 'homepage'];
const FILES = ['main.js', 'styles.css'];
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const TIMEOUT_MS = 30000;

const pluginsDir = (vault) => path.join(vault, '.obsidian', 'plugins');
const listFile = (vault) => path.join(vault, '.obsidian', 'community-plugins.json');
const isInstalled = (vault, id) => fs.existsSync(path.join(pluginsDir(vault), id, 'manifest.json'));

function enabledList(vault) {
  let text;
  try {
    text = fs.readFileSync(listFile(vault), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  let list;
  try {
    list = JSON.parse(text);
  } catch {}
  if (!Array.isArray(list)) throw new Error('bad-community-plugins');
  return list;
}

function missing(vault, ids = NEEDED) {
  let on;
  try {
    on = enabledList(vault);
  } catch {
    on = [];
  }
  return ids.filter((id) => !isInstalled(vault, id) || !on.includes(id));
}

function plan(vault, ids) {
  const on = enabledList(vault);
  const p = { download: [], enable: [], present: [], invalid: [] };
  for (const id of [...new Set(ids)]) {
    if (!ID.test(id)) p.invalid.push(id);
    else if (!isInstalled(vault, id)) p.download.push(id);
    else if (!on.includes(id)) p.enable.push(id);
    else p.present.push(id);
  }
  return p;
}

async function get(fetch, url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) {
    const e = new Error(`HTTP ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return Buffer.from(await res.arrayBuffer());
}

const parseManifest = (buf, where) => {
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw new Error(`${where} is not JSON`);
  }
};

// As Obsidian does: the version comes from the repo's manifest.json, the files from the release tagged with it (the
// latest release may be a beta). In memory first: a plugin is written only once all of it arrived and its id matches.
async function download(fetch, repo, id) {
  let version;
  try {
    version = parseManifest(await get(fetch, `https://raw.githubusercontent.com/${repo}/HEAD/manifest.json`), 'the repo manifest.json').version;
  } catch (e) {
    throw new Error(e.status ? `repo manifest.json: ${e.message}` : e.message);
  }
  if (typeof version !== 'string' || !/^[\w.+-]+$/.test(version)) throw new Error('the repo manifest.json has no version');
  const base = `https://github.com/${repo}/releases/download/${version}/`;
  const files = {};
  for (const name of ['manifest.json', ...FILES]) {
    try {
      files[name] = await get(fetch, base + name);
    } catch (e) {
      if (name === 'styles.css' && e.status === 404) continue;
      throw new Error(`${name}: ${e.message}`);
    }
  }
  const manifest = parseManifest(files['manifest.json'], 'manifest.json');
  if (manifest.id !== id) throw new Error(`manifest id is ${manifest.id}`);
  return files;
}

async function fetchAll(fetch, ids) {
  const staged = [];
  const failed = [];
  if (!ids.length) return { staged, failed };
  let registry;
  try {
    registry = JSON.parse((await get(fetch, REGISTRY)).toString('utf8'));
  } catch (e) {
    return { staged, failed: ids.map((id) => ({ id, reason: `registry unreachable: ${e.message}` })) };
  }
  for (const id of ids) {
    const entry = Array.isArray(registry) && registry.find((p) => p && p.id === id);
    if (!entry || typeof entry.repo !== 'string') {
      failed.push({ id, reason: 'not in the community registry' });
      continue;
    }
    try {
      staged.push({ id, files: await download(fetch, entry.repo, id) });
    } catch (e) {
      failed.push({ id, reason: e.message });
    }
  }
  return { staged, failed };
}

// Files next to an existing data.json (the user's settings) are added, never replaced; the manifest goes last, so a
// plugin counts as installed only once its code is there.
function write(vault, staged, enable) {
  for (const { id, files } of staged) {
    const dir = path.join(pluginsDir(vault), id);
    fs.mkdirSync(dir, { recursive: true });
    for (const name of [...FILES, 'manifest.json']) if (files[name]) fs.writeFileSync(path.join(dir, name), files[name]);
  }
  const add = [...staged.map((s) => s.id), ...enable];
  if (!add.length) return;
  const on = enabledList(vault);
  fs.mkdirSync(path.dirname(listFile(vault)), { recursive: true });
  fs.writeFileSync(listFile(vault), JSON.stringify([...on, ...add.filter((id) => !on.includes(id))], null, 2));
}

// lock: runs the write part, so two sessions never interleave on the vault (the downloads happen outside it).
async function install(vault, ids, { fetch = globalThis.fetch, lock = (f) => f() } = {}) {
  const p = plan(vault, ids);
  const { staged, failed } = await fetchAll(fetch, p.download);
  lock(() => write(vault, staged, p.enable));
  return {
    installed: staged.map((s) => s.id),
    enabled: p.enable,
    present: p.present,
    failed: [...p.invalid.map((id) => ({ id, reason: 'invalid plugin id' })), ...failed],
  };
}

module.exports = { REGISTRY, NEEDED, DEFAULTS, missing, plan, install };
