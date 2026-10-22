'use strict';
// Which config a folder belongs to: its own or the global one. A folder owns a config in project mode
// (<project>/SecondBrain/.brain/local/config.json) or when the user kept it there (<folder>/.config/mdv-second-brain/
// config.json, `init --config-here`). Node built-ins only until both exist: the hooks run this on every event.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const LOCAL_VAULT = 'SecondBrain';
const LOCAL_FILE = path.join(LOCAL_VAULT, '.brain', 'local', 'config.json');
const FOLDER_FILE = path.join('.config', 'mdv-second-brain', 'config.json');
const MAX_DEPTH = 32;

const localConfigFile = (projectDir) => path.join(projectDir, LOCAL_FILE);
const folderConfigFile = (dir) => path.join(dir, FOLDER_FILE);
const ends = (file, tail) => !!file && path.resolve(file).endsWith(path.sep + tail);
const isLocalFile = (file) => ends(file, LOCAL_FILE) || ends(file, FOLDER_FILE);
const up = (file, n) => (n ? up(path.dirname(file), n - 1) : file);
const projectOfLocal = (file) => up(path.resolve(file), ends(file, LOCAL_FILE) ? 4 : 3);
const fold = (p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
const samePath = (a, b) => !!a && !!b && fold(a) === fold(b);

// The search stops at the home folder, whose .config/mdv-second-brain is the global config, never a folder's;
// `except` is the global config when it lives elsewhere.
function findLocal(start, { except } = {}) {
  if (!start) return null;
  const home = os.homedir();
  let dir = path.resolve(start);
  for (let i = 0; i < MAX_DEPTH; i++) {
    const atHome = samePath(dir, home);
    for (const f of atHome ? [localConfigFile(dir)] : [localConfigFile(dir), folderConfigFile(dir)]) {
      if (!samePath(f, except) && fs.existsSync(f)) return f;
    }
    if (atHome) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

// The nearest wins: a project inside a wider workspace uses its own brain, a workspace mapped inside the project
// wins in its folder.
function locate(cwd, { globalFile } = {}) {
  const local = findLocal(cwd, { except: globalFile });
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

module.exports = { LOCAL_VAULT, localConfigFile, folderConfigFile, isLocalFile, projectOfLocal, samePath, findLocal, locate };
