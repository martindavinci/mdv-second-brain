'use strict';

const RESERVED = new Set(['daily', 'features', 'tasks', 'issues']);

function noteName(title) {
  const s = String(title ?? '')
    .normalize('NFC')
    .replace(/[\\/:*?"<>|#^[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
    .trim();
  if (!s) throw new Error('empty-title');
  return s;
}

function projectName(raw) {
  const n = noteName(raw);
  return RESERVED.has(n.toLowerCase()) ? `${n} (project)` : n;
}

// "[[x|alias]]" / "[[x]]" / "x" → "x"
function unwrapLink(v) {
  if (typeof v !== 'string' || !v.trim()) return null;
  const m = /^\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]$/.exec(v.trim());
  return (m ? m[1] : v).trim() || null;
}

function ymd(d = new Date()) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function parseYmd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

module.exports = { RESERVED, noteName, projectName, unwrapLink, ymd, parseYmd };
