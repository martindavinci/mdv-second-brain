'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const frontmatter = require('../scripts/lib/frontmatter');
const markers = require('../scripts/lib/markers');
const templates = require('../scripts/lib/templates');

test('frontmatter round-trip keeps order and quotes wikilinks', () => {
  const data = { type: 'task', status: 'todo', completed_at: '', blocked: false, feature: '[[Payments]]', project: '[[mdv-tools]]', area: [], tags: ['status/blocked', 'a b'], note: 'x: y' };
  const text = frontmatter.stringify(data, '# Title\n\nbody\n');
  assert.match(text, /^---\ntype: task\nstatus: todo\ncompleted_at:\nblocked: false\nfeature: "\[\[Payments\]\]"\nproject: "\[\[mdv-tools\]\]"\narea: \[\]\ntags: \[status\/blocked, a b\]\nnote: "x: y"\n---\n# Title/);
  const back = frontmatter.parse(text);
  assert.deepEqual(back.data, data);
  assert.deepEqual(Object.keys(back.data), Object.keys(data));
  assert.equal(back.body, '# Title\n\nbody\n');
});

test('frontmatter parses kanban header with blank lines and block lists', () => {
  const k = frontmatter.parse('---\n\nkanban-plugin: board\n\n---\n\n## ToDo\n');
  assert.deepEqual(k.data, { 'kanban-plugin': 'board' });
  assert.equal(k.body, '\n## ToDo\n');
  const b = frontmatter.parse('---\ntags:\n  - one\n  - "two, three"\ntitle: \'Single\'\n---\nx');
  assert.deepEqual(b.data, { tags: ['one', 'two, three'], title: 'Single' });
});

test('frontmatter without header returns empty data and full body', () => {
  assert.deepEqual(frontmatter.parse('# Just text\n'), { data: {}, body: '# Just text\n' });
  assert.deepEqual(frontmatter.parse('---\nunterminated: yes\n'), { data: {}, body: '---\nunterminated: yes\n' });
});

test('frontmatter escapes quotes inside quoted values', () => {
  const text = frontmatter.stringify({ title: 'say "hi", ok' }, '');
  assert.deepEqual(frontmatter.parse(text).data, { title: 'say "hi", ok' });
});

test('setSection replaces only owned content', () => {
  const base = 'intro\n<!-- brain:projects -->\nold\n<!-- /brain:projects -->\nuser text\n';
  const out = markers.setSection(base, 'projects', 'new line');
  assert.equal(out, 'intro\n<!-- brain:projects -->\nnew line\n<!-- /brain:projects -->\nuser text\n');
  assert.equal(markers.getSection(out, 'projects'), 'new line');
  assert.equal(markers.hasSection(out, 'daily'), false);
});

test('setSection appends a missing section and supports names with colons', () => {
  const out = markers.setSection('text\n', 'session:ab12cd34', 'state');
  assert.equal(out, 'text\n\n<!-- brain:session:ab12cd34 -->\nstate\n<!-- /brain:session:ab12cd34 -->\n');
  assert.equal(markers.getSection(out, 'session:ab12cd34'), 'state');
  assert.equal(markers.getSection(out, 'session:other'), null);
});

test('templates load with fallback and fill keeps secret placeholders', () => {
  assert.match(templates.load('it', 'AGENTS.md'), /archivio|90_Archive/);
  assert.equal(templates.load('xx', 'AGENTS.md'), templates.load('en', 'AGENTS.md'));
  assert.equal(templates.fill('{{a}} {{secret:KEY}} {{missing}}', { a: 'A' }), 'A {{secret:KEY}} {{missing}}');
});
