'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join } = require('node:path');
const board = require('../scripts/lib/board');

const fixture = fs.readFileSync(join(__dirname, 'fixtures', 'board-hand-edited.md'), 'utf8');

test('round-trips a hand-edited board byte-for-byte', () => {
  assert.equal(board.serializeBoard(board.parseBoard(fixture)), fixture);
  const empty = board.emptyBoard();
  assert.equal(board.serializeBoard(board.parseBoard(empty)), empty);
});

test('parseBoard splits head, lanes and settings tail', () => {
  const b = board.parseBoard(fixture);
  assert.match(b.head, /kanban-plugin: board/);
  assert.deepEqual(b.lanes.map((l) => l.title), ['To Do', 'Doing', 'Ideas', 'Done', 'Discarded']);
  assert.match(b.tail, /^%% kanban:settings/);
});

test('cards extracts link and checked state', () => {
  const b = board.parseBoard(fixture);
  const todo = board.cards(b.lanes[0]);
  assert.equal(todo.length, 3);
  assert.deepEqual(todo.map((c) => c.link), ['Export Report', null, 'Fix Login']);
  assert.equal(todo[1].text, 'Call the vendor about pricing');
  const done = board.cards(b.lanes[3]);
  assert.equal(done[0].checked, true);
  assert.equal(done[0].link, 'Old Thing');
});

test('laneStatus maps synonyms', () => {
  assert.equal(board.laneStatus('done'), 'completed');
  assert.equal(board.laneStatus('To Do'), 'todo');
  assert.equal(board.laneStatus('Doing'), 'in-progress');
  assert.equal(board.laneStatus('In Progress'), 'in-progress');
  assert.equal(board.laneStatus('Discarded'), 'discarded');
  assert.equal(board.laneStatus('Ideas'), null);
});

test('emptyBoard lanes in order', () => {
  assert.deepEqual(board.parseBoard(board.emptyBoard()).lanes.map((l) => l.title), ['ToDo', 'In Progress', 'Completed', 'Discarded']);
});

test('appendCard goes after the last card, or after the heading of an empty lane', () => {
  const b = board.parseBoard(fixture);
  board.appendCard(b.lanes[1], { checked: false, text: '[[New One]]' });
  board.appendCard(b.lanes[4], { checked: true, text: '[[Dropped]]' });
  const out = board.serializeBoard(b);
  assert.match(out, /## Doing\n\n- \[ \] \[\[Refactor Parser\]\]\n- \[ \] \[\[New One\]\]\n\n## Ideas/);
  assert.match(out, /## Discarded\n\n- \[x\] \[\[Dropped\]\]\n\n%% kanban:settings/);
});

test('removeCardByLink removes the card and its sub-lines', () => {
  const b = board.parseBoard(fixture);
  const removed = board.removeCardByLink(b, 'fix login');
  assert.deepEqual(removed, { checked: false, text: '[[Fix Login|login fix]] urgent', lines: ['- [ ] [[Fix Login|login fix]] urgent', '\t- sub-line written by hand'] });
  assert.doesNotMatch(board.serializeBoard(b), /Fix Login|sub-line/);
  assert.equal(board.removeCardByLink(b, 'Nope'), null);
});

test('findLaneByStatus uses laneStatus', () => {
  const b = board.parseBoard(fixture);
  assert.equal(board.findLaneByStatus(b, 'completed').title, 'Done');
  assert.equal(board.findLaneByStatus(b, 'blocked'), null);
});
