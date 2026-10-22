'use strict';
// Owned sections: <!-- brain:NAME --> … <!-- /brain:NAME -->. Text outside them is never touched.

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const open = (name) => `<!-- brain:${name} -->`;
const close = (name) => `<!-- /brain:${name} -->`;

function find(text, name) {
  const re = new RegExp(`${esc(open(name))}\\n?([\\s\\S]*?)\\n?${esc(close(name))}`);
  return re.exec(text);
}

function hasSection(text, name) {
  return find(text, name) !== null;
}

function getSection(text, name) {
  const m = find(text, name);
  return m ? m[1] : null;
}

function setSection(text, name, content) {
  const block = `${open(name)}\n${content}\n${close(name)}`;
  const m = find(text, name);
  if (m) return text.slice(0, m.index) + block + text.slice(m.index + m[0].length);
  const sep = text === '' ? '' : text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
  return text + sep + block + '\n';
}

module.exports = { hasSection, getSection, setSection, open, close };
