'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { normalize, isInside } = require('./paths');
const { vaultPathFor } = require('./config');

function resolveWorkspace(cfg, absPath) {
  let best = null;
  for (const name of Object.keys(cfg.workspaces || {})) {
    const vault = vaultPathFor(cfg, name);
    if (isInside(absPath, vault) && (!best || normalize(vault).length > normalize(best.vault).length)) {
      best = { status: 'mapped', name, vault, via: 'vault' };
    }
  }
  if (best) return best;

  if ((cfg.ignore || []).some((dir) => isInside(absPath, dir))) return { status: 'ignored' };

  for (const [name, ws] of Object.entries(cfg.workspaces || {})) {
    for (const dir of ws.paths || []) {
      if (isInside(absPath, dir) && (!best || normalize(dir).length > normalize(best.mappedDir).length)) {
        best = { status: 'mapped', name, vault: vaultPathFor(cfg, name), via: 'path', mappedDir: dir };
      }
    }
  }
  return best || { status: 'unmapped' };
}

function projectFor(cfg, name, absPath) {
  // project mode: the folder is the project, its subfolders are not
  if (cfg.local) return null;
  const r = resolveWorkspace(cfg, absPath);
  if (r.status !== 'mapped' || r.name !== name || r.via !== 'path') return null;
  const rel = path.relative(r.mappedDir, path.resolve(absPath));
  if (!rel || rel.startsWith('..')) return null;
  const seg = rel.split(/[\\/]/)[0];
  if (!seg) return null;
  // the folder name as it is on disk (paths are case-insensitive on Windows, project names are not)
  try {
    const onDisk = fs.readdirSync(r.mappedDir).find((n) => n.toLowerCase() === seg.toLowerCase());
    if (onDisk) return onDisk;
  } catch {}
  return seg;
}

function relatedCandidates(mappedDir, project) {
  let names;
  try {
    names = fs.readdirSync(mappedDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
  const suffixed = (long, short) => long.startsWith(short + '-') && /^[A-Za-z0-9]+$/.test(long.slice(short.length + 1));
  return names.filter((n) => n !== project && (suffixed(n, project) || suffixed(project, n))).sort();
}

module.exports = { resolveWorkspace, projectFor, relatedCandidates };
