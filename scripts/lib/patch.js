'use strict';
// Files a tool call wrote: Claude passes file_path/notebook_path, Codex an apply_patch text in tool_input.command.
// `gone` marks a deleted file or the source of a move: it changed, but there is nothing left to read.

const HEADER = /^\*\*\* (Add File|Update File|Delete File|Move to): (.+?)\s*$/;

function patchOps(text) {
  if (typeof text !== 'string') return [];
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = HEADER.exec(line);
    if (!m) continue;
    if (m[1] === 'Move to' && out.length) out[out.length - 1].gone = true;
    out.push({ path: m[2], gone: m[1] === 'Delete File' });
  }
  return out;
}

function patchPaths(text) {
  return [...new Set(patchOps(text).map((f) => f.path))];
}

function toolPaths(input) {
  const ti = (input && input.tool_input) || {};
  const direct = ti.file_path || ti.notebook_path;
  if (typeof direct === 'string') return [{ path: direct, gone: false }];
  const cmd = Array.isArray(ti.command) ? ti.command.filter((x) => typeof x === 'string').join('\n') : ti.command;
  return patchOps(cmd);
}

module.exports = { patchPaths, toolPaths };
