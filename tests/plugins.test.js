'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join } = require('node:path');
const { read, write, makeVault, io } = require('./helpers');
const { main } = require('../scripts/brain');
const plugins = require('../scripts/lib/plugins');

const REGISTRY = [
  { id: 'dataview', repo: 'blacksmithgu/obsidian-dataview' },
  { id: 'obsidian-kanban', repo: 'obsidian-community/obsidian-kanban' },
  { id: 'homepage', repo: 'mirnovov/obsidian-homepage' },
  { id: 'calendar', repo: 'liamcain/obsidian-calendar-plugin' },
  { id: 'liar', repo: 'someone/liar' },
];

// A fake GitHub: the repo's manifest.json names the version, whose release has manifest.json and main.js (dataview
// also styles.css); the calendar's latest release is a beta, which Obsidian never installs.
function fakeFetch({ registryDown = false, broken = [] } = {}) {
  const calls = [];
  const files = { 'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json': JSON.stringify(REGISTRY) };
  for (const { id, repo } of REGISTRY) {
    const manifest = JSON.stringify({ id: id === 'liar' ? 'someone-else' : id, name: id, version: '1.0.0' });
    files[`https://raw.githubusercontent.com/${repo}/HEAD/manifest.json`] = manifest;
    const base = `https://github.com/${repo}/releases/download/1.0.0/`;
    files[base + 'manifest.json'] = manifest;
    if (!broken.includes(id)) files[base + 'main.js'] = `module.exports = "${id}";`;
    if (id === 'dataview') files[base + 'styles.css'] = '.dv {}';
    files[`https://github.com/${repo}/releases/latest/download/manifest.json`] = JSON.stringify({ id: `${id}-beta`, version: '2.0.0-beta' });
  }
  const fetch = async (url) => {
    calls.push(url);
    if (registryDown && url.includes('obsidian-releases')) throw new Error('getaddrinfo ENOTFOUND');
    const body = files[url];
    return { ok: body !== undefined, status: body === undefined ? 404 : 200, text: async () => body, arrayBuffer: async () => new TextEncoder().encode(body).buffer };
  };
  return { fetch, calls };
}

const dir = (v, id) => join(v, '.obsidian', 'plugins', id);
const enabled = (v) => JSON.parse(read(join(v, '.obsidian', 'community-plugins.json')));

test('plugins installs the release named by the repo manifest, not the latest (maybe beta) one', async () => {
  const { vault: v } = makeVault();
  const { fetch, calls } = fakeFetch();
  const r = await plugins.install(v, ['calendar'], { fetch });
  assert.deepEqual(r.installed, ['calendar']);
  assert.ok(!calls.some((u) => u.includes('/latest/')));
  assert.equal(JSON.parse(read(join(dir(v, 'calendar'), 'manifest.json'))).version, '1.0.0');
});

test('plugins installs the defaults and enables them', async () => {
  const { vault: v, ctx } = makeVault();
  const { fetch } = fakeFetch();
  const r = await plugins.install(ctx.vault, plugins.DEFAULTS, { fetch });
  assert.deepEqual(r.installed, ['dataview', 'obsidian-kanban', 'homepage']);
  assert.deepEqual(r.failed, []);
  assert.equal(read(join(dir(v, 'dataview'), 'main.js')), 'module.exports = "dataview";');
  assert.equal(read(join(dir(v, 'dataview'), 'styles.css')), '.dv {}');
  assert.ok(!fs.existsSync(join(dir(v, 'homepage'), 'styles.css')));
  assert.deepEqual(enabled(v), ['dataview', 'obsidian-kanban', 'homepage']);
});

test('plugins keeps the enabled list and the installed plugins, and never touches data.json', async () => {
  const { vault: v } = makeVault();
  write(join(v, '.obsidian', 'community-plugins.json'), JSON.stringify(['calendar', 'dataview'], null, 2));
  write(join(dir(v, 'dataview'), 'manifest.json'), '{"id":"dataview","version":"0.1.0"}');
  write(join(dir(v, 'dataview'), 'main.js'), 'old');
  write(join(dir(v, 'homepage'), 'data.json'), '{"mine":true}');
  const { fetch, calls } = fakeFetch();
  const r = await plugins.install(v, plugins.DEFAULTS, { fetch });
  assert.deepEqual(r.present, ['dataview']);
  assert.deepEqual(r.installed, ['obsidian-kanban', 'homepage']);
  assert.equal(read(join(dir(v, 'dataview'), 'main.js')), 'old');
  assert.ok(!calls.some((u) => u.includes('obsidian-dataview')));
  assert.equal(read(join(dir(v, 'homepage'), 'data.json')), '{"mine":true}');
  assert.deepEqual(enabled(v), ['calendar', 'dataview', 'obsidian-kanban', 'homepage']);
});

test('plugins enables an installed but disabled plugin without downloading anything', async () => {
  const { vault: v } = makeVault();
  for (const id of plugins.DEFAULTS) write(join(dir(v, id), 'manifest.json'), `{"id":"${id}"}`);
  const { fetch, calls } = fakeFetch();
  const r = await plugins.install(v, plugins.DEFAULTS, { fetch });
  assert.deepEqual(calls, []);
  assert.deepEqual(r.enabled, plugins.DEFAULTS);
  assert.deepEqual(enabled(v), plugins.DEFAULTS);
});

test('plugins reports unknown ids, a wrong manifest and a missing main.js, and installs the rest', async () => {
  const { vault: v } = makeVault();
  const { fetch } = fakeFetch({ broken: ['calendar'] });
  const r = await plugins.install(v, ['nope', 'liar', 'calendar', 'homepage'], { fetch });
  assert.deepEqual(r.installed, ['homepage']);
  assert.deepEqual(r.failed.map((f) => f.id), ['nope', 'liar', 'calendar']);
  assert.match(r.failed[0].reason, /not in the community registry/);
  assert.match(r.failed[1].reason, /manifest id is someone-else/);
  assert.match(r.failed[2].reason, /main\.js: HTTP 404/);
  for (const id of ['liar', 'calendar']) assert.ok(!fs.existsSync(join(dir(v, id), 'manifest.json')), id);
  assert.deepEqual(enabled(v), ['homepage']);
});

test('plugins with the registry unreachable fails every download and writes nothing', async () => {
  const { vault: v } = makeVault();
  const { fetch } = fakeFetch({ registryDown: true });
  const r = await plugins.install(v, plugins.DEFAULTS, { fetch });
  assert.deepEqual(r.installed, []);
  assert.equal(r.failed.length, 3);
  assert.match(r.failed[0].reason, /registry unreachable: getaddrinfo ENOTFOUND/);
  assert.ok(!fs.existsSync(join(v, '.obsidian', 'community-plugins.json')));
});

test('plugins refuses ids that are not plain names', async () => {
  const { vault: v } = makeVault();
  const { fetch, calls } = fakeFetch();
  const r = await plugins.install(v, ['../../evil', 'ok.id_2'], { fetch });
  assert.match(r.failed[0].reason, /invalid plugin id/);
  assert.ok(!calls.some((u) => u.includes('evil')));
});

test('plugins never overwrites a community-plugins.json it cannot read', async () => {
  const { vault: v } = makeVault();
  write(join(v, '.obsidian', 'community-plugins.json'), '[broken');
  await assert.rejects(plugins.install(v, plugins.DEFAULTS, fakeFetch()), /bad-community-plugins/);
  assert.equal(read(join(v, '.obsidian', 'community-plugins.json')), '[broken');
});

test('plugins missing lists the plugins the vault needs that are not installed and enabled', () => {
  const { vault: v } = makeVault();
  assert.deepEqual(plugins.missing(v), ['dataview', 'obsidian-kanban']);
  write(join(dir(v, 'dataview'), 'manifest.json'), '{"id":"dataview"}');
  write(join(v, '.obsidian', 'community-plugins.json'), '["dataview"]');
  assert.deepEqual(plugins.missing(v), ['obsidian-kanban']);
});

test('cli plugins --dry-run reports the plan and writes nothing', async () => {
  const { cfgFile, code, vault: v } = makeVault();
  const { fetch, calls } = fakeFetch();
  const o = io();
  assert.equal(await main(['--config', cfgFile, 'plugins', '--dry-run'], { cwd: code, fetch, ...o }), 0);
  assert.deepEqual(calls, []);
  assert.match(o.text(), /would install: dataview, obsidian-kanban, homepage/);
  assert.ok(!fs.existsSync(join(v, '.obsidian')));
});

test('cli plugins installs the given ids, mentions the trust prompt and exits 9 on a failure', async () => {
  const { cfgFile, code, vault: v } = makeVault();
  const { fetch } = fakeFetch();
  let o = io();
  assert.equal(await main(['--config', cfgFile, 'plugins', 'calendar'], { cwd: code, fetch, ...o }), 0);
  assert.match(o.text(), /installed: calendar/);
  assert.match(o.text(), /trust/);
  assert.deepEqual(enabled(v), ['calendar']);
  o = io();
  assert.equal(await main(['--config', cfgFile, 'plugins', 'nope'], { cwd: code, fetch, ...o }), 9);
  assert.match(o.errText(), /failed: nope \(not in the community registry\)/);
});

test('cli status points to brain plugins while the vault misses one it needs', async () => {
  const { cfgFile, code } = makeVault();
  let o = io();
  await main(['--config', cfgFile, 'status'], { cwd: code, ...o });
  assert.match(o.text(), /plugins: missing dataview, obsidian-kanban → brain plugins/);
  await main(['--config', cfgFile, 'plugins'], { cwd: code, fetch: fakeFetch().fetch, ...io() });
  o = io();
  await main(['--config', cfgFile, 'status'], { cwd: code, ...o });
  assert.doesNotMatch(o.text(), /plugins:/);
});
