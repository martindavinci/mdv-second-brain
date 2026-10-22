'use strict';
// Minimal YAML frontmatter: scalars, quoted strings, booleans, inline and block lists.

function unquote(v) {
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1).replace(/\\(["\\])/g, '$1');
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

function splitInline(inner) {
  const out = [];
  let cur = '';
  let q = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (q) {
      cur += c;
      if (c === '\\' && q === '"' && i + 1 < inner.length) cur += inner[++i];
      else if (c === q) q = null;
    } else if (c === '"' || c === "'") {
      q = c;
      cur += c;
    } else if (c === ',') {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.map(unquote);
}

function parseValue(raw) {
  const v = raw.trim();
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v.startsWith('[') && v.endsWith(']') && !v.startsWith('[[')) return splitInline(v.slice(1, -1));
  return unquote(v);
}

function parse(text) {
  const m = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { data: {}, body: text };
  const data = {};
  const lines = (m[1] || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const kv = /^([^:\s][^:]*):(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1].trim();
    if (kv[2].trim() !== '') {
      data[key] = parseValue(kv[2]);
      continue;
    }
    const items = [];
    while (i + 1 < lines.length && /^\s+-\s*/.test(lines[i + 1])) items.push(unquote(lines[++i].replace(/^\s+-\s*/, '').trim()));
    data[key] = items.length ? items : '';
  }
  return { data, body: text.slice(m[0].length) };
}

function needsQuotes(s) {
  if (s === '') return false;
  return /[:#[\]{},"]/.test(s) || s !== s.trim() || s === 'true' || s === 'false' || s.startsWith("'");
}

function formatScalar(v) {
  if (v === true || v === false) return String(v);
  if (v === null || v === undefined) return '';
  const s = String(v);
  return needsQuotes(s) ? '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"' : s;
}

function stringify(data, body = '') {
  const lines = ['---'];
  for (const [k, v] of Object.entries(data)) {
    const f = Array.isArray(v) ? `[${v.map(formatScalar).join(', ')}]` : formatScalar(v);
    lines.push(f === '' ? `${k}:` : `${k}: ${f}`);
  }
  lines.push('---');
  return lines.join('\n') + '\n' + body;
}

const FENCE = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function formatEntry(k, v) {
  const f = Array.isArray(v) ? `[${v.map(formatScalar).join(', ')}]` : formatScalar(v);
  return f === '' ? `${k}:` : `${k}: ${f}`;
}

// Rewrites only the given keys, line by line; every other frontmatter line (comments, block scalars, nested maps) stays as written.
function setKeys(text, changes) {
  const m = FENCE.exec(text);
  if (!m) return stringify(changes, text);
  const head = m[1] ? m[1].split(/\r?\n/) : [];
  for (const [k, v] of Object.entries(changes)) {
    const line = formatEntry(k, v);
    const i = head.findIndex((l) => new RegExp(`^${esc(k)}\\s*:`).test(l));
    if (i < 0) {
      head.push(line);
      continue;
    }
    let end = i + 1;
    while (end < head.length && /^(\s+\S|\s*-\s)/.test(head[end])) end++;
    head.splice(i, end - i, line);
  }
  return `---\n${head.join('\n')}\n---\n${text.slice(m[0].length)}`;
}

// Replaces the body and keeps the frontmatter exactly as written.
function setBody(text, body) {
  const m = FENCE.exec(text);
  return m ? text.slice(0, m[0].length) + body : body;
}

module.exports = { parse, stringify, setKeys, setBody };
