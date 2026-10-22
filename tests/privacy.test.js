'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');

const repo = join(__dirname, '..');
const read = (f) => fs.readFileSync(join(repo, f), 'utf8');
const ALLOWED_EMAIL = /@(users\.noreply\.github\.com|example\.invalid|example\.com)$/;

function shippedFiles() {
  return execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: repo, encoding: 'utf8' })
    .split('\n')
    .filter((f) => f && f !== 'tests/privacy.test.js' && fs.existsSync(join(repo, f)));
}

test('no local absolute paths in tracked files', () => {
  const bad = /[A-Za-z]:\\\\?Users\\\\?[A-Za-z]|\/Users\/[a-z]|\/home\/[a-z]/;
  for (const f of shippedFiles()) assert.doesNotMatch(read(f), bad, f);
});

test('no local user name as a path segment', () => {
  const user = os.userInfo().username;
  const seg = new RegExp(`[\\\\/]${user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\\\/]`, 'i');
  for (const f of shippedFiles()) assert.doesNotMatch(read(f), seg, f);
});

test('no personal email addresses', () => {
  for (const f of shippedFiles()) {
    for (const m of read(f).matchAll(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g)) assert.match(m[0], ALLOWED_EMAIL, `${f}: ${m[0]}`);
  }
});

test('docs/superpowers is never shipped', () => {
  assert.ok(!shippedFiles().some((f) => f.startsWith('docs/superpowers/')));
});
