#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const config = require('./lib/config');
const vault = require('./lib/vault');
const tasks = require('./lib/tasks');
const state = require('./lib/state');
const git = require('./lib/git');
const { isInside } = require('./lib/paths');
const { resolveWorkspace, projectFor } = require('./lib/resolve');
const { projectName } = require('./lib/names');
const { locate, folderConfigFile, LOCAL_VAULT } = require('./lib/locate');

const BOOL = new Set(['json', 'yes', 'blocked', 'open', 'quick', 'apply', 'archive', 'plan', 'here', 'config-here', 'remove', 'dry-run']);
const GIT_MODES = ['per-workspace', 'single', 'none', 'host'];

function parseArgs(argv) {
  const flags = {};
  const pos = [];
  const set = (k, v) => {
    flags[k] = k in flags ? [].concat(flags[k], v) : v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      pos.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--') && a.length > 2) {
      const eq = a.indexOf('=');
      const key = eq > 0 ? a.slice(2, eq) : a.slice(2);
      if (eq > 0) set(key, a.slice(eq + 1));
      else if (BOOL.has(key) || i + 1 >= argv.length) set(key, true);
      else set(key, argv[++i]);
    } else if (a === '-m' && i + 1 < argv.length) set('m', argv[++i]);
    else pos.push(a);
  }
  return { flags, pos };
}

class CliError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const str = (v) => (typeof v === 'string' && v !== '' ? v : Array.isArray(v) ? str(v[v.length - 1]) : undefined);
const list = (v) => (v === undefined || v === true ? [] : [].concat(v).filter((x) => typeof x === 'string'));
const stateDirOf = (env) => path.join(path.dirname(env.cfgFile), 'state');

// A real session id, or `literal` when the skill could not substitute ${CLAUDE_SESSION_ID}.
function sessionOf(flags) {
  const s = str(flags.session);
  if (!s) return {};
  return s.includes('${') ? { literal: true } : { sid: s };
}

function languageError(name) {
  return new CliError(4, `language-required: run: brain init ${name} --language <code>`);
}

function ensure(env, name, language, repair = false) {
  try {
    return vault.ensureVault(env.cfg, name, { language, cfgFile: env.cfgFile, repair });
  } catch (e) {
    if (e.message === 'language-required') throw languageError(name);
    throw e;
  }
}

function workspaceCtx(env) {
  const { cfg, flags, cwd } = env;
  let name = str(flags.workspace);
  if (!name) {
    const r = resolveWorkspace(cfg, cwd);
    if (r.status === 'mapped') name = r.name;
    else {
      const { sid } = sessionOf(flags);
      const idx = sid && state.readIndex(stateDirOf(env), sid);
      if (idx && !idx.detached && idx.origin) name = idx.origin;
    }
    if (!name) throw new CliError(2, 'not in a workspace: run brain init');
  }
  if (!cfg.workspaces[name]) throw new CliError(2, `unknown workspace: ${name}`);
  ensure(env, name);
  const v = config.vaultPathFor(cfg, name);
  return {
    name,
    ctx: { vault: v, boardFile: path.join(v, config.boardPathFor(cfg, name)), lang: vault.languageFor(cfg, name) || 'en', sid: sessionOf(flags).sid, budgets: cfg.budgets },
  };
}

function out(env, value, human) {
  env.stdout.write(env.flags.json ? JSON.stringify(value, null, 2) + '\n' : human + '\n');
}

const rel = (ctx, f) => path.relative(ctx.vault, f).replace(/\\/g, '/');

function requireArg(v, what) {
  if (v === undefined || v === true || v === '') throw new CliError(2, `missing ${what}`);
  return v;
}

function cwdProject(env, ws) {
  const explicit = str(env.flags.project);
  if (explicit) return explicit;
  const raw = projectFor(env.cfg, ws, env.cwd);
  return raw ? projectName(raw) : undefined;
}

function cmdItems(env, kind, sub, args) {
  const { name: ws, ctx } = workspaceCtx(env);
  const { flags } = env;
  const itemName = () => requireArg(args[0], 'name');
  switch (sub) {
    case 'add': {
      const title = requireArg(args.join(' '), 'title');
      const project = cwdProject(env, ws);
      const r = kind === 'feature'
        ? tasks.addFeature(ctx, { title, project, lifecycle: str(flags.lifecycle) })
        : tasks.addItem(ctx, kind, { title, project, feature: str(flags.feature), status: str(flags.status) || 'todo' });
      return out(env, { name: r.name, file: r.file }, `${kind} added: ${r.name} → ${rel(ctx, r.file)}`);
    }
    case 'list': {
      if (kind === 'feature') throw new CliError(2, 'use: brain search <text> --type feature');
      const items = tasks.listItems(ctx, { kind, status: str(flags.status), project: str(flags.project), blocked: flags.blocked ? true : undefined });
      return out(env, items, items.length ? items.map((i) => `- ${i.name} [${i.status}]${i.blocked ? ' 🔒' : ''}${i.project ? ` (${i.project})` : ''}`).join('\n') : 'nothing');
    }
    case 'show': {
      const max = Number(str(flags['max-chars']) || 4000);
      const text = tasks.showItem(ctx, itemName(), { section: str(flags.section), maxChars: max > 0 ? max : 4000 });
      return out(env, { text }, text);
    }
    case 'move': {
      const r = tasks.moveItem(ctx, itemName(), requireArg(args[1], 'status'));
      return out(env, r, `${r.name} → ${args[1]}`);
    }
    case 'done':
    case 'discard': {
      const status = sub === 'done' ? 'completed' : 'discarded';
      const r = tasks.moveItem(ctx, itemName(), status);
      return out(env, r, `${r.name} → ${status}`);
    }
    case 'block':
    case 'unblock': {
      const r = tasks.setBlocked(ctx, itemName(), sub === 'block');
      return out(env, r, `${r.name} ${sub === 'block' ? 'blocked' : 'unblocked'}`);
    }
    case 'delete': {
      if (!flags.yes) throw new CliError(3, 'refusing to delete without --yes');
      const dest = tasks.deleteItem(ctx, itemName());
      return out(env, { archived: dest }, `archived: ${rel(ctx, dest)}`);
    }
    case 'sync': {
      const r = tasks.syncFromBoard(ctx);
      require('./lib/indexes').rebuildIndexes(ctx);
      state.markCliWrite(ctx.vault, ctx.sid);
      return out(env, r, `synced: ${r.statusChanged} status, ${r.notesCreated} notes, ${r.cardsAdded} cards, ${r.cardsRouted} routed${r.featureCards.length ? `; cards on features (turn them into tasks): ${r.featureCards.join(', ')}` : ''}`);
    }
    default:
      throw new CliError(2, `unknown ${kind} command: ${sub || '(none)'}`);
  }
}

function defaultName(dir) {
  const n = path.basename(dir).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[^a-z0-9]+/, '').replace(/-+$/, '');
  return n || 'brain';
}

function initPlan(env, dir) {
  const { cfg } = env;
  const r = resolveWorkspace(cfg, dir);
  const name = defaultName(dir);
  const parentDir = path.dirname(dir);
  let parentHasRepos = false;
  try {
    parentHasRepos = fs.readdirSync(parentDir, { withFileTypes: true }).some((e) => e.isDirectory() && fs.existsSync(path.join(parentDir, e.name, '.git')));
  } catch {}
  const defaultVault = path.join(cfg.root, name);
  const id = git.detectIdentity(dir, { vaultDir: defaultVault });
  return {
    cwd: dir,
    folderName: path.basename(dir),
    parentDir,
    parentHasRepos,
    mapped: r.status === 'mapped' ? r.name : null,
    workspaces: Object.keys(cfg.workspaces),
    defaultName: name,
    defaultVault,
    insideVault: path.join(dir, 'SecondBrain'),
    identity: id ? { name: id.name, email: id.email, source: id.source } : null,
    gitAvailable: git.available(),
  };
}

function bind(env, name, attached) {
  const { sid, literal } = sessionOf(env.flags);
  if (sid) state.bindSession(stateDirOf(env), sid, name, { attached, contextSent: false });
  else if (literal) state.writePending(stateDirOf(env), env.cwd, name);
  return !!(sid || literal);
}

function gitSettings(flags, dir, vaultDir) {
  const mode = str(flags['git-mode']) || 'per-workspace';
  if (!GIT_MODES.includes(mode)) throw new CliError(2, `bad --git-mode: use ${GIT_MODES.join(' | ')}`);
  const g = { mode };
  const identity = str(flags.identity) || 'detected';
  if (mode !== 'none' && identity === 'detected') {
    // remembered per workspace and passed to each commit (`git -c`): shared repos never accumulate identities
    const id = git.detectIdentity(dir, { vaultDir });
    if (id && id.source !== 'global') {
      g.identity = { name: id.name, email: id.email, ...(id.file ? { file: id.file } : {}) };
      // the vault's own repo also gets it in its config, so manual commits there match
      if (mode === 'per-workspace') g.config = id.source === 'gitconfig-file' ? { 'include.path': id.includePath } : { 'user.name': id.name, 'user.email': id.email };
    }
  }
  return g;
}

function excludeFromRepo(dir, target) {
  try {
    if (!git.available()) return;
    const top = git.toplevel(dir);
    if (top) git.excludeInParent(top, target);
  } catch {}
}

// Project mode: config, session state and vault all live in <dir>/SecondBrain; nothing is written elsewhere.
function cmdInitHere(env, dir, args) {
  const { flags } = env;
  const file = config.localConfigFile(dir);
  const cfg = fs.existsSync(file) ? config.loadConfig(file) : { ...config.defaults(), local: true };
  const name = args[0] || Object.keys(cfg.workspaces)[0] || defaultName(dir);
  config.assertWorkspaceName(name);
  if (!cfg.workspaces[name]) {
    if (Object.keys(cfg.workspaces).length) throw new CliError(2, `project mode: this folder already has a brain (${Object.keys(cfg.workspaces)[0]})`);
    cfg.workspaces[name] = { git: gitSettings(flags, dir, path.join(dir, LOCAL_VAULT)) };
  }
  const ws = cfg.workspaces[name];
  if (str(flags.language) && (!ws.language || ws.language === 'auto')) ws.language = str(flags.language);
  config.saveConfig(cfg, file);
  const here = { ...env, cfg: config.loadConfig(file), cfgFile: file };
  const v = ensure(here, name, str(flags.language), true);
  bind(here, name, false);
  return out(env, { workspace: name, vault: v.vault, project: true }, `brain active (project mode): ${name} → ${v.vault}`);
}

function cmdInit(env, args) {
  const { cfg, flags } = env;
  const dir = path.resolve(env.cwd, str(flags.path) || '.');
  if (flags.plan) {
    const p = initPlan(env, dir);
    return out(env, p, JSON.stringify(p, null, 2));
  }
  if (flags.here) return cmdInitHere(env, dir, args);
  if (flags['config-here']) {
    // only on request (the sandbox cannot write the global config): the readable global settings come along
    const file = folderConfigFile(dir);
    const r = cmdInit({ ...env, cfgFile: file, flags: { ...flags, 'config-here': false } }, args);
    excludeFromRepo(dir, path.dirname(file));
    return r;
  }
  const r = resolveWorkspace(cfg, dir);
  // without an explicit name a new folder gets a new workspace: never merge it into a same-named one
  let name = args[0] || (r.status === 'mapped' ? r.name : defaultName(dir));
  if (!args[0] && r.status !== 'mapped') for (let n = 2; cfg.workspaces[name]; n++) name = `${defaultName(dir)}-${n}`;
  config.assertWorkspaceName(name);
  let ws = cfg.workspaces[name];
  if (!ws) {
    const vaultDir = str(flags.vault) ? path.resolve(env.cwd, str(flags.vault)) : null;
    vault.assertNoOverlap(cfg, name, vaultDir || path.join(cfg.root, name));
    ws = { paths: [dir], git: gitSettings(flags, dir, vaultDir || path.join(cfg.root, name)) };
    if (vaultDir) ws.vault = vaultDir;
    cfg.workspaces[name] = ws;
  } else if (!(ws.paths || []).some((p) => isInside(dir, p)) && !isInside(dir, config.vaultPathFor(cfg, name))) {
    ws.paths = [...(ws.paths || []), dir];
  }
  if (str(flags.language) && (!ws.language || ws.language === 'auto')) ws.language = str(flags.language);
  config.saveConfig(cfg, env.cfgFile);
  const v = ensure(env, name, str(flags.language), true);
  bind(env, name, false);
  return out(env, { workspace: name, vault: v.vault }, `brain active: ${name} → ${v.vault}`);
}

function cmdAttach(env, args) {
  const name = requireArg(args[0], 'workspace name');
  if (!env.cfg.workspaces[name]) throw new CliError(2, `unknown workspace: ${name}`);
  const v = ensure(env, name);
  if (!sessionOf(env.flags).sid && !sessionOf(env.flags).literal) throw new CliError(2, 'attach needs --session <id>');
  bind(env, name, true);
  return out(env, { workspace: name, vault: v.vault }, `brain active for this chat: ${name} → ${v.vault}`);
}

function cmdDetach(env) {
  const { sid } = sessionOf(env.flags);
  if (!sid) throw new CliError(2, 'detach needs --session <id>');
  state.detachSession(stateDirOf(env), sid);
  return out(env, { detached: true }, 'brain off for this chat');
}

function cmdWorkspace(env, sub, args) {
  const { cfg, flags } = env;
  const save = () => config.saveConfig(cfg, env.cfgFile);
  switch (sub) {
    case 'add': {
      const name = requireArg(args[0], 'workspace name');
      config.assertWorkspaceName(name);
      const ws = cfg.workspaces[name] || { paths: [] };
      for (const p of list(flags.path)) if (!ws.paths.includes(path.resolve(env.cwd, p))) ws.paths.push(path.resolve(env.cwd, p));
      if (str(flags.vault)) ws.vault = path.resolve(env.cwd, str(flags.vault));
      vault.assertNoOverlap(cfg, name, ws.vault || path.join(cfg.root, name));
      if (str(flags.language)) ws.language = str(flags.language);
      if (str(flags.board)) ws.board = str(flags.board);
      cfg.workspaces[name] = ws;
      save();
      return out(env, { workspace: name }, `workspace ${name}: ${ws.paths.length} path(s)`);
    }
    case 'list': {
      const rows = Object.keys(cfg.workspaces).map((n) => ({ name: n, vault: config.vaultPathFor(cfg, n) }));
      return out(env, rows, rows.length ? rows.map((r) => `- ${r.name} → ${r.vault}`).join('\n') : 'no workspaces');
    }
    case 'map': {
      const p = path.resolve(env.cwd, requireArg(args[0], 'path'));
      const name = requireArg(args[1], 'workspace name');
      config.assertWorkspaceName(name);
      const ws = cfg.workspaces[name] || { paths: [] };
      if (!ws.paths.includes(p)) ws.paths.push(p);
      cfg.workspaces[name] = ws;
      save();
      return out(env, { workspace: name, path: p }, `mapped ${p} → ${name}`);
    }
    case 'ignore': {
      const p = path.resolve(env.cwd, requireArg(args[0], 'path'));
      if (!cfg.ignore.includes(p)) cfg.ignore.push(p);
      save();
      return out(env, { ignored: p }, `ignored ${p}`);
    }
    default:
      throw new CliError(2, `unknown workspace command: ${sub || '(none)'}`);
  }
}

function cmdSecret(env, sub, args) {
  const secrets = require('./lib/secrets');
  const { ctx } = workspaceCtx(env);
  switch (sub) {
    case 'set': {
      const key = requireArg(args[0], 'KEY');
      secrets.setSecret(ctx.vault, key, requireArg(args.slice(1).join(' '), 'value'));
      return out(env, { key }, `secret set: ${key} — reference it as ${secrets.placeholder(key)}`);
    }
    case 'get': {
      const key = requireArg(args[0], 'KEY');
      const all = secrets.readSecrets(ctx.vault);
      if (!(key in all)) throw new CliError(2, `no secret ${key}`);
      return out(env, { key, value: all[key] }, all[key]);
    }
    case 'list': {
      const keys = Object.keys(secrets.readSecrets(ctx.vault));
      return out(env, keys, keys.length ? keys.join('\n') : 'no secrets');
    }
    default:
      throw new CliError(2, `unknown secret command: ${sub || '(none)'}`);
  }
}

function cmdIdea(env, sub, args) {
  const ideas = require('./lib/ideas');
  const { name: ws, ctx } = workspaceCtx(env);
  const { flags } = env;
  switch (sub) {
    case 'add': {
      const r = ideas.addIdea(ctx, requireArg(args.join(' '), 'idea text'), { project: cwdProject(env, ws) });
      state.markCliWrite(ctx.vault, ctx.sid);
      return out(env, r, `idea added: ${r.id}`);
    }
    case 'list': {
      const items = ideas.listIdeas(ctx, { project: str(flags.project), open: !!flags.open, limit: Number(str(flags.limit) || 20) });
      return out(env, items, items.length ? items.map((i) => `- ${i.id} [${i.state}] ${i.text}${i.project ? ` (${i.project})` : ''}`).join('\n') : 'no ideas');
    }
    case 'promote': {
      const r = ideas.promoteIdea(ctx, requireArg(args[0], 'idea id'), requireArg(str(flags.to), '--to <name>'));
      state.markCliWrite(ctx.vault, ctx.sid);
      return out(env, r, `idea ${args[0]} → [[${flags.to}]]`);
    }
    case 'discard': {
      const r = ideas.discardIdea(ctx, requireArg(args[0], 'idea id'));
      state.markCliWrite(ctx.vault, ctx.sid);
      return out(env, r, `idea ${args[0]} discarded`);
    }
    default:
      throw new CliError(2, `unknown idea command: ${sub || '(none)'}`);
  }
}

function cmdProject(env, sub, args) {
  const boards = require('./lib/boards');
  const home = require('./lib/home');
  const { ctx } = workspaceCtx(env);
  switch (sub) {
    case 'add': {
      const r = tasks.addProjectHub(ctx, requireArg(args.join(' '), 'project'), { summary: str(env.flags.summary) });
      return out(env, r, `project hub added: ${rel(ctx, r.file)}`);
    }
    case 'list': {
      const names = new Set([...home.hubs(ctx.vault), ...tasks.listItems(ctx, {}).map((i) => i.project).filter(Boolean)]);
      for (const b of boards.listBoards(ctx)) if (b.project) names.add(b.project);
      const rows = [...names].sort().map((n) => ({ name: n, split: boards.isSplit(ctx, n), hub: home.hubs(ctx.vault).includes(n) }));
      return out(env, rows, rows.length ? rows.map((r) => `- ${r.name} — split: ${r.split ? 'yes' : 'no'}, hub: ${r.hub ? 'yes' : 'no'}`).join('\n') : 'no projects');
    }
    case 'relate': {
      const projects = require('./lib/projects');
      const flagOf = (k) => k.replace('_', '-');
      const given = Object.keys(projects.RELATIONS).filter((k) => str(env.flags[flagOf(k)]));
      if (given.length !== 1) throw new CliError(2, 'usage: brain project relate <a> --depends-on|--used-by|--source-of|--built-from|--related <b> [--remove]');
      const rel = given[0];
      const r = projects.relate(ctx.vault, requireArg(args.join(' '), 'project'), rel, str(env.flags[flagOf(rel)]), { remove: !!env.flags.remove });
      state.markCliWrite(ctx.vault, ctx.sid);
      const side = `${r.a} ${rel} ${r.b}, ${r.b} ${projects.RELATIONS[rel]} ${r.a}`;
      return out(env, r, r.changed ? `${r.removed ? 'removed' : 'related'}: ${side}` : `unchanged: ${side}`);
    }
    case 'rename': {
      const rename = require('./lib/rename');
      const p = rename.planRename(ctx, requireArg(args[0], 'project'), requireArg(args[1], 'new name'));
      if (env.flags['dry-run']) return out(env, p, [`rename ${p.from} → ${p.to} (dry run):`, ...p.moves.map((m) => `- ${m.from} → ${m.to}`), 'then links, project fields and idea headings follow'].join('\n'));
      const r = rename.applyRename(ctx, p);
      runIndex(env, ctx);
      state.markCliWrite(ctx.vault, ctx.sid);
      return out(env, r, `renamed ${r.from} → ${r.to}: ${r.moved} files moved, links updated in ${r.linksRewritten} notes`);
    }
    case 'split':
    case 'merge': {
      const p = requireArg(args[0], 'project');
      const r = sub === 'split' ? boards.splitProject(ctx, p) : boards.mergeProject(ctx, p);
      state.markCliWrite(ctx.vault, ctx.sid);
      return out(env, r, `${sub} ${p}: ${r.cardsMoved} cards, ${r.ideasMoved} ideas moved`);
    }
    default:
      throw new CliError(2, `unknown project command: ${sub || '(none)'}`);
  }
}

// The repos under the workspace's folders become project hubs; re-runnable, never touches a hub's prose.
function cmdBootstrap(env) {
  if (env.cfg.local) throw new CliError(2, 'project mode: this folder is one project; bootstrap maps the repos of a workspace');
  const repos = require('./lib/repos');
  const { name, ctx } = workspaceCtx(env);
  const dryRun = !!env.flags['dry-run'];
  const p = repos.plan(env.cfg, name, ctx);
  const done = dryRun ? { created: [], refreshed: [] } : repos.apply(ctx, p);
  if (!dryRun) {
    runIndex(env, ctx);
    state.markCliWrite(ctx.vault, ctx.sid);
  }
  const value = { dryRun, ...done, repos: p.repos.map(({ dir, base, ...r }) => r), renames: p.renames, orphans: p.orphans, candidates: p.candidates, broken: p.broken };
  return out(env, value, repos.describe(p, { dryRun }));
}

// Obsidian community plugins for the vault: the ones its notes need by default, or the ids given.
async function cmdPlugins(env, args) {
  const plugins = require('./lib/plugins');
  const { ctx } = workspaceCtx(env);
  const ids = args.length ? args : plugins.DEFAULTS;
  const say = (label, ids) => ids.length && `${label}: ${ids.join(', ')}`;
  if (env.flags['dry-run']) {
    const p = plugins.plan(ctx.vault, ids);
    const lines = [say('would install', p.download), say('would enable', p.enable), say('already there', p.present), say('invalid ids', p.invalid)].filter(Boolean);
    return out(env, { dryRun: true, ...p }, lines.join('\n') || 'nothing to do');
  }
  const r = await plugins.install(ctx.vault, ids, { fetch: env.fetch, lock: (fn) => require('./lib/lock').withLock(ctx.vault, fn) });
  const changed = r.installed.length || r.enabled.length;
  if (changed) state.markCliWrite(ctx.vault, ctx.sid);
  const lines = [say('installed', r.installed), say('enabled', r.enabled), say('already there', r.present)].filter(Boolean);
  if (changed) lines.push('Obsidian asks whether to trust the vault\'s plugins the first time it opens it: choose "Trust author and enable plugins".');
  if (r.failed.length) throw new CliError(9, [...lines, `failed: ${r.failed.map((f) => `${f.id} (${f.reason})`).join(', ')}`].join('\n'));
  return out(env, r, lines.join('\n') || 'nothing to do');
}

function cmdPostmortem(env, sub, args) {
  if (sub !== 'add') throw new CliError(2, 'usage: brain postmortem add <title…> [--project <p>]');
  const { name: ws, ctx } = workspaceCtx(env);
  const r = tasks.addPostmortem(ctx, { title: requireArg(args.join(' '), 'title'), project: cwdProject(env, ws) });
  return out(env, r, `post mortem created: ${rel(ctx, r.file)} — fill every section`);
}

function cmdAdopt(env, args) {
  const adopt = require('./lib/adopt');
  const src = path.resolve(env.cwd, requireArg(args[0], 'vault path'));
  const ws = requireArg(str(env.flags.as), '--as <workspace>');
  config.assertWorkspaceName(ws);
  if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) throw new CliError(2, `not a folder: ${src}`);
  const existing = env.cfg.workspaces[ws];
  if (existing && existing.vault && path.resolve(existing.vault) !== src) throw new CliError(2, `workspace ${ws} already has another vault`);
  vault.assertNoOverlap(env.cfg, ws, src);
  const plan = adopt.planAdopt(src, new Date());
  if (!env.flags.apply) {
    const lines = [
      `dry run — nothing changed. Run again with --apply${str(env.flags.language) ? '' : ' --language <code>'} to adopt ${src} as ${ws}.`,
      ...plan.moves.map((m) => `move ${m.from} → ${m.to}`),
      ...plan.conflicts.map((m) => `skip ${m.from} → ${m.to} (target exists)`),
      `board: ${plan.board || 'none found (a new 00_Inbox/Plan.md)'}`,
      plan.tasksFile ? `${plan.tasksFile}: ${plan.taskItems.length} items → task notes + cards, original kept as TASKS.legacy.md` : 'no TASKS.md checklist',
      `left as they are: ${plan.untouched.join(', ') || 'nothing'}`,
    ];
    return out(env, plan, lines.join('\n'));
  }
  try {
    const r = adopt.applyAdopt(env.cfg, src, ws, plan, env.cfgFile, { language: str(env.flags.language) });
    return out(env, r, `adopted: ${r.moved} moved, ${r.tasksCreated} tasks created → workspace ${ws}`);
  } catch (e) {
    if (e.message === 'language-required') throw new CliError(4, `language-required: run: brain adopt ${args[0]} --as ${ws} --apply --language <code>`);
    throw e;
  }
}

function runIndex(env, ctx) {
  const { cfg } = env;
  const now = new Date();
  const projects = require('./lib/projects');
  const hubsMoved = projects.migrateHubs(ctx.vault).length;
  const hubConflicts = projects.hubConflicts(ctx.vault);
  const archived = tasks.archiveDone(ctx, now, cfg.archiveAfterDays);
  const ideasArchived = require('./lib/ideas').archiveIdeas(ctx, now, cfg.archiveAfterDays);
  const budget = require('./lib/budget');
  const rotated = budget.rotateLogs(ctx);
  const decisions = budget.archiveDecisions(ctx, now, cfg.archiveAfterDays);
  const dailies = require('./lib/daily').rollover(ctx.vault, now, cfg.dailyInboxDays);
  require('./lib/indexes').rebuildIndexes(ctx);
  require('./lib/home').rebuildHome(ctx);
  const oversize = budget.check(ctx);
  fs.mkdirSync(path.join(ctx.vault, '.brain'), { recursive: true });
  fs.writeFileSync(path.join(ctx.vault, '.brain', 'oversize.json'), JSON.stringify(oversize, null, 2) + '\n');
  state.prune(ctx.vault, stateDirOf(env), now);
  state.markCliWrite(ctx.vault, ctx.sid);
  return { hubsMoved, hubConflicts, archived: archived.length, ideasArchived, rotated, decisions, dailies: dailies.length, oversize };
}

function cmdIndex(env) {
  const { ctx } = workspaceCtx(env);
  const r = runIndex(env, ctx);
  return out(env, r, `index: ${r.archived} cards archived, ${r.ideasArchived} ideas archived, ${r.rotated} logs rotated, ${r.decisions} decisions archived, ${r.dailies} dailies archived${r.hubsMoved ? `, ${r.hubsMoved} hubs moved to 20_Projects/<project>.md` : ''}${r.hubConflicts.length ? `; hub conflict: ${r.hubConflicts.join(', ')} (keep one of 20_Projects/<project>.md and 20_Projects/<project>/<project>.md)` : ''}${r.oversize.length ? `; oversize: ${r.oversize.map((o) => o.file).join(', ')}` : ''}`);
}

// Identity for one commit of this workspace; null = let git resolve it (global, or the host repo's own).
function commitIdentity(cfg, name, repo) {
  const ws = cfg.workspaces[name] || {};
  const id = ws.git && ws.git.identity;
  if (!id) return null;
  if (vault.gitModeFor(cfg, name) === 'host' && git.localIdentity(repo)) return null;
  if (id.file && fs.existsSync(id.file)) {
    const read = (key) => {
      try {
        return git.run(path.dirname(id.file), ['config', '-f', id.file, '--get', key]);
      } catch {
        return null;
      }
    };
    const fromFile = { name: read('user.name'), email: read('user.email') };
    if (fromFile.name && fromFile.email) return fromFile;
  }
  return { name: id.name, email: id.email };
}

function cmdCommit(env) {
  const secrets = require('./lib/secrets');
  const msg = requireArg(str(env.flags.m) || str(env.flags.message), '-m <message>');
  const { name, ctx } = workspaceCtx(env);
  runIndex(env, ctx);
  const repo = vault.repoFor(env.cfg, name, ctx.vault);
  if (!repo) return out(env, { committed: false, reason: 'git-disabled' }, 'git disabled');
  if (!git.available()) return out(env, { committed: false, reason: 'git-unavailable' }, 'git unavailable');
  const tracked = git.trackedPrivate(repo.repo, repo.pathspec);
  if (tracked.length) throw new CliError(5, tracked.map((f) => `private file tracked by git: ${f} — run: git rm --cached "${f}"`).join('\n'));
  const hits = secrets.scanChanged(repo.repo, repo.pathspec);
  if (hits.length) throw new CliError(5, hits.map((h) => `secrets found: ${h.file}:${h.line} (${h.kind}) — move to secrets.local.md`).join('\n'));
  vault.applyGitConfig(env.cfg, name, repo.repo);
  const r = git.commitPath(repo.repo, repo.pathspec, msg.startsWith('brain:') ? msg : `brain: ${msg}`, { identity: commitIdentity(env.cfg, name, repo.repo) });
  return out(env, r, r.committed ? 'committed' : r.reason === 'no-changes' ? 'nothing to commit' : 'git unavailable');
}

function cmdContext(env) {
  const { name: ws, ctx } = workspaceCtx(env);
  const text = require('./lib/retrieve').context(ctx, cwdProject(env, ws));
  return out(env, { text }, text);
}

// This session's daily checkpoint, written by the CLI so the agent never edits the shared daily file.
function cmdCheckpoint(env) {
  const daily = require('./lib/daily');
  const { sid } = sessionOf(env.flags);
  if (!sid) throw new CliError(2, 'checkpoint needs --session <id>');
  const { ctx } = workspaceCtx(env);
  const s = state.load(ctx.vault, sid);
  const startedAt = s && s.startedAt ? s.startedAt : new Date();
  const fields = { status: str(env.flags.status), next: str(env.flags.next), open: str(env.flags.open), log: str(env.flags.log) };
  if (!Object.values(fields).some(Boolean)) throw new CliError(2, 'usage: brain checkpoint [--status …] [--next …] [--open …] [--log …]');
  const r = daily.checkpoint(ctx.vault, ctx.lang, sid, startedAt, fields);
  state.markCliWrite(ctx.vault, sid);
  return out(env, r, 'checkpoint saved');
}

// Mutating commands run under the vault lock (another session may be writing the same files).
function locked(env, fn) {
  let v = null;
  try {
    v = workspaceCtx(env).ctx.vault;
  } catch {
    return fn();
  }
  return require('./lib/lock').withLock(v, fn);
}

// Any note by name (task, issue, feature, hub, loose note), one section at a time.
function cmdShow(env, args) {
  const { ctx } = workspaceCtx(env);
  const max = Number(str(env.flags['max-chars']) || 4000);
  const text = tasks.showItem(ctx, requireArg(args.join(' '), 'name'), { section: str(env.flags.section), maxChars: max > 0 ? max : 4000 });
  return out(env, { text }, text);
}

function cmdSearch(env, args) {
  const { ctx } = workspaceCtx(env);
  const { flags } = env;
  const hits = require('./lib/retrieve').search(ctx, requireArg(args.join(' '), 'search text'), {
    project: str(flags.project), type: str(flags.type), limit: Number(str(flags.limit) || 10), archive: !!flags.archive,
  });
  return out(env, hits, hits.length ? hits.map((h) => `- ${h.name} (${h.path})${h.heading ? ` § ${h.heading}` : ''} — ${h.snippet}`).join('\n') : 'no results');
}

function cmdStatus(env) {
  const { name, ctx } = workspaceCtx(env);
  const items = tasks.listItems(ctx, {});
  const count = (s) => items.filter((i) => i.status === s).length;
  const bugs = items.filter((i) => i.kind === 'issue' && i.status !== 'completed' && i.status !== 'discarded').length;
  const openIdeas = require('./lib/ideas').listIdeas(ctx, { open: true, limit: 0 }).length;
  const s = { workspace: name, vault: ctx.vault, language: ctx.lang, git: vault.gitModeFor(env.cfg, name), todo: count('todo'), inProgress: count('in-progress'), completed: count('completed'), bugs, ideas: openIdeas };
  const lines = [`workspace ${name} → ${ctx.vault} (${ctx.lang}, git ${s.git})`, `ToDo ${s.todo} · In Progress ${s.inProgress} · Completed ${s.completed} · open bugs ${bugs} · open ideas ${openIdeas}`];
  if (!env.cfg.local) {
    s.repos = require('./lib/repos').quickCheck(env.cfg, name, ctx.vault);
    if (s.repos.withoutHub || s.repos.orphans) lines.push(`repos: ${s.repos.withoutHub} without hub · ${s.repos.orphans} hubs without their repo folder → brain bootstrap --dry-run`);
  }
  s.missingPlugins = require('./lib/plugins').missing(ctx.vault);
  if (s.missingPlugins.length) lines.push(`plugins: missing ${s.missingPlugins.join(', ')} → brain plugins`);
  return out(env, s, lines.join('\n'));
}

// Codex runs the agent's commands in a sandbox that may not reach the config folder or the vault.
function notWritable(e) {
  if (!e || !['EPERM', 'EACCES', 'EROFS'].includes(e.code) || !e.path) return null;
  return new CliError(8, `cannot write ${e.path} (the agent's sandbox may not reach it): approve this command to run outside the sandbox, add its folder to writable_roots in ~/.codex/config.toml, keep the configuration in the folder (brain init --config-here, only if the user chooses it), or use project mode (brain init --here) to keep everything inside the folder`);
}

const ERRORS = {
  'name-taken': (e) => new CliError(6, `name taken: ${e.file}`),
  'not-found': () => new CliError(2, 'not found'),
  'not-an-item': () => new CliError(2, 'not a task or issue'),
  'bad-status': () => new CliError(2, 'bad status: use todo | in-progress | completed | discarded'),
  'bad-kind': () => new CliError(2, 'bad kind'),
  'empty-title': () => new CliError(2, 'empty title'),
  'invalid-workspace-name': () => new CliError(2, 'invalid workspace name: letters, digits, - and _'),
  'invalid-secret-key': () => new CliError(2, 'invalid secret key: use UPPER_SNAKE_CASE'),
  'reserved-name': () => new CliError(2, 'reserved or empty project name'),
  'unknown-project': (e) => new CliError(2, `unknown project: ${e.project}`),
  'no-hub': (e) => new CliError(2, `no hub for project ${e.project}: brain project add ${e.project}`),
  'bad-relation': () => new CliError(2, 'a relation links two different projects: --depends-on | --used-by | --source-of | --built-from | --related'),
  'already-split': () => new CliError(2, 'project already split'),
  'not-split': () => new CliError(2, 'project is not split'),
  'vault-overlap': (e) => new CliError(2, `vault overlaps workspace ${e.other}: each workspace needs its own folder`),
  'vault-locked': () => new CliError(7, 'vault busy: another session is writing it, retry in a moment'),
  'multiline-secret': () => new CliError(2, 'secret values must be one line: encode multi-line values (for example base64)'),
  'bad-community-plugins': () => new CliError(2, 'cannot read .obsidian/community-plugins.json of the vault (not a JSON list): fix or remove it, nothing was changed'),
  'invalid-config': () => new CliError(2, `invalid config file: ${config.configPath()}`),
};

const USAGE = 'usage: brain <init|attach|detach|task|issue|feature|idea|checkpoint|context|show|search|project|postmortem|workspace|secret|plugins|index|commit|status|adopt> …';

async function main(argv, io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  const cwd = io.cwd || process.cwd();
  const { flags, pos } = parseArgs(argv);
  // Codex has no session substitution in skills: its shell exposes the thread id instead
  const hostSid = io.env && (io.env.CODEX_THREAD_ID || io.env.CODEX_SESSION_ID);
  if (!sessionOf(flags).sid && hostSid) flags.session = hostSid;
  const globalFile = config.configPath(io.env);
  const cfgFile = str(flags.config) || locate(cwd, { globalFile }) || globalFile;
  try {
    const cfg = config.loadConfig(cfgFile);
    const env = { cfg, cfgFile, flags, cwd, stdout, stderr, fetch: io.fetch || globalThis.fetch };
    const [cmd, sub, ...rest] = pos;
    const args = [sub, ...rest].filter((x) => x !== undefined);
    if (cfg.local && (cmd === 'workspace' || cmd === 'adopt')) throw new CliError(2, 'project mode: this folder has its own brain; workspaces live in the global config (run the command outside this folder)');
    switch (cmd) {
      case 'task':
      case 'issue':
      case 'feature':
        locked(env, () => cmdItems(env, cmd, sub, rest));
        break;
      case 'init':
        cmdInit(env, args);
        break;
      case 'attach':
        cmdAttach(env, args);
        break;
      case 'detach':
        cmdDetach(env);
        break;
      case 'workspace':
        cmdWorkspace(env, sub, rest);
        break;
      case 'secret':
        locked(env, () => cmdSecret(env, sub, rest));
        break;
      case 'idea':
        locked(env, () => cmdIdea(env, sub, rest));
        break;
      case 'project':
        locked(env, () => cmdProject(env, sub, rest));
        break;
      case 'postmortem':
        locked(env, () => cmdPostmortem(env, sub, rest));
        break;
      case 'bootstrap':
        locked(env, () => cmdBootstrap(env));
        break;
      case 'plugins':
        await cmdPlugins(env, args);
        break;
      case 'adopt':
        cmdAdopt(env, args);
        break;
      case 'context':
        cmdContext(env);
        break;
      case 'show':
        cmdShow(env, args);
        break;
      case 'search':
        cmdSearch(env, args);
        break;
      case 'index':
        locked(env, () => cmdIndex(env));
        break;
      case 'commit':
        locked(env, () => cmdCommit(env));
        break;
      case 'checkpoint':
        cmdCheckpoint(env);
        break;
      case 'status':
      case undefined:
        cmdStatus(env);
        break;
      default:
        throw new CliError(2, USAGE);
    }
    return 0;
  } catch (e) {
    const err = e instanceof CliError ? e : ERRORS[e.message] ? ERRORS[e.message](e) : /^scan-failed/.test(e.message) ? new CliError(5, `${e.message} — cannot scan for secrets, nothing committed`) : notWritable(e);
    if (!err) {
      stderr.write(`error: ${e.message}\n`);
      return 1;
    }
    stderr.write(err.message + '\n');
    return err.code;
  }
}

if (require.main === module) {
  main(process.argv.slice(2), { env: process.env }).then((code) => {
    process.exitCode = code;
  });
}

module.exports = { main, parseArgs, CliError, workspaceCtx, defaultName, initPlan, USAGE };
