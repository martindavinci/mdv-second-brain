'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PENDING_TTL_MS = 10 * 60000;

const stateDirOf = (vault) => path.join(vault, '.brain', 'state');
const safeSid = (sid) => String(sid).replace(/[^A-Za-z0-9_-]/g, '_');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

// --- CLI write stamps (per session, never shared) ---

function markCliWrite(vault, sid, now = new Date()) {
  if (!sid) return;
  fs.mkdirSync(stateDirOf(vault), { recursive: true });
  fs.writeFileSync(path.join(stateDirOf(vault), `${safeSid(sid)}.cli`), now.toISOString());
}

function cliLastWrite(vault, sid) {
  if (!sid) return null;
  try {
    const d = new Date(fs.readFileSync(path.join(stateDirOf(vault), `${safeSid(sid)}.cli`), 'utf8').trim());
    return isNaN(d) ? null : d;
  } catch {
    return null;
  }
}

// --- per-vault session state ---

const stateFile = (vault, sid) => path.join(stateDirOf(vault), `${safeSid(sid)}.json`);

function load(vault, sid) {
  return readJson(stateFile(vault, sid));
}

function save(vault, sid, s) {
  writeJson(stateFile(vault, sid), s);
  return s;
}

function fresh(sid, workspace, now) {
  return { sessionId: sid, workspace, startedAt: now.toISOString(), turnStartedAt: null, dirtyAt: null, flushedAt: null, lastBlockAt: null, dailyFile: null, announced: false, captured: [] };
}

function update(vault, sid, workspace, now, fn) {
  const s = load(vault, sid) || fresh(sid, workspace, now);
  fn(s);
  return save(vault, sid, s);
}

const markDirty = (vault, sid, now, workspace) => update(vault, sid, workspace, now, (s) => (s.dirtyAt = now.toISOString()));
const markFlushed = (vault, sid, now, workspace) => update(vault, sid, workspace, now, (s) => (s.flushedAt = now.toISOString()));

const ms = (v) => (v === null || v === undefined || v === '' ? null : new Date(v).getTime());

function shouldBlock(s, cliLast, now, thresholdMin = 0) {
  if (!s || !ms(s.dirtyAt)) return false;
  const flushes = [ms(s.flushedAt), ms(cliLast)].filter((x) => x !== null);
  const lastFlush = flushes.length ? Math.max(...flushes) : null;
  if (lastFlush !== null && lastFlush >= ms(s.dirtyAt)) return false;
  const blocked = ms(s.lastBlockAt);
  const turn = ms(s.turnStartedAt);
  if (blocked !== null && (turn === null || blocked >= turn)) return false;
  return ms(now) - (lastFlush ?? ms(s.startedAt) ?? ms(now)) >= thresholdMin * 60000;
}

// --- session index: which workspaces a session is bound to (outside every vault) ---

const indexFile = (stateDir, sid) => path.join(stateDir, 'sessions', `${safeSid(sid)}.json`);

function readIndex(stateDir, sid) {
  return readJson(indexFile(stateDir, sid));
}

function writeIndex(stateDir, sid, idx) {
  writeJson(indexFile(stateDir, sid), idx);
  return idx;
}

function bindSession(stateDir, sid, ws, { attached = false, contextSent = false } = {}) {
  const old = readIndex(stateDir, sid) || {};
  const workspaces = [...new Set([ws, ...(old.workspaces || [])])];
  // current = workspace whose instructions the model saw last (transitions are announced against it)
  return writeIndex(stateDir, sid, { origin: ws, current: ws, workspaces, attached, detached: false, inactive: false, contextSent });
}

function detachSession(stateDir, sid) {
  const old = readIndex(stateDir, sid) || { origin: null, workspaces: [] };
  return writeIndex(stateDir, sid, { ...old, detached: true });
}

function addWorkspace(stateDir, sid, ws) {
  const idx = readIndex(stateDir, sid);
  if (!idx || idx.workspaces.includes(ws)) return idx;
  idx.workspaces.push(ws);
  return writeIndex(stateDir, sid, idx);
}

// --- pending activation, for when the skill could not learn the session id ---

const pendingFile = (stateDir, cwd) => {
  const { normalize } = require('./paths');
  return path.join(stateDir, 'pending', crypto.createHash('sha1').update(normalize(cwd)).digest('hex') + '.json');
};

function writePending(stateDir, cwd, ws, now = new Date()) {
  writeJson(pendingFile(stateDir, cwd), { ws, at: now.toISOString() });
}

function consumePending(stateDir, cwd, now = new Date()) {
  const file = pendingFile(stateDir, cwd);
  const p = readJson(file);
  if (!p) return null;
  fs.rmSync(file, { force: true });
  return ms(now) - ms(p.at) <= PENDING_TTL_MS ? p.ws : null;
}

// Which workspace a session writes to, or null when the plugin must stay inert.
function activeWorkspace(cfg, sid, cwd, { atStart = false, now = new Date(), stateDir }) {
  const { vaultPathFor } = require('./config');
  const pick = (name) => (name && cfg.workspaces[name] ? { name, vault: vaultPathFor(cfg, name), index: readIndex(stateDir, sid) } : null);
  const idx = readIndex(stateDir, sid);
  if (idx && idx.detached) return null;
  // an explicit "only this chat" binding holds wherever the chat is
  if (idx && idx.attached) return pick(idx.origin);
  const pendingWs = fs.existsSync(path.join(stateDir, 'pending')) ? consumePending(stateDir, cwd, now) : null;
  if (pendingWs && cfg.workspaces[pendingWs]) {
    bindSession(stateDir, sid, pendingWs, { attached: true, contextSent: false });
    return pick(pendingWs);
  }
  if (atStart) {
    // start / resume / compact: the folder decides again (a session resumed elsewhere goes inert)
    const { resolveWorkspace } = require('./resolve');
    const r = resolveWorkspace(cfg, cwd);
    if (r.status === 'mapped') {
      bindSession(stateDir, sid, r.name, { attached: false, contextSent: true });
      return pick(r.name);
    }
    if (idx && !idx.inactive) writeIndex(stateDir, sid, { ...idx, inactive: true });
    return null;
  }
  return idx && !idx.inactive ? pick(idx.origin) : null;
}

// Session files untouched for `days` (finished sessions) are removed: they are plugin state, not notes.
function prune(vault, stateDir, now = new Date(), days = 30) {
  const cutoff = ms(now) - days * 86400000;
  let removed = 0;
  for (const dir of [stateDirOf(vault), path.join(stateDir, 'sessions'), path.join(stateDir, 'pending')]) {
    let files = [];
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      const full = path.join(dir, f);
      try {
        if (fs.statSync(full).isFile() && fs.statSync(full).mtimeMs < cutoff) {
          fs.rmSync(full, { force: true });
          removed++;
        }
      } catch {}
    }
  }
  return removed;
}

module.exports = {
  prune,
  PENDING_TTL_MS, stateDirOf, markCliWrite, cliLastWrite, load, save, fresh, update, markDirty, markFlushed, shouldBlock,
  readIndex, writeIndex, bindSession, detachSession, addWorkspace, writePending, consumePending, activeWorkspace,
};
