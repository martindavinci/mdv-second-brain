'use strict';
// What waits for the user in a workspace: commits and tags to push, a working tree left dirty, failing playbook
// checks, outgrown hubs, a plugin installed behind its repo, questions queued by sessions, stalled items, the vault's
// own commits. Computed from facts (repos are only read), kept in <vault>/.brain/attention.json (never committed).
// Every command in an item is built here from those facts; nothing is ever taken from a note or run.
//
// Ids: an item is an episode of a key (kind + repo + ref). While the key stays in the queue it keeps its id and
// firstSeen; once it is gone (solved) and comes back, it is a new episode with a new id, so readers notify again.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const git = require('./git');
const lock = require('./lock');
const { normalize } = require('./paths');

const DAY = 86400000;
const DIRTY_DAYS = 3;
const VAULT_DAYS = 3;
const STALLED_DAYS = 14;
const MAIN = new Set(['main', 'master']);
const INFO = new Set(['stale-hub', 'playbook-suggestion', 'stalled', 'vault-unpushed']);
// the only kind the CLI cannot see solved: it leaves the queue with `attention done`
const DONE_KINDS = new Set(['question']);
const MAX_TITLE = 200;

const cacheFile = (vault) => path.join(vault, '.brain', 'attention.json');
const questionsFile = (vault) => path.join(vault, '.brain', 'questions.json');
const clip = (s, n = MAX_TITLE) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Readers never see half a file: a temp file next to it, then a rename (retried: on Windows a reader holding the
// file open makes the rename fail for a moment).
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, text);
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      if (i >= 10 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) {
        fs.rmSync(tmp, { force: true });
        throw e;
      }
      sleep(20);
    }
  }
}

// --- commands built from facts ---

// A double-quoted argument, or null when some shell would expand a character of it inside double quotes.
const UNSAFE = /["`$!%\r\n]/;
const quote = (s) => (typeof s !== 'string' || !s || UNSAFE.test(s) ? null : `"${s}"`);
// branch, tag, remote and plugin names that read the same in every shell and are never an option
const PLAIN = /^[A-Za-z0-9_][A-Za-z0-9._/+@-]*$/;
const plain = (s) => (typeof s === 'string' && PLAIN.test(s) ? s : null);
const arg = (s) => plain(s) || quote(s);

function copy(label, parts) {
  return parts.every((p) => p) ? { type: 'copy', label, value: parts.join(' ') } : null;
}

const openFolder = (dir) => ({ type: 'open-folder', label: 'Open folder', path: dir });
const openNote = (label, file) => ({ type: 'open-note', label, path: file });

// `node "<brain.js>" [--config "<file>"] --workspace <ws> <args…>`, or null when a part is not safe to copy.
function brainCommand({ cli = path.join(__dirname, '..', 'brain.js'), cfgFile, ws }) {
  return (label, args) => copy(label, ['node', quote(cli), ...(cfgFile ? ['--config', quote(cfgFile)] : []), '--workspace', plain(ws), ...args.map(arg)]);
}

// --- items ---

function item(kind, { repo = null, ref = '', project = null, title, detail = '', actions = [] }) {
  return { kind, severity: INFO.has(kind) ? 'info' : 'action', repo, ref: ref || '', project, title: clip(title), detail, actions: actions.filter(Boolean) };
}

const keyOf = (it) => [it.kind, it.repo ? normalize(it.repo) : '', it.ref || ''].join('\u0000');
const idOf = (key, start) => crypto.createHash('sha1').update(`${key}\u0000${start}`).digest('hex').slice(0, 12);

function tryGit(dir, args) {
  try {
    return git.run(dir, args);
  } catch {
    return null;
  }
}

// Branch, upstream, commits ahead and changed paths in one git call; null when git cannot read the repo.
function repoStatus(dir) {
  let out;
  try {
    out = git.runRaw(dir, ['--no-optional-locks', 'status', '--porcelain=v2', '--branch', '-z']);
  } catch {
    return null;
  }
  const s = { oid: null, branch: null, upstream: null, ahead: null, changed: [] };
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p) continue;
    const field = (name) => (p.startsWith(`# branch.${name} `) ? p.slice(`# branch.${name} `.length) : null);
    if (field('oid') !== null) s.oid = field('oid') === '(initial)' ? null : field('oid');
    else if (field('head') !== null) s.branch = field('head') === '(detached)' ? null : field('head');
    else if (field('upstream') !== null) s.upstream = field('upstream');
    else if (field('ab') !== null) {
      const m = /^\+(\d+) -(\d+)$/.exec(field('ab'));
      if (m) s.ahead = Number(m[1]);
    } else if (p.startsWith('# ')) continue;
    else if (p[0] === '1') s.changed.push(p.split(' ').slice(8).join(' '));
    else if (p[0] === '2') {
      s.changed.push(p.split(' ').slice(9).join(' '));
      i++; // the path it was renamed from
    } else if (p[0] === 'u') s.changed.push(p.split(' ').slice(10).join(' '));
    else if (p[0] === '?') s.changed.push(p.slice(2));
  }
  return s;
}

const remotesOf = (dir) => (tryGit(dir, ['remote']) || '').split('\n').map((x) => x.trim()).filter(Boolean);

// `origin/main` → { remote: 'origin', branch: 'main' } (a remote's own name may not hold a slash here).
function splitUpstream(upstream) {
  const i = upstream.indexOf('/');
  return i > 0 ? { remote: upstream.slice(0, i), branch: upstream.slice(i + 1) } : null;
}

function pushCommand(dir, branch, upstream) {
  const u = splitUpstream(upstream);
  if (!u) return null;
  const refspec = u.branch === branch ? plain(branch) : plain(branch) && plain(u.branch) && `${branch}:${u.branch}`;
  return copy('Push', ['git', '-C', quote(dir), 'push', plain(u.remote), refspec]);
}

function oldestChange(dir, changed) {
  let oldest = Infinity;
  for (const f of changed) {
    try {
      oldest = Math.min(oldest, fs.statSync(path.join(dir, f)).mtimeMs);
    } catch {}
  }
  return oldest;
}

function repoItems(r, now) {
  const s = repoStatus(r.dir);
  if (!s) return [];
  const out = [];
  const base = { repo: r.dir, project: r.project };
  if (s.oid && s.branch && s.upstream && s.ahead) {
    out.push(item('unpushed', { ...base, ref: s.branch, title: `${r.project}: ${plural(s.ahead, 'commit')} to push (${s.branch})`, detail: `${s.branch} is ${s.ahead} ahead of ${s.upstream}`, actions: [pushCommand(r.dir, s.branch, s.upstream), openFolder(r.dir)] }));
  } else if (s.oid && s.branch && !s.upstream && MAIN.has(s.branch)) {
    // a repo that never had a remote is local on purpose: nothing to push to
    const remotes = remotesOf(r.dir);
    if (remotes.length) {
      const remote = remotes.includes('origin') ? 'origin' : remotes[0];
      out.push(item('no-upstream', { ...base, ref: s.branch, title: `${r.project}: ${s.branch} has no upstream`, detail: `${s.branch} does not track a branch of ${remote}`, actions: [copy('Push and track', ['git', '-C', quote(r.dir), 'push', '-u', plain(remote), plain(s.branch)]), openFolder(r.dir)] }));
    }
  }
  if (s.changed.length) {
    const oldest = oldestChange(r.dir, s.changed);
    const days = Math.floor((now - oldest) / DAY);
    if (Number.isFinite(oldest) && now - oldest > DIRTY_DAYS * DAY) {
      out.push(item('dirty', { ...base, title: `${r.project}: uncommitted changes for ${days} days`, detail: `${plural(s.changed.length, 'changed path')}, the oldest change ${days} days ago`, actions: [copy('Status', ['git', '-C', quote(r.dir), 'status']), openFolder(r.dir)] }));
    }
  }
  return out;
}

// Outgrown hubs, failing playbook checks and playbook suggestions of the projects with a hub.
function hubItems(vault, repos, brain) {
  const stale = require('./stale');
  const pb = require('./playbooks');
  const projects = require('./projects');
  const pbs = pb.loadPlaybooks(vault);
  const out = [];
  for (const r of repos) {
    const hubFile = projects.findHub(vault, r.project);
    if (!hubFile) continue;
    const base = { repo: r.dir, project: r.project };
    const openHub = openNote('Open hub', hubFile);
    const s = stale.check(vault, r);
    if (s) out.push(item('stale-hub', { ...base, title: `${r.project}: the hub is outgrown by its repo`, detail: stale.message(s), actions: [openHub] }));
    if (!pbs.size) continue;
    const hub = pb.hubData(vault, r.project) || {};
    for (const res of pb.run(vault, hub, r.dir, pbs)) {
      if (!res.missing && !res.failed.length) continue;
      const title = res.missing ? `${r.project}: playbook ${res.playbook} not found` : `${r.project}: ${plural(res.failed.length, 'check')} of ${res.playbook} failing`;
      const detail = res.missing ? `the hub follows ${res.playbook}, which is not a playbook in ${pb.NOTES}/` : res.failed.map((f) => `${f.id}${f.units[0] !== '.' ? ` (${f.units.join(', ')})` : ''}`).join(', ');
      out.push(item('playbook', { ...base, ref: res.playbook, title, detail, actions: [brain('Show the checks', ['check', r.project]), openHub] }));
    }
    for (const name of pb.suggest(vault, hub, r.dir, pbs)) {
      const p = pbs.get(name.toLowerCase());
      out.push(item('playbook-suggestion', { ...base, ref: name, title: `${r.project}: looks like a project for the playbook ${name}`, detail: 'the hub does not follow it; link it only if it applies', actions: [p && openNote('Open playbook', p.file), openHub] }));
    }
  }
  return out;
}

function versionOf(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(String(v || '').trim());
  return m ? { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] || null } : null;
}

// > 0 when a is newer than b; 0 when equal or either is not a version.
function compareVersions(a, b) {
  const x = versionOf(a);
  const y = versionOf(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] - y.nums[i];
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

// Claude Code plugins whose repo is in the workspace and released (its plugin.json version) past the installed one.
function pluginItems(repos, home) {
  const installed = readJson(path.join(home, '.claude', 'plugins', 'installed_plugins.json'));
  const plugins = installed && installed.plugins && typeof installed.plugins === 'object' ? installed.plugins : {};
  const out = [];
  for (const r of repos) {
    const manifest = readJson(path.join(r.dir, '.claude-plugin', 'plugin.json'));
    if (!manifest || typeof manifest.name !== 'string' || typeof manifest.version !== 'string') continue;
    for (const [key, installs] of Object.entries(plugins)) {
      if (key.split('@')[0] !== manifest.name || !Array.isArray(installs)) continue;
      const versions = installs.map((i) => i && i.version).filter((v) => typeof v === 'string' && versionOf(v));
      if (!versions.length) continue;
      const lowest = versions.sort(compareVersions)[0];
      if (compareVersions(manifest.version, lowest) <= 0) continue;
      out.push(item('plugin-behind', { repo: r.dir, ref: key, project: r.project, title: `${r.project}: plugin installed at ${lowest}, released ${manifest.version}`, detail: `${key} is installed at ${lowest}; the repo released ${manifest.version}`, actions: [copy('Update', ['claude', 'plugin', 'update', plain(key)]), openFolder(r.dir)] }));
    }
  }
  return out;
}

function stalledItems(ctx, now) {
  return require('./health').stalled(ctx, { now, days: STALLED_DAYS }).map((s) => item('stalled', { ref: path.relative(ctx.vault, s.file).replace(/\\/g, '/'), project: s.project || null, title: `${s.name}: in progress, untouched for ${s.days} days`, detail: `a ${s.kind} in progress whose note has not changed for ${s.days} days`, actions: [openNote('Open note', s.file)] }));
}

// The vault's own repo, only when its oldest commit not on any remote is more than a few days old.
function vaultItems(cfg, ws, vault, now) {
  const v = require('./vault');
  const mode = v.gitModeFor(cfg, ws);
  if (mode === 'none' || mode === 'host') return [];
  const own = v.repoFor(cfg, ws, vault);
  if (!own || !fs.existsSync(own.repo)) return [];
  const s = repoStatus(own.repo);
  if (!s || !s.oid || !s.branch) return [];
  const remotes = remotesOf(own.repo);
  if (!remotes.length) return [];
  const log = tryGit(own.repo, ['log', '--format=%ct', ...(s.upstream ? ['@{u}..HEAD'] : ['HEAD', '--not', '--remotes'])]);
  const times = (log || '').split('\n').filter(Boolean).map((x) => Number(x) * 1000);
  if (!times.length) return [];
  const age = now - Math.min(...times);
  if (age <= VAULT_DAYS * DAY) return [];
  const remote = remotes.includes('origin') ? 'origin' : remotes[0];
  const push = s.upstream ? pushCommand(own.repo, s.branch, s.upstream) : copy('Push', ['git', '-C', quote(own.repo), 'push', '-u', plain(remote), plain(s.branch)]);
  return [item('vault-unpushed', { repo: own.repo, title: `vault: ${plural(times.length, 'commit')} to push`, detail: `the oldest is ${Math.floor(age / DAY)} days old`, actions: [push, openFolder(own.repo)] })];
}

// --- questions queued by sessions (<vault>/.brain/questions.json) ---

function readQuestions(vault) {
  const list = readJson(questionsFile(vault));
  return Array.isArray(list) ? list.filter((q) => q && typeof q.id === 'string' && typeof q.text === 'string') : [];
}

function addQuestion(vault, { session = null, text, project = null, now = new Date() }) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) throw new Error('empty-question');
  return lock.withLock(vault, () => {
    const at = now.toISOString();
    const q = { id: idOf(['question', '', `${session}\u0000${t}`].join('\u0000'), at), session, text: t, at, ...(project ? { project } : {}) };
    writeAtomic(questionsFile(vault), JSON.stringify([...readQuestions(vault), q], null, 2) + '\n');
    return q;
  });
}

// A question's id and firstSeen are its own: it never leaves the queue by itself, so it is one episode.
function questionItems(vault, brain = () => null) {
  return readQuestions(vault).map((q) => ({
    ...item('question', { ref: q.id, project: q.project || null, title: q.text, detail: `queued ${String(q.at).slice(0, 10)}${q.session ? ` by session ${String(q.session).slice(0, 8)}` : ''}`, actions: [brain('Mark as answered', ['attention', 'done', q.id])] }),
    id: q.id,
    start: q.at,
  }));
}

function collectLocal(ctx, cfg, ws, opts = {}) {
  const now = opts.now || new Date();
  const brain = opts.brain || brainCommand({ cli: opts.cli, cfgFile: opts.cfgFile, ws });
  const repos = require('./repos').discover(cfg, ws, ctx.vault).filter((r) => !r.reason);
  const out = [];
  if (git.available()) {
    for (const r of repos) out.push(...repoItems(r, now));
    out.push(...vaultItems(cfg, ws, ctx.vault, now));
  }
  out.push(...hubItems(ctx.vault, repos, brain));
  out.push(...pluginItems(repos, opts.home || os.homedir()));
  out.push(...stalledItems(ctx, now));
  out.push(...questionItems(ctx.vault, brain));
  return out;
}

// --- episodes and the cache ---

function computeEpisodes(prev, items, now = new Date()) {
  const eps = (prev && prev.episodes) || {};
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = keyOf(it);
    if (seen.has(key)) continue;
    seen.add(key);
    const { start, ...rest } = it;
    const e = eps[key];
    if (e && (!it.id || e.id === it.id)) out.push({ ...rest, id: e.id, firstSeen: e.firstSeen });
    else {
      const first = start || now.toISOString();
      out.push({ ...rest, id: it.id || idOf(key, first), firstSeen: first });
    }
  }
  return out;
}

// Snoozes and done marks follow their item; once it is gone they are dropped with its episode.
function buildCache(prev, items, now = new Date(), remote = { ok: false, reason: 'not-checked' }, extra = {}) {
  const ids = new Set(items.map((i) => i.id));
  const snoozed = {};
  for (const [id, until] of Object.entries((prev && prev.snoozed) || {})) if (ids.has(id) && Date.parse(until) > now.getTime()) snoozed[id] = until;
  const done = ((prev && prev.done) || []).filter((id) => ids.has(id));
  const episodes = {};
  for (const it of items) episodes[keyOf(it)] = { id: it.id, firstSeen: it.firstSeen };
  return { version: 1, at: now.toISOString(), remote, items, snoozed, done, episodes, ...extra };
}

function readCache(vault) {
  const c = readJson(cacheFile(vault));
  return c && typeof c === 'object' && Array.isArray(c.items) ? { snoozed: {}, done: [], episodes: {}, ...c } : null;
}

function writeCache(vault, cache) {
  writeAtomic(cacheFile(vault), JSON.stringify(cache, null, 2) + '\n');
}

function visible(cache, now = new Date()) {
  if (!cache) return [];
  const snoozed = cache.snoozed || {};
  const done = new Set(cache.done || []);
  return cache.items.filter((i) => !done.has(i.id) && !(snoozed[i.id] && Date.parse(snoozed[i.id]) > now.getTime()));
}

function snooze(vault, id, until) {
  return lock.withLock(vault, () => {
    const cache = readCache(vault);
    if (!cache || !cache.items.some((i) => i.id === id)) throw Object.assign(new Error('unknown-item'), { id });
    cache.snoozed = { ...cache.snoozed, [id]: until.toISOString() };
    writeCache(vault, cache);
    return { id, until: cache.snoozed[id] };
  });
}

function done(vault, id) {
  return lock.withLock(vault, () => {
    const questions = readQuestions(vault);
    const cache = readCache(vault);
    if (!questions.some((q) => q.id === id)) {
      const it = cache && cache.items.find((i) => i.id === id);
      if (it && !DONE_KINDS.has(it.kind)) throw Object.assign(new Error('not-a-question'), { id, kind: it.kind });
      throw Object.assign(new Error('unknown-item'), { id });
    }
    writeAtomic(questionsFile(vault), JSON.stringify(questions.filter((q) => q.id !== id), null, 2) + '\n');
    if (cache && cache.items.some((i) => i.id === id)) {
      cache.done = [...new Set([...(cache.done || []), id])];
      writeCache(vault, cache);
    }
    return { id };
  });
}

module.exports = {
  DONE_KINDS, cacheFile, questionsFile, writeAtomic, brainCommand, compareVersions, repoStatus,
  collectLocal, questionItems, addQuestion, readQuestions, computeEpisodes, buildCache, readCache, writeCache, visible, snooze, done,
};
