'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldBlock } = require('../scripts/lib/state');

const base = new Date(2026, 9, 21, 10, 0).getTime();
const t = (min) => new Date(base + min * 60000);
const s = { startedAt: t(0), turnStartedAt: t(20), dirtyAt: t(21), flushedAt: t(2), lastBlockAt: null };

test('shouldBlock with threshold 0 blocks once per turn', () => {
  assert.equal(shouldBlock(s, null, t(22), 0), true);
  assert.equal(shouldBlock({ ...s, lastBlockAt: t(22) }, null, t(23), 0), false);
  assert.equal(shouldBlock({ ...s, flushedAt: t(21.5) }, null, t(22), 0), false);
  assert.equal(shouldBlock(s, t(21.5), t(22), 0), false);
});

test('shouldBlock respects a positive threshold', () => {
  assert.equal(shouldBlock({ ...s, flushedAt: t(18) }, null, t(22), 10), false);
  assert.equal(shouldBlock({ ...s, flushedAt: t(5) }, null, t(22), 10), true);
});

test('shouldBlock without dirty work never blocks; accepts ISO strings', () => {
  assert.equal(shouldBlock({ ...s, dirtyAt: null }, null, t(22), 0), false);
  const iso = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v && v.toISOString()]));
  assert.equal(shouldBlock(iso, null, t(22).toISOString(), 0), true);
  assert.equal(shouldBlock({ ...s, flushedAt: null }, null, t(22), 0), true);
});

test('a block in an earlier turn does not prevent a block in this turn', () => {
  assert.equal(shouldBlock({ ...s, lastBlockAt: t(10) }, null, t(22), 0), true);
});
