'use strict';
// Active playbooks: check lines in playbook notes, evaluated read-only against a project's repo.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const { join } = require('node:path');
const { write, read, makeVault, io } = require('./helpers');
const pb = require('../scripts/lib/playbooks');
const { main } = require('../scripts/brain');

const PLAYBOOK = [
  '---',
  'type: playbook',
  'applies_when: ["app-*/build.gradle"]',
  '---',
  '# Family',
  'Prose with `code` — `more code` is not a check.',
  '- [ ] `LICENSE` present and cited (prose, not a check)',
  '## Checks',
  '- `backup` — `app-*/Manifest.xml` has `dataExtractionRules` (since Android 12)',
  '- [ ] `no-internet` — `app-*/Manifest.xml` lacks `permission.INTERNET`',
  '- `licence` — `LICENSE` exists',
  '- `version` — `app-*/build.gradle` has `/versionName = "\\d+\\.\\d+\\.\\d+"/`',
  '',
].join('\n');

function repo() {
  const r = fs.mkdtempSync(join(os.tmpdir(), 'sb-pbrepo-'));
  write(join(r, 'LICENSE'), 'GPL');
  write(join(r, 'app-a', 'Manifest.xml'), '<application dataExtractionRules="x"/>');
  write(join(r, 'app-a', 'build.gradle'), 'versionName = "1.2.3"');
  write(join(r, 'app-b', 'Manifest.xml'), '<application/><uses-permission permission.INTERNET/>');
  fs.mkdirSync(join(r, 'app-c'));
  write(join(r, 'app-c', 'build.gradle'), 'versionName = "x"');
  return r;
}

test('parseChecks reads check lines, ignores prose, reports broken attempts', () => {
  const { checks, broken } = pb.parseChecks(PLAYBOOK);
  assert.deepEqual(checks.map((c) => [c.id, c.glob, c.op]), [
    ['backup', 'app-*/Manifest.xml', 'has'],
    ['no-internet', 'app-*/Manifest.xml', 'lacks'],
    ['licence', 'LICENSE', 'exists'],
    ['version', 'app-*/build.gradle', 'has'],
  ]);
  assert.equal(checks[0].pattern, 'dataExtractionRules');
  assert.ok(checks[3].pattern instanceof RegExp);
  assert.deepEqual(broken, []);
  const bad = pb.parseChecks(['- `a` — `x` hass `y`', '- `b` — `x` has', '- `c` — `x` has `/[/`', '- `d` — `x` exists', '- `d` — `y` exists'].join('\n'));
  assert.deepEqual(bad.checks.map((c) => c.id), ['d']);
  assert.deepEqual(bad.broken.map((b) => b.id), ['a', 'b', 'c', 'd']);
});

test('units: each wildcard folder is a unit, a plain path is the repo', () => {
  const r = repo();
  const u = pb.units(r, 'app-*/Manifest.xml');
  assert.deepEqual(u.map((x) => [x.unit, x.files.length]), [['app-a', 1], ['app-b', 1], ['app-c', 0]]);
  assert.deepEqual(pb.units(r, 'LICENSE').map((x) => [x.unit, x.files.length]), [['.', 1]]);
  assert.deepEqual(pb.units(r, 'nope-*/x'), []);
});

test('evaluate: has, lacks, exists per unit; a missing file fails has; nothing matching fails', () => {
  const r = repo();
  const { checks } = pb.parseChecks(PLAYBOOK);
  const by = Object.fromEntries(checks.map((c) => [c.id, pb.evaluate(r, c)]));
  assert.deepEqual(by.backup, { ok: false, failing: ['app-b', 'app-c'] });
  assert.deepEqual(by['no-internet'], { ok: false, failing: ['app-b'] });
  assert.deepEqual(by.licence, { ok: true, failing: [] });
  assert.deepEqual(by.version, { ok: false, failing: ['app-b', 'app-c'] });
  assert.deepEqual(pb.evaluate(r, { id: 'x', glob: 'nope-*/x', op: 'exists' }), { ok: false, failing: ['(nothing matches)'] });
});

test('evaluate reads at most 1 MB of a file', () => {
  const r = fs.mkdtempSync(join(os.tmpdir(), 'sb-pbbig-'));
  write(join(r, 'big.txt'), 'a'.repeat(1024 * 1024) + 'NEEDLE');
  assert.equal(pb.evaluate(r, { id: 'n', glob: 'big.txt', op: 'has', pattern: 'NEEDLE' }).ok, false);
});

function vaultWith(hubFront) {
  const v = makeVault();
  write(join(v.vault, '10_Notes', 'Family.md'), PLAYBOOK);
  write(join(v.vault, '10_Notes', 'Other.md'), '---\ntype: playbook\napplies_when: ["nothing/here"]\n---\n- `o` — `x` exists\n');
  write(join(v.vault, '20_Projects', 'app.md'), `---\ntype: project\n${hubFront}---\n# app\n`);
  return v;
}

test('run: linked playbooks only, waivers by id, id@unit and [[playbook]], missing playbooks reported', () => {
  const r = repo();
  const v = vaultWith('playbooks: ["[[Family]]", "[[Gone]]"]\nwaive: ["no-internet", "backup@app-c"]\n');
  const hub = pb.hubData(v.vault, 'app');
  const res = pb.run(v.vault, hub, r);
  const fam = res.find((x) => x.playbook === 'Family');
  assert.equal(fam.total, 4);
  assert.deepEqual(fam.failed, [{ id: 'backup', units: ['app-b'] }, { id: 'version', units: ['app-b', 'app-c'] }]);
  assert.deepEqual(fam.waived, ['no-internet']);
  assert.ok(res.find((x) => x.playbook === 'Gone').missing);
  const off = pb.run(v.vault, pb.hubData(vaultWith('playbooks: ["[[Family]]"]\nwaive: ["[[Family]]"]\n').vault, 'app'), r);
  assert.deepEqual(off, []);
});

test('suggest: a playbook whose applies_when matches the repo, not linked and not declined', () => {
  const r = repo();
  assert.deepEqual(pb.suggest(vaultWith('').vault, {}, r), ['Family']);
  const v = vaultWith('waive: ["[[Family]]"]\n');
  assert.deepEqual(pb.suggest(v.vault, pb.hubData(v.vault, 'app'), r), []);
  const l = vaultWith('playbooks: ["[[Family]]"]\n');
  assert.deepEqual(pb.suggest(l.vault, pb.hubData(l.vault, 'app'), r), []);
});

test('contextLine: one line, ok or failing, clipped', () => {
  assert.equal(pb.contextLine([]), null);
  assert.match(pb.contextLine([{ playbook: 'A', total: 3, failed: [], waived: [], broken: [] }]), /^playbooks: \[\[A\]\] — 3 checks ok; follow it for new work and releases$/);
  const line = pb.contextLine([{ playbook: 'A', total: 12, failed: [{ id: 'about', units: ['x', 'y'] }, { id: 'v', units: ['.'] }], waived: [], broken: [] }]);
  assert.match(line, /\[\[A\]\] — 2 of 12 checks failing: about \(x, y\), v/);
  assert.match(line, /brain check/);
  assert.ok(pb.contextLine([{ playbook: 'A', total: 99, failed: Array.from({ length: 60 }, (_, i) => ({ id: `id-${i}`, units: ['u'] })), waived: [], broken: [] }]).length <= 300);
});

test('brain project playbook and waive write the hub; brain check reports failures', async () => {
  const v = vaultWith('');
  const r = repo();
  fs.renameSync(r, join(v.code, 'app'));
  const cli = async (...args) => {
    const o = io();
    const code = await main(['--config', v.cfgFile, ...args], { cwd: join(v.code, 'app'), ...o });
    return { code, out: o.text(), err: o.errText() };
  };
  assert.equal((await cli('project', 'playbook', 'app', 'Family')).code, 0);
  assert.equal((await cli('project', 'playbook', 'app', 'Family')).code, 0);
  assert.match(read(join(v.vault, '20_Projects', 'app.md')), /playbooks: \["\[\[Family\]\]"\]/);
  assert.equal((await cli('project', 'playbook', 'app', 'Nope')).code, 2);
  assert.equal((await cli('project', 'waive', 'app', 'no-internet')).code, 0);
  assert.equal((await cli('project', 'waive', 'app', 'Bad Id')).code, 2);
  const c = await cli('check');
  assert.equal(c.code, 0, c.err);
  assert.match(c.out, /Family/);
  assert.match(c.out, /backup.*app-b, app-c/);
  assert.match(c.out, /no-internet.*waived/);
  const j = JSON.parse((await cli('--json', 'check')).out);
  assert.equal(j.projects[0].results[0].failed.length, 2);
  assert.equal((await cli('project', 'playbook', 'app', 'Family', '--remove')).code, 0);
  assert.doesNotMatch(read(join(v.vault, '20_Projects', 'app.md')), /\[\[Family\]\]/);
});

test('session start: the linked playbook line, a suggestion for a matching repo, nothing elsewhere', () => {
  const { run } = require('../scripts/hook');
  const v = vaultWith('playbooks: ["[[Family]]"]\n');
  fs.renameSync(repo(), join(v.code, 'app'));
  fs.renameSync(repo(), join(v.code, 'app2'));
  fs.mkdirSync(join(v.code, 'plain'));
  const start = (dir, sid) => run('session-start', { session_id: sid, cwd: join(v.code, dir), source: 'startup' }, { cfgFile: v.cfgFile, cli: '/x/brain.js' }).stdout;
  const app = start('app', 's-pb-1');
  assert.match(app, /playbooks: \[\[Family\]\] — 3 of 4 checks failing: backup \(app-b, app-c\), no-internet \(app-b\), version \(app-b, app-c\); brain check for details/);
  assert.match(start('app2', 's-pb-2'), /playbook suggestion: \[\[Family\]\] matches this repo; ask the user before brain project add app2, then brain project playbook app2/);
  assert.doesNotMatch(start('plain', 's-pb-3'), /playbook/);
});

test('health lists failing checks, suggestions and broken lines; bootstrap reports suggestions for new hubs', async () => {
  const { execFileSync } = require('node:child_process');
  const v = vaultWith('playbooks: ["[[Family]]"]\n');
  write(join(v.vault, '10_Notes', 'Family.md'), PLAYBOOK + '- `oops` — `x` hass `y`\n');
  for (const name of ['app', 'newapp']) {
    const d = join(v.code, name);
    fs.renameSync(repo(), d);
    execFileSync('git', ['init', '-q'], { cwd: d });
  }
  const cli = async (...args) => {
    const o = io();
    const code = await main(['--config', v.cfgFile, ...args], { cwd: v.code, ...o });
    return { code, out: o.text(), err: o.errText() };
  };
  const b = await cli('--json', 'bootstrap');
  assert.equal(b.code, 0, b.err);
  assert.deepEqual(JSON.parse(b.out).playbookSuggestions, [{ project: 'newapp', playbooks: ['Family'] }]);
  const h = JSON.parse((await cli('--json', 'health')).out);
  assert.deepEqual(h.playbooks.map((p) => [p.project, p.playbook, p.failed]), [['app', 'Family', ['backup', 'no-internet', 'version']]]);
  assert.deepEqual(h.playbookSuggestions, [{ project: 'newapp', playbooks: ['Family'] }]);
  assert.deepEqual(h.brokenChecks.map((x) => [x.project, x.id]), [['app', 'oops']]);
});

test('units: deeper wildcard folders select files inside the first one, the unit stays the app', () => {
  const r = fs.mkdtempSync(join(os.tmpdir(), 'sb-pbdeep-'));
  write(join(r, 'app-a', 'src', 'x', 'y', 'NoticesTest.kt'), 'test');
  fs.mkdirSync(join(r, 'app-b', 'src', 'z'), { recursive: true });
  assert.deepEqual(pb.units(r, 'app-*/src/*/*/NoticesTest.kt').map((u) => [u.unit, u.files.length]), [['app-a', 1], ['app-b', 0]]);
  assert.deepEqual(pb.evaluate(r, { id: 't', glob: 'app-*/src/*/*/NoticesTest.kt', op: 'exists' }), { ok: false, failing: ['app-b'] });
});
