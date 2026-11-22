'use strict';
// Hubs the repo has outgrown: a new tag, or more than 20 commits, since the hub's own text last changed. The generated
// sections (Repo, project index) and the frontmatter do not count, or every hub would look fresh. `brain index` and
// `brain commit` record, for each hub, a hash of its text and the repo's HEAD when that text last changed
// (.brain/hubs.json). Repos are only read.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const frontmatter = require('./frontmatter');
const git = require('./git');
const projects = require('./projects');

const MAX_COMMITS = 20;
const GENERATED = /<!-- brain:([\w-]+) -->[\s\S]*?<!-- \/brain:\1 -->/g;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const recordFile = (vault) => path.join(vault, '.brain', 'hubs.json');

function read(vault) {
  try {
    return JSON.parse(fs.readFileSync(recordFile(vault), 'utf8'));
  } catch {
    return {};
  }
}

function hubOf(vault, project) {
  const file = projects.findHub(vault, project);
  if (!file) return null;
  const { data, body } = frontmatter.parse(fs.readFileSync(file, 'utf8'));
  const text = body.replace(GENERATED, '').replace(/\s+/g, ' ').trim();
  return { file, data, hash: crypto.createHash('sha1').update(text).digest('hex') };
}

// null: git cannot read the repo (missing, another account's, a commit that no longer exists); '' is a real empty output
function tryGit(dir, args) {
  if (!fs.existsSync(path.join(dir, '.git'))) return null;
  try {
    return git.run(dir, args);
  } catch {
    return null;
  }
}

// A hub never tracked: the repo as it was at the end of its `updated` (or `created`) day; '' = before the first commit.
function baseline(dir, data) {
  const day = [data.updated, data.created].map((d) => String(d || '')).find((d) => DAY.test(d));
  if (!day) return tryGit(dir, ['rev-parse', 'HEAD']);
  return tryGit(dir, ['rev-list', '-1', `--before=${day} 23:59:59`, 'HEAD']);
}

// `brain index` / `brain commit`: a hub whose text changed starts again from the repo's current HEAD.
function track(vault, repos) {
  const rec = read(vault);
  let changed = false;
  for (const r of repos) {
    const hub = hubOf(vault, r.project);
    if (!hub) continue;
    const e = rec[r.project];
    if (e && e.hash === hub.hash) continue;
    const head = e ? tryGit(r.dir, ['rev-parse', 'HEAD']) : baseline(r.dir, hub.data);
    if (head === null) continue;
    rec[r.project] = { hash: hub.hash, head };
    changed = true;
  }
  if (!changed) return;
  fs.mkdirSync(path.dirname(recordFile(vault)), { recursive: true });
  fs.writeFileSync(recordFile(vault), JSON.stringify(rec, null, 2) + '\n');
}

function check(vault, r) {
  const hub = hubOf(vault, r.project);
  if (!hub) return null;
  const e = read(vault)[r.project];
  // text changed since the last index: just rewritten
  if (e && e.hash !== hub.hash) return null;
  const head = e ? e.head : baseline(r.dir, hub.data);
  if (head === null || head === undefined) return null;
  const count = tryGit(r.dir, ['rev-list', '--count', head ? `${head}..HEAD` : 'HEAD']);
  if (count === null) return null;
  const commits = Number(count) || 0;
  const tagged = tryGit(r.dir, ['tag', '--merged', 'HEAD', ...(head ? ['--no-merged', head] : []), '--sort=creatordate']);
  const tags = (tagged || '').split('\n').filter(Boolean);
  if (!tags.length && commits <= MAX_COMMITS) return null;
  return { project: r.project, hub: path.relative(vault, hub.file).replace(/\\/g, '/'), commits, tags };
}

function message(s) {
  const n = s.tags.length;
  const tags = n ? `${n} new tag${n === 1 ? '' : 's'} (${n === 1 ? s.tags[0] : `${s.tags[0]} … ${s.tags[n - 1]}`}) and ` : '';
  return `stale hub: ${s.hub} — ${tags}${s.commits} commit${s.commits === 1 ? '' : 's'} since its text last changed; check it against the code and rewrite what is no longer true`;
}

module.exports = { MAX_COMMITS, track, check, message, recordFile };
