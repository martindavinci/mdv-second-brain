#!/usr/bin/env node
'use strict';
const path = require('node:path');
const config = require('./lib/config');
const vault = require('./lib/vault');
const tasks = require('./lib/tasks');
const { resolveWorkspace, projectFor } = require('./lib/resolve');

const BOOL = new Set(['json', 'yes', 'blocked', 'open', 'quick', 'apply', 'archive', 'plan']);

function parseArgs(argv) {
  const flags = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      pos.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--') && a.length > 2) {
      const eq = a.indexOf('=');
      const key = eq > 0 ? a.slice(2, eq) : a.slice(2);
      if (eq > 0) flags[key] = a.slice(eq + 1);
      else if (BOOL.has(key) || i + 1 >= argv.length) flags[key] = true;
      else flags[key] = argv[++i];
    } else pos.push(a);
  }
  return { flags, pos };
}

class CliError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function workspaceCtx(env) {
  const { cfg, flags, cwd } = env;
  let name = typeof flags.workspace === 'string' ? flags.workspace : null;
  if (!name) {
    const r = resolveWorkspace(cfg, cwd);
    if (r.status !== 'mapped') throw new CliError(2, 'not in a workspace: run brain init');
    name = r.name;
  }
  if (!cfg.workspaces[name]) throw new CliError(2, `unknown workspace: ${name}`);
  try {
    vault.ensureVault(cfg, name, { cfgFile: env.cfgFile });
  } catch (e) {
    if (e.message === 'language-required') throw new CliError(4, `language-required: run: brain init ${name} --language <code>`);
    throw e;
  }
  const v = config.vaultPathFor(cfg, name);
  return {
    name,
    ctx: { vault: v, boardFile: path.join(v, config.boardPathFor(cfg, name)), lang: vault.languageFor(cfg, name) || 'en', sid: typeof flags.session === 'string' ? flags.session : undefined },
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

function cmdItems(env, kind, sub, args) {
  const { name: ws, ctx } = workspaceCtx(env);
  const { flags } = env;
  const project = typeof flags.project === 'string' ? flags.project : projectFor(env.cfg, ws, env.cwd);
  const itemName = () => requireArg(args[0], 'name');
  switch (sub) {
    case 'add': {
      const title = requireArg(args.join(' '), 'title');
      const r = kind === 'feature'
        ? tasks.addFeature(ctx, { title, project, lifecycle: typeof flags.lifecycle === 'string' ? flags.lifecycle : undefined })
        : tasks.addItem(ctx, kind, { title, project, feature: typeof flags.feature === 'string' ? flags.feature : undefined, status: typeof flags.status === 'string' ? flags.status : 'todo' });
      return out(env, { name: r.name, file: r.file }, `${kind} added: ${r.name} → ${rel(ctx, r.file)}`);
    }
    case 'list': {
      if (kind === 'feature') throw new CliError(2, 'use: brain search --type feature');
      const items = tasks.listItems(ctx, { kind, status: typeof flags.status === 'string' ? flags.status : undefined, project: typeof flags.project === 'string' ? flags.project : undefined, blocked: flags.blocked ? true : undefined });
      return out(env, items, items.length ? items.map((i) => `- ${i.name} [${i.status}]${i.blocked ? ' 🔒' : ''}${i.project ? ` (${i.project})` : ''}`).join('\n') : 'nothing');
    }
    case 'show': {
      const max = flags['max-chars'] ? Number(flags['max-chars']) : 4000;
      const text = tasks.showItem(ctx, itemName(), { section: typeof flags.section === 'string' ? flags.section : undefined, maxChars: max > 0 ? max : 4000 });
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
      return out(env, r, `synced: ${r.statusChanged} status, ${r.notesCreated} notes, ${r.cardsAdded} cards, ${r.cardsRouted} routed${r.featureCards.length ? `; cards on features (turn them into tasks): ${r.featureCards.join(', ')}` : ''}`);
    }
    default:
      throw new CliError(2, `unknown ${kind} command: ${sub || '(none)'}`);
  }
}

function cmdInit(env, args) {
  const { cfg, flags, cwd } = env;
  const name = requireArg(args[0], 'workspace name');
  config.assertWorkspaceName(name);
  if (!cfg.workspaces[name]) {
    cfg.workspaces[name] = { paths: [cwd] };
    config.saveConfig(cfg, env.cfgFile);
  }
  try {
    const r = vault.ensureVault(cfg, name, { language: typeof flags.language === 'string' ? flags.language : undefined, cfgFile: env.cfgFile });
    return out(env, { workspace: name, vault: r.vault }, `brain active: ${name} → ${r.vault}`);
  } catch (e) {
    if (e.message === 'language-required') throw new CliError(4, `language-required: run: brain init ${name} --language <code>`);
    throw e;
  }
}

const ERRORS = {
  'name-taken': (e) => new CliError(6, `name taken: ${e.file}`),
  'not-found': () => new CliError(2, 'not found'),
  'not-an-item': () => new CliError(2, 'not a task or issue'),
  'bad-status': () => new CliError(2, 'bad status: use todo | in-progress | completed | discarded'),
  'bad-kind': () => new CliError(2, 'bad kind'),
  'empty-title': () => new CliError(2, 'empty title'),
  'invalid-workspace-name': () => new CliError(2, 'invalid workspace name: letters, digits, - and _'),
  'invalid-config': () => new CliError(2, `invalid config file: ${config.configPath()}`),
};

async function main(argv, io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  const cwd = io.cwd || process.cwd();
  const { flags, pos } = parseArgs(argv);
  const cfgFile = typeof flags.config === 'string' ? flags.config : config.configPath();
  try {
    const cfg = config.loadConfig(cfgFile);
    const env = { cfg, cfgFile, flags, cwd, stdout, stderr };
    const [cmd, sub, ...rest] = pos;
    switch (cmd) {
      case 'task':
      case 'issue':
      case 'feature':
        cmdItems(env, cmd, sub, rest);
        return 0;
      case 'init':
        cmdInit(env, [sub, ...rest].filter((x) => x !== undefined));
        return 0;
      default:
        throw new CliError(2, `usage: brain <task|issue|feature|init> … (got: ${cmd || 'nothing'})`);
    }
  } catch (e) {
    const err = e instanceof CliError ? e : ERRORS[e.message] ? ERRORS[e.message](e) : null;
    if (!err) {
      stderr.write(`error: ${e.message}\n`);
      return 1;
    }
    stderr.write(err.message + '\n');
    return err.code;
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}

module.exports = { main, parseArgs, CliError, workspaceCtx, out, requireArg, ERRORS };
