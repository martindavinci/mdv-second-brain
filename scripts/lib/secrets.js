'use strict';
// Secret values live only in secrets.local.md (gitignored); notes use {{secret:KEY}}.
const fs = require('node:fs');
const path = require('node:path');
const git = require('./git');

const FILE = 'secrets.local.md';
const KEY = /^[A-Z][A-Z0-9_]*$/;
const PATTERNS = [
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['aws-key', /\bAKIA[0-9A-Z]{16}\b/],
  ['github-token', /\b(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ['api-key', /\bsk-[A-Za-z0-9_-]{16,}/],
  ['stripe-key', /\b[sr]k_(live|test)_[A-Za-z0-9]{16,}/],
  ['google-key', /\bAIza[0-9A-Za-z_-]{35,}/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['assignment', /(password|passwd|pwd|secret|api[_-]?key|token|client[_-]?secret|[a-z]+_key)\s*[:=]\s*\S{6,}/i],
];

function scan(text) {
  const hits = [];
  String(text).split('\n').forEach((raw, i) => {
    const line = raw.replace(/\{\{secret:[A-Z0-9_]+\}\}/g, '');
    const found = PATTERNS.find(([, re]) => re.test(line));
    if (found) hits.push({ line: i + 1, kind: found[0] });
  });
  return hits;
}

function changedFiles(repo, pathspec) {
  // raw output: " M file" starts with a space that a trim would eat, shifting every path by one char
  const out = git.runRaw(repo, ['status', '--porcelain', '-z', '--untracked-files=all', '--', git.literal(pathspec)]);
  const parts = out.split('\0').filter(Boolean);
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const status = parts[i].slice(0, 2);
    const file = parts[i].slice(3);
    if (status.startsWith('R') || status.startsWith('C')) i++;
    if (status.includes('D')) continue;
    files.push(file);
  }
  return files;
}

// A plugin's released code (minified, full of `token:`-like names) is not the user's writing; its settings still are.
const PLUGIN_BUNDLE = /(^|\/)\.obsidian\/plugins\/[^/]+\/(main\.js|styles\.css)$/;

function scanChanged(repo, pathspec) {
  const hits = [];
  for (const file of changedFiles(repo, pathspec)) {
    if (file.endsWith('.local.md') || PLUGIN_BUNDLE.test(file)) continue;
    const full = path.join(repo, file);
    let text;
    try {
      if (!fs.statSync(full).isFile()) continue;
      text = fs.readFileSync(full, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') continue;
      // fail closed: a file we cannot read is never committed unscanned
      throw new Error(`scan-failed: ${file}`);
    }
    if (text.includes('\0')) continue;
    for (const h of scan(text)) hits.push({ file, ...h });
  }
  return hits;
}

function readSecrets(vault) {
  const file = path.join(vault, FILE);
  if (!fs.existsSync(file)) return {};
  const m = /```env\r?\n([\s\S]*?)```/.exec(fs.readFileSync(file, 'utf8'));
  const out = {};
  for (const line of (m ? m[1] : '').split(/\r?\n/)) {
    const kv = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2];
  }
  return out;
}

// Edits the env block line by line: lines the user wrote (comments, continuation lines) stay untouched.
function setSecret(vault, key, value) {
  if (!KEY.test(key)) throw new Error('invalid-secret-key');
  if (/[\r\n]/.test(String(value))) throw new Error('multiline-secret');
  const file = path.join(vault, FILE);
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '# Secrets\n\nLocal only, never committed. Notes reference these values as `{{secret:KEY}}`.\n\n```env\n```\n';
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  let open = lines.findIndex((l) => /^```env\s*$/.test(l));
  if (open < 0) {
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    lines.push('', '```env', '```', '');
    open = lines.length - 3;
  }
  let close = lines.findIndex((l, i) => i > open && /^```\s*$/.test(l));
  if (close < 0) {
    lines.push('```');
    close = lines.length - 1;
  }
  const entry = `${key}=${value}`;
  const at = lines.findIndex((l, i) => i > open && i < close && l.startsWith(`${key}=`));
  if (at >= 0) lines[at] = entry;
  else lines.splice(close, 0, entry);
  fs.writeFileSync(file, lines.join(eol));
}

const placeholder = (key) => `{{secret:${key}}}`;

module.exports = { FILE, scan, scanChanged, readSecrets, setSecret, placeholder };
