'use strict';
// The attention feed (format v1, docs/feed-format.md): what waits for the user in one workspace, as one JSON file
// another app can read. One file per workspace (<dir>/brain-<workspace>.json), written whole (temp file + rename) and
// only when something other than its generation time changed.
const fs = require('node:fs');
const path = require('node:path');
const { visible, writeAtomic } = require('./attention');

const FORMAT = 'attention-feed';
const VERSION = 1;
const SOURCE = 'mdv-second-brain';

const publicItem = (i) => ({ id: i.id, kind: i.kind, severity: i.severity, title: i.title, detail: i.detail || '', project: i.project || null, firstSeen: i.firstSeen, actions: i.actions || [] });

function publicRemote(r = {}) {
  return { ok: !!r.ok, ...(r.reason ? { reason: r.reason } : {}), ...(r.at ? { at: r.at } : {}) };
}

function build(cache, ws, now = new Date()) {
  return {
    format: FORMAT,
    version: VERSION,
    source: SOURCE,
    workspace: ws,
    generatedAt: now.toISOString(),
    remote: publicRemote(cache && cache.remote),
    items: visible(cache, now).map(publicItem),
  };
}

const fileFor = (dir, ws) => path.join(dir, `brain-${ws}.json`);
const withoutTime = (f) => JSON.stringify({ ...f, generatedAt: null });

// The folder belongs to the reading app: a missing one is an error, never created here.
function write(dir, ws, obj) {
  let isDir = false;
  try {
    isDir = fs.statSync(dir).isDirectory();
  } catch {}
  if (!isDir) throw Object.assign(new Error(`feed folder missing: ${dir}`), { code: 'ENOENT' });
  const file = fileFor(dir, ws);
  let old = null;
  try {
    old = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}
  if (old && withoutTime(old) === withoutTime(obj)) return { written: false, file };
  writeAtomic(file, JSON.stringify(obj, null, 2) + '\n');
  return { written: true, file };
}

module.exports = { FORMAT, VERSION, SOURCE, build, write, fileFor };
