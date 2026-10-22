'use strict';
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', '..', 'skills', 'second-brain', 'templates');

function load(lang, name) {
  const own = path.join(DIR, String(lang || 'en'), name);
  return fs.readFileSync(fs.existsSync(own) ? own : path.join(DIR, 'en', name), 'utf8');
}

function fill(text, vars) {
  return text.replace(/\{\{(\w+)\}\}/g, (all, k) => (vars[k] === undefined ? all : String(vars[k])));
}

module.exports = { DIR, load, fill };
