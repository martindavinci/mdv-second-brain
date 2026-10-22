'use strict';
// Project relations: `brain project relate` writes both hubs, each with its side of the relation.
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { read, makeVault, io } = require('./helpers');
const { main } = require('../scripts/brain');
const frontmatter = require('../scripts/lib/frontmatter');

async function hubs(...names) {
  const env = makeVault();
  for (const p of names) assert.equal(await main(['--config', env.cfgFile, 'project', 'add', p], { cwd: env.code, ...io() }), 0);
  const run = async (...a) => {
    const o = io();
    const code = await main(['--config', env.cfgFile, 'project', 'relate', ...a], { cwd: env.code, ...o });
    return { code, text: o.text(), err: o.errText() };
  };
  const fm = (p) => frontmatter.parse(read(join(env.vault, '20_Projects', `${p}.md`))).data;
  return { ...env, run, fm };
}

test('a new hub has every relation list, built_from included', async () => {
  const { fm } = await hubs('alpha');
  for (const k of ['depends_on', 'used_by', 'source_of', 'built_from', 'related']) assert.deepEqual(fm('alpha')[k], [], k);
});

test('project relate writes both hubs with the inverse relation, once', async () => {
  const { run, fm } = await hubs('site-src', 'site', 'kit', 'notes');
  assert.equal((await run('site-src', '--source-of', 'site')).code, 0);
  assert.equal((await run('site-src', '--source-of', 'site')).code, 0);
  assert.equal((await run('site', '--depends-on', 'kit')).code, 0);
  assert.equal((await run('notes', '--related', 'site')).code, 0);
  assert.deepEqual(fm('site-src').source_of, ['[[site]]']);
  assert.deepEqual(fm('site').built_from, ['[[site-src]]']);
  assert.deepEqual(fm('site').depends_on, ['[[kit]]']);
  assert.deepEqual(fm('kit').used_by, ['[[site]]']);
  assert.deepEqual(fm('notes').related, ['[[site]]']);
  assert.deepEqual(fm('site').related, ['[[notes]]']);
});

test('project relate --remove takes the relation off both hubs', async () => {
  const { run, fm } = await hubs('site', 'kit');
  await run('site', '--depends-on', 'kit');
  assert.equal((await run('site', '--depends-on', 'kit', '--remove')).code, 0);
  assert.deepEqual(fm('site').depends_on, []);
  assert.deepEqual(fm('kit').used_by, []);
});

test('project relate needs two existing hubs and exactly one relation', async () => {
  const { run } = await hubs('site', 'kit');
  const missing = await run('site', '--depends-on', 'ghost');
  assert.equal(missing.code, 2);
  assert.match(missing.err, /no hub for project ghost/);
  assert.equal((await run('site')).code, 2);
  assert.equal((await run('site', '--depends-on', 'kit', '--used-by', 'kit')).code, 2);
  assert.equal((await run('site', '--related', 'site')).code, 2);
});
