'use strict';
// The git repos directly under a workspace's folders, as projects: discovery and exclusions, the facts of each repo
// for the hub's generated "## Repo" section, renamed folders, relation candidates and references to sibling folders
// that no longer exist. The repos themselves are only read.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const git = require('./git');
const markers = require('./markers');
const projects = require('./projects');
const { isInside } = require('./paths');
const { resolveWorkspace } = require('./resolve');
const { projectName, unwrapLink } = require('./names');

const recordFile = (vault) => path.join(vault, '.brain', 'repos.json');

// What each bootstrapped repo was (folder, remotes, first commit), so a renamed folder is recognised next time.
function readRecord(vault) {
  try {
    return JSON.parse(fs.readFileSync(recordFile(vault), 'utf8'));
  } catch {
    return {};
  }
}

function writeRecord(vault, record) {
  fs.mkdirSync(path.dirname(recordFile(vault)), { recursive: true });
  fs.writeFileSync(recordFile(vault), JSON.stringify(record, null, 2) + '\n');
}

function exclusion(cfg, ws, dir, vaultDir) {
  if (isInside(dir, vaultDir)) return 'vault';
  const r = resolveWorkspace(cfg, dir);
  if (r.status === 'ignored') return 'ignore';
  // never name the other workspace
  if (r.status === 'mapped' && r.name !== ws) return r.via === 'vault' ? 'vault' : 'other workspace';
  return null;
}

function discover(cfg, ws, vaultDir) {
  const out = [];
  for (const base of (cfg.workspaces[ws] && cfg.workspaces[ws].paths) || []) {
    let entries = [];
    try {
      entries = fs.readdirSync(base, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const dir = path.join(base, e.name);
      if (!fs.existsSync(path.join(dir, '.git'))) continue;
      out.push({ folder: e.name, dir, base, project: projectName(e.name), reason: exclusion(cfg, ws, dir, vaultDir) });
    }
  }
  return out.sort((a, b) => a.folder.localeCompare(b.folder));
}

function tryGit(dir, args) {
  try {
    return git.run(dir, args) || null;
  } catch {
    return null;
  }
}

// Remote URLs without credentials; a remote that is a folder next to the repo becomes ../<folder>.
function cleanRemote(url, dir, base) {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !/^file:/i.test(url)) return { url: url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]*@/i, '$1') };
  if (/^[^/\\@]+@[^:/\\]+:/.test(url) && !/^[A-Za-z]:[\\/]/.test(url)) return { url };
  const abs = path.resolve(dir, url.replace(/^file:\/\/\/?/i, ''));
  if (path.dirname(abs).toLowerCase() === path.resolve(base).toLowerCase()) return { url: `../${path.basename(abs)}`, local: path.basename(abs) };
  const home = os.homedir();
  return { url: isInside(abs, home) ? `~/${path.relative(home, abs).replace(/\\/g, '/')}` : abs.replace(/\\/g, '/') };
}

const MANIFESTS = ['package.json', 'Cargo.toml', 'pyproject.toml', 'requirements.txt', 'go.mod', 'composer.json', 'Gemfile', 'CMakeLists.txt', 'Makefile', 'build.gradle', 'pom.xml', 'Dockerfile'];

function manifests(dir) {
  const files = MANIFESTS.filter((f) => fs.existsSync(path.join(dir, f)));
  try {
    files.push(...fs.readdirSync(dir).filter((f) => /\.(sln|csproj)$/i.test(f)).sort());
  } catch {}
  let scripts = [];
  try {
    scripts = Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).scripts || {});
  } catch {}
  return { files, scripts };
}

function facts(r) {
  const run = (args) => tryGit(r.dir, args);
  const remotes = [];
  for (const line of (run(['remote', '-v']) || '').split('\n')) {
    const m = /^(\S+)\s+(\S+)\s+\(fetch\)$/.exec(line.trim());
    if (m) remotes.push({ name: m[1], ...cleanRemote(m[2], r.dir, r.base) });
  }
  const commits = Number(run(['rev-list', '--count', 'HEAD'])) || 0;
  return {
    remotes,
    branch: run(['branch', '--show-current']),
    commits,
    last: commits ? run(['log', '-1', '--format=%cs']) : null,
    tag: commits ? run(['describe', '--tags', '--abbrev=0']) : null,
    dirty: !!run(['status', '--porcelain']),
    root: commits ? (run(['rev-list', '--max-parents=0', 'HEAD']) || '').split('\n')[0] || null : null,
    manifests: manifests(r.dir),
  };
}

const LABELS = {
  en: { folder: 'Folder', remote: 'Remote', none: 'none', commits: (n) => `${n} commit${n === 1 ? '' : 's'}`, noCommits: 'no commits yet', last: 'last', tree: 'Working tree', clean: 'clean', dirty: 'uncommitted changes', manifests: 'Manifests', scripts: 'scripts' },
  it: { folder: 'Cartella', remote: 'Remote', none: 'nessuno', commits: (n) => `${n} commit`, noCommits: 'nessun commit', last: 'ultimo', tree: 'Working tree', clean: 'pulito', dirty: 'modifiche non committate', manifests: 'Manifest', scripts: 'script' },
};

// Facts only, no date of the run: an unchanged repo leaves its hub unchanged.
function section(lang, r, f) {
  const t = LABELS[lang] || LABELS.en;
  const history = [f.branch && `branch ${f.branch}`, f.commits ? t.commits(f.commits) : t.noCommits, f.last && `${t.last} ${f.last}`, f.tag && `tag ${f.tag}`].filter(Boolean);
  const lines = [
    '## Repo',
    `- ${t.folder}: \`${r.folder}\``,
    `- ${t.remote}: ${f.remotes.length ? f.remotes.map((x) => `${x.name} ${x.url}`).join(' · ') : t.none}`,
    `- ${history.join(' · ')}`,
    `- ${t.tree}: ${f.dirty ? t.dirty : t.clean}`,
  ];
  const m = f.manifests;
  if (m.files.length) lines.push(`- ${t.manifests}: ${m.files.join(', ')}${m.scripts.length ? ` (${t.scripts}: ${m.scripts.slice(0, 12).join(', ')})` : ''}`);
  return lines.join('\n');
}

// The generated section sits before the project index, or at the end of a hub without one.
function setRepoSection(text, content) {
  if (markers.hasSection(text, 'repo') || !markers.hasSection(text, 'project-index')) return markers.setSection(text, 'repo', content);
  const i = text.indexOf(markers.open('project-index'));
  return `${text.slice(0, i)}${markers.open('repo')}\n${content}\n${markers.close('repo')}\n\n${text.slice(i)}`;
}

// --- references to sibling folders ---

const SCAN_EXT = /\.(c?m?[jt]s|jsonc?|toml|ya?ml|ps1|psm1|sh|bash|bat|cmd|py|rb|go|rs|cs|csproj|props|targets|xml|ini|cfg|conf)$/i;
const SCAN_NAMES = new Set(['makefile', 'dockerfile', 'readme.md', 'agents.md', 'claude.md']);
// test fixtures are full of made-up paths
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'target', 'vendor', 'coverage', 'venv', '__pycache__', 'bin', 'obj', 'test', 'tests', '__tests__', 'fixtures']);
const KEEP_HIDDEN = new Set(['.claude', '.github']);
const MAX_FILES = 400;
const MAX_BYTES = 256 * 1024;
// generated or conventional folder names, and file names: a missing one is not worth a report
const NOT_A_SIBLING = /^(dist|build|out|target|node_modules|coverage|tmp|temp|cache|public|lib|bin|obj|docs|src|test|tests|assets|static|logs)$|\.(c?m?[jt]s|json|md|txt|ya?ml|toml|ps1|sh|py|exe|dll|png|jpe?g|svg|html|css|zip|log)$/i;
const DOTDOT = /(?:^|[^.\w/\\])\.\.[\\/]+([A-Za-z0-9][\w.-]*)/g;
const JOINED = /['"]\.\.['"]\s*,\s*['"]([A-Za-z0-9][\w.-]*)['"]/g;

function scanFiles(root) {
  const out = [];
  const walk = (dir, depth) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= MAX_FILES) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < 2 && !SKIP_DIRS.has(e.name) && (!e.name.startsWith('.') || KEEP_HIDDEN.has(e.name))) walk(full, depth + 1);
      } else if (SCAN_EXT.test(e.name) || SCAN_NAMES.has(e.name.toLowerCase())) {
        try {
          if (fs.statSync(full).size <= MAX_BYTES) out.push(full);
        } catch {}
      }
    }
  };
  walk(root, 0);
  return out;
}

// `../<name>` and `'..', '<name>'` in the repo's scripts and config: siblings that exist, and ones that do not.
function siblingRefs(r) {
  const refs = [];
  const broken = [];
  for (const file of scanFiles(r.dir)) {
    const rel = path.relative(r.dir, file).replace(/\\/g, '/');
    const atRoot = path.dirname(file) === r.dir;
    // prose names siblings reliably but also shows examples: it proposes relations, never broken references
    const prose = file.toLowerCase().endsWith('.md');
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    text.split(/\r?\n/).forEach((line, i) => {
      for (const [re, explicit] of [[DOTDOT, false], [JOINED, true]]) {
        for (const m of line.matchAll(re)) {
          const name = m[1].replace(/\.+$/, '');
          if (!name || name.toLowerCase() === r.folder.toLowerCase()) continue;
          // inside the repo: relative to the file, or to the repo root
          if (fs.existsSync(path.resolve(path.dirname(file), '..', name)) && isInside(path.resolve(path.dirname(file), '..', name), r.dir)) continue;
          if (fs.existsSync(path.join(r.dir, name))) continue;
          const where = `${rel}:${i + 1}`;
          if (fs.existsSync(path.join(r.base, name))) refs.push({ name, file: where });
          else if (!prose && (atRoot || explicit) && !NOT_A_SIBLING.test(name)) broken.push({ project: r.project, file: where, ref: `../${name}` });
        }
      }
    });
  }
  return { refs, broken };
}

// --- the plan ---

const pairKey = (a, b) => [a.toLowerCase(), b.toLowerCase()].sort().join('\u0000');

// Relations already in either hub are not proposed again.
function alreadyRelated(vault, a, b) {
  for (const [p, other] of [[a, b], [b, a]]) {
    if (!projects.findHub(vault, p)) continue;
    const rel = projects.relations(vault, p);
    if (Object.values(rel).some((list) => list.some((v) => (unwrapLink(v) || '').toLowerCase() === other.toLowerCase()))) return true;
  }
  return false;
}

function candidates(vault, live) {
  const byFolder = new Map(live.map((r) => [r.folder.toLowerCase(), r]));
  const out = [];
  const seen = new Set();
  const add = (a, rel, b, evidence) => {
    const key = pairKey(a, b);
    if (a.toLowerCase() === b.toLowerCase() || seen.has(key)) return;
    seen.add(key);
    if (!alreadyRelated(vault, a, b)) out.push({ a, rel, b, evidence });
  };
  for (const r of live) {
    const m = /^(.+)-src$/i.exec(r.folder);
    const t = m && byFolder.get(m[1].toLowerCase());
    if (t) add(r.project, 'source_of', t.project, `folders ${r.folder} and ${t.folder}`);
  }
  for (const r of live) {
    for (const x of r.facts.remotes) {
      const s = x.local && byFolder.get(x.local.toLowerCase());
      if (s) add(s.project, 'source_of', r.project, `remote ${x.name} of ${r.folder} → ../${s.folder}`);
    }
  }
  for (const r of live) {
    for (const ref of r.refs) {
      const s = byFolder.get(ref.name.toLowerCase());
      if (s) add(r.project, 'related', s.project, `${r.folder}/${ref.file}`);
    }
  }
  const byRoot = new Map();
  for (const r of live) if (r.facts.root) byRoot.set(r.facts.root, [...(byRoot.get(r.facts.root) || []), r]);
  for (const group of byRoot.values()) for (const r of group.slice(1)) add(group[0].project, 'related', r.project, `same first commit as ${group[0].folder}`);
  return out;
}

// Hubs a previous run recorded as repos whose folder is gone: matched to a new folder by first commit or remote.
function renames(vault, record, repos) {
  const present = new Set(repos.map((r) => r.folder.toLowerCase()));
  const gone = Object.entries(record).filter(([p, rec]) => projects.findHub(vault, p) && !present.has(String(rec.folder).toLowerCase()));
  const proposals = [];
  const orphans = [];
  for (const [p, rec] of gone) {
    const match = repos.filter((r) => r.status === 'new' && ((rec.root && r.facts.root === rec.root) || r.facts.remotes.some((x) => (rec.remotes || []).includes(x.url))));
    if (match.length === 1) {
      const r = match[0];
      r.status = 'renamed';
      r.from = p;
      proposals.push({ from: p, to: r.project, by: rec.root && r.facts.root === rec.root ? 'first commit' : 'remote' });
    } else orphans.push(p);
  }
  return { proposals, orphans };
}

function plan(cfg, ws, ctx) {
  const tasks = require('./tasks');
  const repos = discover(cfg, ws, ctx.vault).map((r) => {
    if (r.reason) return { ...r, status: 'excluded' };
    const hub = projects.projectsWithHub(ctx.vault).find((p) => p.toLowerCase() === r.project.toLowerCase());
    if (hub) return { ...r, project: hub, status: 'existing' };
    const taken = tasks.findNote(ctx.vault, r.project);
    if (taken) return { ...r, status: 'name-taken', takenBy: path.relative(ctx.vault, taken).replace(/\\/g, '/') };
    return { ...r, status: 'new' };
  });
  const live = repos.filter((r) => r.status !== 'excluded');
  const broken = [];
  for (const r of live) {
    r.facts = facts(r);
    const s = siblingRefs(r);
    r.refs = s.refs;
    broken.push(...s.broken);
  }
  const { proposals, orphans } = renames(ctx.vault, readRecord(ctx.vault), live);
  return { repos, renames: proposals, orphans, candidates: candidates(ctx.vault, live.filter((r) => r.status !== 'name-taken')), broken };
}

// New hubs, every hub's Repo section regenerated, the record refreshed. A folder waiting for a rename stays out.
function apply(ctx, p) {
  const tasks = require('./tasks');
  const record = readRecord(ctx.vault);
  const created = [];
  const refreshed = [];
  for (const r of p.repos) {
    if (r.status !== 'new' && r.status !== 'existing') continue;
    if (r.status === 'new') {
      tasks.addProjectHub(ctx, r.project);
      created.push(r.project);
    } else refreshed.push(r.project);
    const hub = projects.findHub(ctx.vault, r.project);
    const text = fs.readFileSync(hub, 'utf8');
    const next = setRepoSection(text, section(ctx.lang, r, r.facts));
    if (next !== text) fs.writeFileSync(hub, next);
    record[r.project] = { folder: r.folder, remotes: r.facts.remotes.map((x) => x.url), root: r.facts.root };
  }
  for (const p2 of Object.keys(record)) if (!projects.findHub(ctx.vault, p2)) delete record[p2];
  writeRecord(ctx.vault, record);
  return { created, refreshed };
}

// The lines a person reads; the JSON output carries the same plan.
function describe(p, { dryRun }) {
  const count = (s) => p.repos.filter((r) => r.status === s).length;
  const lines = [`bootstrap${dryRun ? ' (dry run)' : ''}: ${count('new')} new, ${count('existing')} existing, ${count('excluded')} excluded`];
  for (const r of p.repos) {
    if (r.status === 'new') lines.push(`+ ${r.project} — new${dryRun ? '' : ', hub created'}`);
    else if (r.status === 'existing') lines.push(`= ${r.project} — hub exists${dryRun ? '' : ', Repo section refreshed'}`);
    else if (r.status === 'excluded') lines.push(`- ${r.folder} — excluded (${r.reason})`);
    else if (r.status === 'name-taken') lines.push(`! ${r.project} — name taken by ${r.takenBy}: no hub`);
    else if (r.status === 'renamed') lines.push(`? ${r.project} — looks like ${r.from} renamed`);
  }
  for (const x of p.renames) lines.push(`rename? ${x.from} → ${x.to} (same ${x.by}) — after the user confirms: brain project rename "${x.from}" "${x.to}"`);
  for (const o of p.orphans) lines.push(`orphan: ${o} — hub without its repo folder`);
  for (const c of p.candidates) lines.push(`relation? ${c.a} ${c.rel} ${c.b} — ${c.evidence}`);
  for (const b of p.broken) lines.push(`broken ref: ${b.project} ${b.file} → ${b.ref} (folder missing; to verify)`);
  return lines.join('\n');
}

// For `brain status`: no git, only folders, hubs and the record. A repo whose name another note took never gets a
// hub, so it is not counted.
function quickCheck(cfg, ws, vault) {
  const tasks = require('./tasks');
  const repos = discover(cfg, ws, vault).filter((r) => !r.reason);
  const hubs = projects.projectsWithHub(vault).map((p) => p.toLowerCase());
  const folders = new Set(repos.map((r) => r.folder.toLowerCase()));
  const withoutHub = repos.filter((r) => !hubs.includes(r.project.toLowerCase()) && !tasks.findNote(vault, r.project)).length;
  const orphans = Object.entries(readRecord(vault)).filter(([p, rec]) => projects.findHub(vault, p) && !folders.has(String(rec.folder).toLowerCase())).length;
  return { withoutHub, orphans };
}

module.exports = { discover, facts, section, setRepoSection, siblingRefs, plan, apply, describe, quickCheck, readRecord, writeRecord, recordFile };
