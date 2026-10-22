#!/usr/bin/env node
'use strict';
// Hook entry: session-start | prompt | post-tool | stop. Never throws, always exits 0, prints nothing on error.
// Only node built-ins are loaded until a config file exists: outside the second brain the cost is one stat.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const defaultConfigPath = () => process.env.MDV_SECOND_BRAIN_CONFIG || path.join(os.homedir(), '.config', 'mdv-second-brain', 'config.json');
const DEFAULT_CLI = path.join(__dirname, 'brain.js');

function json(event, text) {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });
}

function sessionContext(env, ws, sid, cwd) {
  const { cfg, now } = env;
  const { vaultPathFor, boardPathFor } = require('./lib/config');
  const vault = require('./lib/vault');
  const state = require('./lib/state');
  const daily = require('./lib/daily');
  const tasks = require('./lib/tasks');
  const { resolveWorkspace, projectFor, relatedCandidates } = require('./lib/resolve');
  const { projectName } = require('./lib/names');
  const { buildSessionContext } = require('./lib/context');

  const lang = vault.languageFor(cfg, ws);
  const v = vaultPathFor(cfg, ws);
  let dailyFile = daily.dailyPath(v, now);
  const o = { ws, vault: v, lang, cli: env.cli, sid, marker: `session:${daily.sid8(sid)}`, needsInit: !lang };
  const r = resolveWorkspace(cfg, cwd);
  const raw = r.status === 'mapped' && r.name === ws ? projectFor(cfg, ws, cwd) : null;
  o.project = raw ? projectName(raw) : null;
  if (lang) {
    vault.ensureVault(cfg, ws, { cfgFile: env.cfgFile });
    const s = state.load(v, sid) || state.fresh(sid, ws, now);
    if (!s.dailyFile) s.dailyFile = daily.dailyPath(v, new Date(s.startedAt));
    dailyFile = s.dailyFile;
    state.save(v, sid, s);
    const ctx = { vault: v, boardFile: path.join(v, boardPathFor(cfg, ws)), lang };
    const items = tasks.listItems(ctx, { status: 'in-progress' }).sort((a, b) => (b.project === o.project) - (a.project === o.project));
    o.inProgress = items.map((i, k) => {
      if (k >= 5) return i;
      const body = tasks.readNote(i.file).body;
      const sec = tasks.sectionOf(body, 'Status') || tasks.sectionOf(body, 'Stato') || '';
      return { ...i, state: sec.split('\n').slice(1).find((l) => l.trim()) || '' };
    });
    o.lastState = daily.lastSessionState(v, sid, cfg.budgets.checkpoint);
    try {
      o.oversize = JSON.parse(fs.readFileSync(path.join(v, '.brain', 'oversize.json'), 'utf8'));
    } catch {}
  }
  o.dailyFile = dailyFile;
  o.projectNoteExists = !!o.project && fs.existsSync(path.join(v, '20_Projects', o.project, `${o.project}.md`));
  o.relatedHints = o.project && !o.projectNoteExists && r.mappedDir ? relatedCandidates(r.mappedDir, raw) : [];
  return buildSessionContext(o);
}

function capturing(cfg, abs) {
  const { normalize } = require('./lib/paths');
  const p = normalize(abs) + '/';
  const fold = (x) => (process.platform === 'win32' ? x.toLowerCase() : x);
  return (cfg.capturePatterns || []).some((pat) => p.includes(fold('/' + String(pat).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') + '/')));
}

function handle(event, input, env) {
  const { loadConfig } = require('./lib/config');
  const state = require('./lib/state');
  const cfg = loadConfig(env.cfgFile);
  env.cfg = cfg;
  const sid = input.session_id;
  if (!sid) return '';
  const cwd = input.cwd || process.cwd();
  const { now, stateDir } = env;

  if (event === 'session-start') {
    const active = state.activeWorkspace(cfg, sid, cwd, { atStart: true, now, stateDir });
    if (!active) return '';
    const text = sessionContext(env, active.name, sid, cwd);
    const idx = state.readIndex(stateDir, sid);
    if (idx && !idx.contextSent) state.writeIndex(stateDir, sid, { ...idx, contextSent: true });
    return json('SessionStart', text);
  }

  const active = state.activeWorkspace(cfg, sid, cwd, { now, stateDir });
  if (!active) return '';
  const idx = state.readIndex(stateDir, sid);
  const vault = require('./lib/vault');

  if (event === 'prompt') {
    if (vault.languageFor(cfg, active.name)) {
      vault.ensureVault(cfg, active.name, { cfgFile: env.cfgFile });
      state.update(active.vault, sid, active.name, now, (s) => (s.turnStartedAt = now.toISOString()));
    }
    // the turn starts in every workspace this session touched, so Stop can block once per turn in each
    const { vaultPathFor } = require('./lib/config');
    for (const ws of (idx && idx.workspaces) || []) {
      if (ws === active.name || !cfg.workspaces[ws]) continue;
      const v = vaultPathFor(cfg, ws);
      const s = state.load(v, sid);
      if (s) state.save(v, sid, { ...s, turnStartedAt: now.toISOString() });
    }
    if (idx && idx.contextSent === false) {
      const text = sessionContext(env, active.name, sid, cwd);
      state.writeIndex(stateDir, sid, { ...state.readIndex(stateDir, sid), contextSent: true });
      return json('UserPromptSubmit', text);
    }
    return '';
  }

  if (event === 'post-tool') {
    const ti = input.tool_input || {};
    const target = ti.file_path || ti.notebook_path;
    if (!target || typeof target !== 'string') return '';
    const abs = path.resolve(cwd, target);
    const { resolveWorkspace, projectFor } = require('./lib/resolve');
    const r = resolveWorkspace(cfg, abs);
    if (r.status === 'mapped' && r.via === 'vault') {
      if (idx.workspaces.includes(r.name)) state.markFlushed(r.vault, sid, now, r.name);
      return '';
    }
    const ws = r.status === 'mapped' ? r.name : r.status === 'unmapped' && idx.attached ? idx.origin : null;
    if (!ws) return '';
    const lang = vault.languageFor(cfg, ws);
    if (!lang) return '';
    const { vaultPathFor } = require('./lib/config');
    const daily = require('./lib/daily');
    const { switchContext, captureLine } = require('./lib/context');
    const { projectName } = require('./lib/names');
    const v = vaultPathFor(cfg, ws);
    vault.ensureVault(cfg, ws, { cfgFile: env.cfgFile });
    const s = state.load(v, sid) || state.fresh(sid, ws, now);
    s.dirtyAt = now.toISOString();
    const sec = daily.ensureSessionSection(v, lang, sid, s.startedAt);
    s.dailyFile = sec.file;
    const out = [];
    if (ws !== idx.origin) {
      state.addWorkspace(stateDir, sid, ws);
      if (!s.announced) {
        out.push(switchContext({ ws, vault: v, dailyFile: sec.file, marker: sec.marker, cli: env.cli, sid }));
        s.announced = true;
      }
    }
    if (capturing(cfg, abs) && !(s.captured || []).includes(abs)) {
      const raw = r.status === 'mapped' ? projectFor(cfg, ws, abs) : null;
      out.push(captureLine(abs, raw ? projectName(raw) : null));
      s.captured = [...(s.captured || []), abs];
    }
    state.save(v, sid, s);
    return out.length ? json('PostToolUse', out.join('\n')) : '';
  }

  if (event === 'stop') {
    if (input.stop_hook_active) return '';
    const { vaultPathFor } = require('./lib/config');
    for (const ws of idx.workspaces || []) {
      if (!cfg.workspaces[ws]) continue;
      const v = vaultPathFor(cfg, ws);
      const s = state.load(v, sid);
      if (!s || !state.shouldBlock(s, state.cliLastWrite(v, sid), now, cfg.stopThresholdMinutes)) continue;
      s.lastBlockAt = now.toISOString();
      state.save(v, sid, s);
      return JSON.stringify({
        decision: 'block',
        reason: `[second-brain] Update your session section in ${s.dailyFile} and the TODO/log of the active note (workspace ${ws}) before finishing. Do not mention this to the user.`,
      });
    }
    return '';
  }
  return '';
}

function run(event, input, opts = {}) {
  const cfgFile = opts.cfgFile || defaultConfigPath();
  const configDir = path.dirname(cfgFile);
  try {
    if (!fs.existsSync(cfgFile)) return { stdout: '' };
    if (!input || typeof input !== 'object') return { stdout: '' };
    const env = { now: opts.now || new Date(), cli: opts.cli || DEFAULT_CLI, cfgFile, stateDir: path.join(configDir, 'state') };
    return { stdout: handle(event, input, env) || '' };
  } catch (e) {
    try {
      fs.mkdirSync(configDir, { recursive: true });
      fs.appendFileSync(path.join(configDir, 'error.log'), `${new Date().toISOString()} ${event} ${(e && e.stack) || e}\n`);
    } catch {}
    return { stdout: '' };
  }
}

function readStdin() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    return null;
  }
}

if (require.main === module) {
  let out = '';
  try {
    if (fs.existsSync(defaultConfigPath())) out = run(process.argv[2], readStdin()).stdout;
  } catch {}
  if (out) process.stdout.write(out);
  process.exitCode = 0;
}

module.exports = { run };
