'use strict';
// Which config a folder belongs to: a project's own (<project>/SecondBrain/.brain/local/config.json) or the global one.
// Node built-ins only until both exist: the hooks run this on every event.
const fs = require('node:fs');
const path = require('node:path');

const LOCAL_VAULT = 'SecondBrain';
const LOCAL_FILE = path.join(LOCAL_VAULT, '.brain', 'local', 'config.json');
const MAX_DEPTH = 32;

const localConfigFile = (projectDir) => path.join(projectDir, LOCAL_FILE);
const isLocalFile = (file) => !!file && path.resolve(file).endsWith(path.sep + LOCAL_FILE);
const projectOfLocal = (file) => path.dirname(path.dirname(path.dirname(path.dirname(path.resolve(file)))));

function findLocal(start) {
  if (!start) return null;
  let dir = path.resolve(start);
  for (let i = 0; i < MAX_DEPTH; i++) {
    const f = localConfigFile(dir);
    if (fs.existsSync(f)) return f;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  return null;
}

// The nearest wins: a project inside a wider workspace uses its own brain, a workspace mapped inside the project
// wins in its folder.
function locate(cwd, { globalFile } = {}) {
  const local = findLocal(cwd);
  const hasGlobal = !!globalFile && fs.existsSync(globalFile);
  if (!local) return hasGlobal ? globalFile : null;
  if (!hasGlobal) return local;
  const { loadConfig } = require('./config');
  const { resolveWorkspace } = require('./resolve');
  const { isInside, normalize } = require('./paths');
  let r;
  try {
    r = resolveWorkspace(loadConfig(globalFile), path.resolve(cwd));
  } catch {
    return local;
  }
  const proj = projectOfLocal(local);
  if (r.status === 'mapped' && r.via === 'path' && isInside(r.mappedDir, proj) && normalize(r.mappedDir) !== normalize(proj)) return globalFile;
  return local;
}

module.exports = { LOCAL_VAULT, localConfigFile, isLocalFile, projectOfLocal, findLocal, locate };
