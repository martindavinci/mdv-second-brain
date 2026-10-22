'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { read, makeVault } = require('./helpers');
const secrets = require('../scripts/lib/secrets');

test('scan detects each kind and ignores prose and placeholders', () => {
  const text = [
    'normal prose about a token: we rotate it',
    '-----BEGIN OPENSSH PRIVATE KEY-----',
    'aws AKIAABCDEFGHIJKLMNOP here',
    'gh ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    'openai sk-proj_abcdefghijklmnop1234',
    'slack xoxb-1234567890-abcdef',
    'password = hunter2222',
    'api_key: {{secret:API_KEY}}',
    'the password is in secrets.local.md',
  ].join('\n');
  assert.deepEqual(secrets.scan(text).map((h) => [h.line, h.kind]), [
    [2, 'private-key'], [3, 'aws-key'], [4, 'github-token'], [5, 'api-key'], [6, 'slack-token'], [7, 'assignment'],
  ]);
});

test('setSecret creates and updates the env block; placeholder format', () => {
  const { vault: v } = makeVault();
  secrets.setSecret(v, 'API_KEY', 'abc');
  secrets.setSecret(v, 'DB_PASS', 'p w');
  secrets.setSecret(v, 'API_KEY', 'xyz');
  assert.deepEqual(secrets.readSecrets(v), { API_KEY: 'xyz', DB_PASS: 'p w' });
  assert.match(read(join(v, 'secrets.local.md')), /```env\nAPI_KEY=xyz\nDB_PASS=p w\n```/);
  assert.equal(secrets.placeholder('API_KEY'), '{{secret:API_KEY}}');
  assert.throws(() => secrets.setSecret(v, 'bad-key', 'x'), /invalid-secret-key/);
});
