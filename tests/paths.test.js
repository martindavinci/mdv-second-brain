'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { join } = path;
const { normalize, isInside, defaultRoot, expandHome } = require('../scripts/lib/paths');

const tmp = fs.mkdtempSync(join(os.tmpdir(), 'sb-paths-'));

test('normalize unifies separators and trailing slash', () => {
  assert.equal(normalize(join(tmp, 'a') + path.sep), normalize(join(tmp, 'a')));
  assert.ok(!normalize(join(tmp, 'a')).includes('\\'));
});

test('isInside respects segment boundary', () => {
  assert.equal(isInside(join(tmp, 'ab'), join(tmp, 'a')), false);
  assert.equal(isInside(join(tmp, 'a', 'b'), join(tmp, 'a')), true);
  assert.equal(isInside(join(tmp, 'a'), join(tmp, 'a')), true);
});

test('expandHome expands a leading tilde only', () => {
  assert.equal(expandHome('~'), os.homedir());
  assert.equal(expandHome('~/x'), join(os.homedir(), 'x'));
  assert.equal(expandHome('a/~/x'), 'a/~/x');
});

test('defaultRoot prefers Documents', () => {
  const withDocs = fs.mkdtempSync(join(os.tmpdir(), 'sb-home-'));
  fs.mkdirSync(join(withDocs, 'Documents'));
  assert.equal(defaultRoot(withDocs), join(withDocs, 'Documents', 'SecondBrain'));
  const without = fs.mkdtempSync(join(os.tmpdir(), 'sb-home-'));
  assert.equal(defaultRoot(without), join(without, 'SecondBrain'));
});

test('normalize lower-cases only on win32', { skip: process.platform !== 'win32' }, () => {
  assert.equal(normalize('C:\\Users\\X\\'), normalize('c:/users/x'));
});
