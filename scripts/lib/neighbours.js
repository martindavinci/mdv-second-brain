'use strict';
// Other vault tooling that also injects a manual at session start: Claude Code runs every plugin's and every
// settings file's SessionStart hooks, so the model may get two descriptions of the same vault. Found, never touched.
// Every read is defensive: a missing or broken file means nothing found.
const fs = require('node:fs');
const path = require('node:path');
const { isInside } = require('./paths');

const VAULTISH = /obsidian|second[-_ ]?brain|\bvault/i;
const OWN = /mdv-second-brain/i;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function sessionStartCommands(hooks) {
  const out = [];
  const list = hooks && Array.isArray(hooks.SessionStart) ? hooks.SessionStart : [];
  for (const group of list) for (const h of (group && Array.isArray(group.hooks) ? group.hooks : [])) if (h && typeof h.command === 'string') out.push(h.command);
  return out;
}

// The project's settings: the nearest folder above cwd with a .claude/settings(.local).json, the home one excluded.
function projectSettings(home, cwd) {
  for (let d = path.resolve(cwd); ; d = path.dirname(d)) {
    if (path.resolve(d) !== path.resolve(home)) {
      const files = ['settings.json', 'settings.local.json'].map((f) => path.join(d, '.claude', f)).filter((f) => fs.existsSync(f));
      if (files.length) return files;
    }
    if (path.dirname(d) === d) return [];
  }
}

const short = (s) => (s.length > 60 ? s.slice(0, 59) + '…' : s);

function find({ home, cwd }) {
  const userFile = path.join(home, '.claude', 'settings.json');
  const files = [userFile, ...projectSettings(home, cwd)];
  const settings = files.map((f) => ({ f, j: readJson(f) || {} }));
  // user, then project, then local: the narrower file wins
  const enabled = {};
  for (const { j } of settings) if (j.enabledPlugins && typeof j.enabledPlugins === 'object') Object.assign(enabled, j.enabledPlugins);
  const found = [];
  for (const { f, j } of settings) {
    const label = f === userFile ? '~/.claude/settings.json' : path.relative(cwd, f).replace(/\\/g, '/') || f;
    for (const c of sessionStartCommands(j.hooks)) if (VAULTISH.test(c) && !OWN.test(c)) found.push(`${short(c)} (${label})`);
  }
  const installed = readJson(path.join(home, '.claude', 'plugins', 'installed_plugins.json'));
  const plugins = installed && typeof installed.plugins === 'object' && installed.plugins ? installed.plugins : {};
  for (const [key, installs] of Object.entries(plugins)) {
    const name = key.split('@')[0];
    if (OWN.test(name) || enabled[key] === false) continue;
    for (const i of Array.isArray(installs) ? installs : []) {
      if (!i || typeof i.installPath !== 'string') continue;
      if (i.scope && i.scope !== 'user' && !(i.projectPath && isInside(cwd, i.projectPath))) continue;
      const cmds = sessionStartCommands((readJson(path.join(i.installPath, 'hooks', 'hooks.json')) || {}).hooks);
      if (cmds.length && (VAULTISH.test(name) || cmds.some((c) => VAULTISH.test(c)))) {
        found.push(`${name} (plugin)`);
        break;
      }
    }
  }
  // plugins first: they are what the user installed by name
  return [...found.filter((x) => x.endsWith('(plugin)')), ...found.filter((x) => !x.endsWith('(plugin)'))];
}

module.exports = { find };
