'use strict';
// Vault check: broken [[links]], orphan notes, stale in-progress items, notes without frontmatter, duplicate names,
// empty folders. Only certain fixes are applied (--fix): a link with exactly one matching note, an empty folder.
const fs = require('node:fs');
const path = require('node:path');
const { DIRS } = require('./vault');
const tasks = require('./tasks');
const { noteName, parseYmd } = require('./names');

const DAY = 86400000;
const lower = (s) => String(s).normalize('NFC').toLowerCase();
const relOf = (vault, f) => path.relative(vault, f).replace(/\\/g, '/');
// accents and separators folded: "payments-refunds", "Payments Refunds" and "payments refunds" compare equal
const fold = (s) => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
// a folded match is certain only when folding dropped separators, never meaning ("C++" is not "C")
const PLAIN = /^[\p{L}\p{N}\s._-]+$/u;
const LINK = /(!?)\[\[([^\]\n]+?)\]\]/g;

function walk(dir, onFile, onDir) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(full, onFile, onDir);
      if (onDir) onDir(full);
    } else onFile(full);
  }
}

// Every [[link]] outside code (fences, inline code), frontmatter included, with its place in the text.
function linksOf(text) {
  const out = [];
  let fence = false;
  let offset = 0;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    else if (!fence) {
      const masked = line.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length));
      for (const m of masked.matchAll(LINK)) {
        const inner = line.slice(m.index + m[1].length + 2, m.index + m[0].length - 2);
        const bar = inner.indexOf('|');
        const ref = (bar >= 0 ? inner.slice(0, bar) : inner).replace(/\\$/, '');
        const target = ref.split('#')[0].trim();
        // [[…]] in prose is notation, not a link
        if (fold(target)) out.push({ start: offset + m.index + m[1].length, end: offset + m.index + m[0].length, target, alias: bar >= 0 ? inner.slice(bar + 1) : null });
      }
    }
    offset += line.length + 1;
  }
  return out;
}

function inventory(vault) {
  const live = [];
  const all = new Map(); // lower name → [files], archive included
  const attachments = new Set();
  const add = (f) => {
    if (f.endsWith('.md')) {
      const k = lower(path.basename(f, '.md'));
      all.set(k, [...(all.get(k) || []), f]);
    } else attachments.add(lower(path.basename(f)));
  };
  walk(vault, (f) => {
    add(f);
    const r = relOf(vault, f);
    if (f.endsWith('.md') && !r.startsWith('90_Archive/') && !r.startsWith('80_Assets/')) live.push(f);
  });
  return { live, all, attachments };
}

function resolves(inv, target) {
  const base = target.split('/').pop();
  // a dotted name ("Release 0.3.0") is a note first, then a file with that extension
  return inv.all.has(lower(base.replace(/\.md$/i, ''))) || inv.attachments.has(lower(base));
}

// The note a broken link certainly means, or the candidates a person has to choose from.
function suggest(inv, target, folded) {
  const base = target.split('/').pop().replace(/\.md$/i, '');
  const name = (k) => path.basename(inv.all.get(k)[0], '.md');
  let clean = null;
  try {
    clean = lower(noteName(base));
  } catch {}
  if (clean && inv.all.has(clean) && inv.all.get(clean).length === 1) return { to: name(clean) };
  const f = fold(base);
  const candidates = f ? (folded.get(f) || []).map(name) : [];
  if (candidates.length === 1 && PLAIN.test(base.normalize('NFD').replace(/\p{M}/gu, ''))) return { to: candidates[0] };
  return { candidates: candidates.sort() };
}

function isOrphanCandidate(rel) {
  if (!rel.includes('/')) return false; // Home, AGENTS, MEMORY…
  if (rel.startsWith('00_Inbox/')) return false;
  if (/^20_Projects\/[^/]+\.md$/.test(rel)) return false; // hubs are entry points
  return !rel.endsWith('.local.md');
}

function itemDate(file, data) {
  const d = parseYmd(data.updated) || parseYmd(data.created);
  if (d) return d;
  try {
    return fs.statSync(file).mtime;
  } catch {
    return null;
  }
}

function check(ctx, { now = new Date(), days = 14, fix = false } = {}) {
  const vault = ctx.vault;
  const inv = inventory(vault);
  const folded = new Map();
  for (const k of inv.all.keys()) {
    const f = fold(k);
    if (f) folded.set(f, [...(folded.get(f) || []), k]);
  }
  const liveSet = new Set(inv.live);
  const broken = [];
  const fixed = [];
  const incoming = new Set();
  for (const file of [...inv.live, ...[...inv.all.values()].flat().filter((f) => !liveSet.has(f))]) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const rel = relOf(vault, file);
    const isLive = liveSet.has(file);
    const edits = [];
    const fmEnd = text.startsWith('---') ? text.indexOf('\n---', 3) : -1;
    for (const l of linksOf(text)) {
      const base = lower(l.target.split('/').pop().replace(/\.md$/i, ''));
      if (path.basename(file, '.md').toLowerCase() !== base) incoming.add(base);
      if (!isLive || resolves(inv, l.target)) continue;
      const s = suggest(inv, l.target, folded);
      if (s.to && fix) {
        // body links keep the text they showed; frontmatter values stay plain links
        const shown = l.alias !== null ? l.alias : l.target;
        edits.push({ ...l, text: l.start < fmEnd ? `[[${s.to}]]` : `[[${s.to}|${shown}]]` });
        fixed.push({ file: rel, target: l.target, to: s.to });
        incoming.add(lower(s.to));
      } else broken.push({ file: rel, target: l.target, ...(s.to ? { fix: s.to, candidates: [] } : { candidates: s.candidates }) });
    }
    if (edits.length) {
      let out = text;
      for (const e of edits.reverse()) out = out.slice(0, e.start) + e.text + out.slice(e.end);
      fs.writeFileSync(file, out);
    }
  }

  const orphans = inv.live.map((f) => relOf(vault, f)).filter((r) => isOrphanCandidate(r) && !incoming.has(lower(path.basename(r, '.md')))).sort();

  const stale = [];
  for (const i of tasks.listItems(ctx, { status: 'in-progress' })) {
    const d = itemDate(i.file, tasks.readNote(i.file).data);
    const age = d ? Math.floor((now - d) / DAY) : 0;
    if (age > days) stale.push({ name: i.name, kind: i.kind, project: i.project, days: age });
  }

  const typed = [...tasks.itemFiles(vault, ['task', 'issue', 'feature'])];
  try {
    for (const e of fs.readdirSync(path.join(vault, '20_Projects'), { withFileTypes: true })) if (e.isFile() && e.name.endsWith('.md')) typed.push(path.join(vault, '20_Projects', e.name));
  } catch {}
  const noFrontmatter = typed.filter((f) => !/^---\r?\n/.test(fs.readFileSync(f, 'utf8'))).map((f) => relOf(vault, f)).sort();

  const byName = new Map();
  for (const f of inv.live) {
    const k = lower(path.basename(f, '.md'));
    byName.set(k, [...(byName.get(k) || []), relOf(vault, f)]);
  }
  const duplicates = [...byName.values()].filter((v) => v.length > 1).map((files) => ({ name: path.basename(files[0], '.md'), files: files.sort() }));

  const skeleton = new Set(DIRS.map((d) => path.join(vault, d)));
  const emptyFolders = [];
  const removedFolders = [];
  const holdsFiles = new Map();
  walk(vault, (f) => {
    for (let d = path.dirname(f); d.length >= vault.length; d = path.dirname(d)) {
      holdsFiles.set(d, true);
      if (d === path.dirname(d)) break;
    }
  }, (d) => {
    const r = relOf(vault, d);
    if (holdsFiles.get(d) || skeleton.has(d) || r.startsWith('90_Archive') || r.startsWith('80_Assets')) return;
    emptyFolders.push(r);
  });
  if (fix) {
    for (const r of emptyFolders) {
      try {
        fs.rmdirSync(path.join(vault, r));
        removedFolders.push(r);
      } catch {}
    }
  }
  return { broken, fixed, orphans, stale, noFrontmatter, duplicates, emptyFolders: fix ? [] : emptyFolders, removedFolders };
}

module.exports = { check, linksOf, fold };
