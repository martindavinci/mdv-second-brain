'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join } = require('node:path');
const { read, write, makeVault, daysAgo, ymd } = require('./helpers');
const daily = require('../scripts/lib/daily');
const markers = require('../scripts/lib/markers');

test('dailyPath uses the local date', () => {
  const { vault: v } = makeVault();
  assert.equal(daily.dailyPath(v, new Date(2026, 9, 21, 23, 59)), join(v, '00_Inbox', 'Daily', '2026-10-21.md'));
});

test('ensureSessionSection is idempotent and per-session', () => {
  const { vault: v } = makeVault();
  const start = new Date(2026, 9, 21, 9, 5);
  const a = daily.ensureSessionSection(v, 'en', 'aaaaaaaa-1111', start);
  const b = daily.ensureSessionSection(v, 'en', 'bbbbbbbb-2222', new Date(2026, 9, 21, 10, 30));
  daily.ensureSessionSection(v, 'en', 'aaaaaaaa-1111', start);
  assert.equal(a.file, b.file);
  assert.equal(a.marker, 'session:aaaaaaaa');
  const text = read(a.file);
  assert.equal(text.match(/<!-- brain:session:aaaaaaaa -->/g).length, 1);
  assert.match(text, /## 09:05 — Session\n<!-- brain:session:aaaaaaaa -->\n- Status:/);
  assert.match(text, /## 10:30 — Session\n<!-- brain:session:bbbbbbbb -->/);
});

test('a session that passes midnight stays in the daily where it started', () => {
  const { vault: v } = makeVault();
  const r = daily.ensureSessionSection(v, 'it', 'cccccccc', new Date(2026, 9, 21, 23, 50));
  assert.ok(r.file.endsWith('2026-10-21.md'));
  assert.match(read(r.file), /— Sessione\n<!-- brain:session:cccccccc -->\n- Stato:/);
});

test('lastSessionState skips the current session and returns only the checkpoint', () => {
  const { vault: v } = makeVault();
  const r = daily.ensureSessionSection(v, 'en', 'old11111', new Date(2026, 9, 20, 8, 0));
  const text = read(r.file);
  write(r.file, markers.setSection(text, 'session:old11111', '- Status: parser half done\n- Next: wire the CLI\n- Open: naming of flags\n\nLog:\n- 08:00 started\n- 09:00 lots of noise here'));
  daily.ensureSessionSection(v, 'en', 'cur22222', new Date(2026, 9, 21, 8, 0));
  const last = daily.lastSessionState(v, 'cur22222-full-id');
  assert.match(last, /parser half done/);
  assert.match(last, /wire the CLI/);
  assert.doesNotMatch(last, /noise|Log/);
  assert.ok(last.length <= 600);
  assert.equal(daily.lastSessionState(makeVault().vault, 'x'), null);
});

test('rollover moves dailies older than 7 days', () => {
  const { vault: v } = makeVault();
  const now = new Date();
  for (const n of [0, 7, 8, 30]) write(daily.dailyPath(v, daysAgo(n, now)), `# ${n}\n`);
  const moved = daily.rollover(v, now, 7);
  assert.equal(moved.length, 2);
  assert.ok(fs.existsSync(join(v, '90_Archive', 'Daily', `${ymd(daysAgo(8, now))}.md`)));
  assert.ok(fs.existsSync(daily.dailyPath(v, daysAgo(7, now))));
  assert.ok(fs.existsSync(daily.dailyPath(v, now)));
});
