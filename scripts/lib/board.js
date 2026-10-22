'use strict';
// Obsidian Kanban board. Everything is kept as raw lines so a hand-edited board round-trips byte for byte.

const LANES = { todo: 'ToDo', 'in-progress': 'In Progress', completed: 'Completed', discarded: 'Discarded' };
const STATUSES = Object.keys(LANES);
const SYNONYMS = {
  todo: 'todo', 'to do': 'todo', 'to-do': 'todo',
  'in progress': 'in-progress', 'in-progress': 'in-progress', doing: 'in-progress', wip: 'in-progress',
  completed: 'completed', done: 'completed',
  discarded: 'discarded',
};
const CARD = /^- \[( |x|X)\] (.*)$/;
const SETTINGS = '%% kanban:settings';

function emptyBoard() {
  return '---\n\nkanban-plugin: board\n\n---\n\n' + STATUSES.map((s) => `## ${LANES[s]}\n\n`).join('') + SETTINGS + '\n```\n{"kanban-plugin":"board"}\n```\n%%\n';
}

function parseBoard(text) {
  const lines = text.split('\n');
  let tailAt = lines.findIndex((l) => l.startsWith(SETTINGS));
  if (tailAt < 0) tailAt = lines.length;
  const starts = [];
  for (let i = 0; i < tailAt; i++) if (lines[i].startsWith('## ')) starts.push(i);
  const headEnd = starts.length ? starts[0] : tailAt;
  const lanes = starts.map((s, k) => ({
    title: lines[s].slice(3).trim(),
    rawTitle: lines[s],
    lines: lines.slice(s + 1, k + 1 < starts.length ? starts[k + 1] : tailAt),
  }));
  return {
    head: lines.slice(0, headEnd).join('\n'),
    headCount: headEnd,
    lanes,
    tail: tailAt < lines.length ? lines.slice(tailAt).join('\n') : null,
  };
}

function serializeBoard(b) {
  const out = [];
  if (b.headCount !== 0) out.push(...b.head.split('\n'));
  for (const lane of b.lanes) out.push(lane.rawTitle || `## ${lane.title}`, ...lane.lines);
  if (b.tail !== null && b.tail !== undefined) out.push(...b.tail.split('\n'));
  return out.join('\n');
}

function linkOf(text) {
  const m = /\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/.exec(text);
  return m ? m[1].trim() : null;
}

function cards(lane) {
  const out = [];
  lane.lines.forEach((line, index) => {
    const m = CARD.exec(line);
    if (m) out.push({ index, checked: m[1] !== ' ', text: m[2], link: linkOf(m[2]) });
  });
  return out;
}

const isSubLine = (l) => l !== undefined && /^\s+\S/.test(l);

function cardSpan(lane, index) {
  let end = index + 1;
  while (isSubLine(lane.lines[end])) end++;
  return end;
}

function laneStatus(title) {
  return SYNONYMS[String(title).trim().toLowerCase()] || null;
}

function findLaneByStatus(b, status) {
  return b.lanes.find((l) => laneStatus(l.title) === status) || null;
}

function cardLine({ checked, text }) {
  return `- [${checked ? 'x' : ' '}] ${text}`;
}

// Inserts a card (its line plus any sub-lines) after the last card of the lane.
function appendCardLines(lane, lines) {
  const all = cards(lane);
  if (all.length) {
    lane.lines.splice(cardSpan(lane, all[all.length - 1].index), 0, ...lines);
    return;
  }
  if (lane.lines[0] !== '') lane.lines.unshift('');
  lane.lines.splice(1, 0, ...lines);
  const rest = lane.lines.slice(1 + lines.length);
  if (rest[0] !== '') lane.lines.splice(1 + lines.length, 0, '');
}

function appendCard(lane, card) {
  appendCardLines(lane, [cardLine(card)]);
}

function ensureLane(b, title) {
  const found = b.lanes.find((l) => l.title === title);
  if (found) return found;
  const lane = { title, rawTitle: `## ${title}`, lines: [''] };
  const last = b.lanes[b.lanes.length - 1];
  if (last && last.lines[last.lines.length - 1] !== '') last.lines.push('');
  b.lanes.push(lane);
  return lane;
}

function ensureStatusLane(b, status) {
  return findLaneByStatus(b, status) || ensureLane(b, LANES[status]);
}

function removeCardByLink(b, link) {
  const want = String(link).toLowerCase();
  for (const lane of b.lanes) {
    for (const c of cards(lane)) {
      if (c.link && c.link.toLowerCase() === want) {
        const removed = lane.lines.splice(c.index, cardSpan(lane, c.index) - c.index);
        return { checked: c.checked, text: c.text, lines: removed };
      }
    }
  }
  return null;
}

function emptyArchiveBoard() {
  return '---\n\nkanban-plugin: board\n\n---\n\n' + SETTINGS + '\n```\n{"kanban-plugin":"board"}\n```\n%%\n';
}

module.exports = {
  LANES, STATUSES, emptyBoard, emptyArchiveBoard, parseBoard, serializeBoard, cards, laneStatus, findLaneByStatus,
  appendCard, appendCardLines, ensureLane, ensureStatusLane, removeCardByLink, cardLine, linkOf, cardSpan,
};
