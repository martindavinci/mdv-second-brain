'use strict';
// Text injected into the model's context. Short by design: the vault is read on demand through the CLI.

const TARGET = 2500;
const CAP = 6000;
const MAX_ITEMS = 5;

const cliCmd = (cli, sid, cfgFile) => `node "${cli}"${cfgFile ? ` --config "${cfgFile}"` : ''} --session ${sid}`;
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function head({ ws, vault, lang, cli, cliConfig, sid, dailyFile, marker, needsInit }) {
  const lines = [
    `[second-brain] workspace=${ws} vault=${vault} lang=${lang || 'unset'}`,
    `cli: ${cliCmd(cli, sid, cliConfig)}`,
    `daily: ${dailyFile} — your section marker: ${marker}; update it only with \`checkpoint --status … --next … --open … --log …\`, never by editing the file`,
    'Read AGENTS.md, WORKFLOW.md and TOOLS.md of the vault once per context, before your first write there.',
    'Rules: (1) keep your checkpoint and the active task (Status, TODO, Log) current while you work; when a piece is done, distil it and run `commit`.',
    '(2) Never mention or link another workspace. (3) Never ask the user mid-task: queue questions for the end.',
    '(4) Silent: at most one line about the brain per reply. (5) Never delete notes: archive them.',
    'Orient with `context`, `show <name> --section <heading>`, `search <text>`; never read Home, generated indexes, whole dailies or the archive.',
  ];
  if (needsInit) lines.push(`Vault not created yet: run ${cliCmd(cli, sid, cliConfig)} init ${ws} --language <the user's chat language code> before the first write.`);
  return lines.join('\n');
}

function projectBlock({ project, projectNoteExists, relatedHints, inProgress }) {
  const lines = [];
  if (project) lines.push(projectNoteExists ? `project: ${project} (hub 20_Projects/${project}.md)` : `project: ${project} — create 20_Projects/${project}.md (brain project add) when there is real content`);
  else lines.push('project: none (workspace level)');
  if (project && !projectNoteExists && relatedHints && relatedHints.length) {
    lines.push(`possibly related projects: ${relatedHints.join(', ')} — link them in the hub only if the work confirms it`);
  }
  const items = (inProgress || []).slice().sort((a, b) => (b.project === project) - (a.project === project));
  if (items.length) {
    lines.push('In Progress:');
    for (const i of items.slice(0, MAX_ITEMS)) lines.push(clip(`- ${i.name}${i.project && i.project !== project ? ` (${i.project})` : ''}${i.blocked ? ' 🔒' : ''}${i.state ? ` — ${i.state}` : ''}`, 160));
    if (items.length > MAX_ITEMS) lines.push(`+${items.length - MAX_ITEMS} more (\`task list --status in-progress\`)`);
  }
  return lines.join('\n');
}

function buildSessionContext(o) {
  const blocks = [head(o), projectBlock(o)];
  if (o.lastState) blocks.push(`last session checkpoint:\n${o.lastState}`);
  if (o.oversize && o.oversize.length) blocks.push(o.oversize.map((x) => `oversize: ${x.file} (${x.chars}/${x.budget}) — distil it`).join('\n'));
  let text = blocks.join('\n\n');
  while (text.length > CAP && blocks.length > 1) {
    blocks.pop();
    text = blocks.join('\n\n');
  }
  return clip(text, CAP);
}

function switchContext({ ws, vault, dailyFile, marker, cli, cliConfig, sid, back = false }) {
  if (back) {
    return [
      `[second-brain] back in workspace=${ws} vault=${vault}`,
      `cli: ${cliCmd(cli, sid, cliConfig)} (use exactly this line again, without any workspace flag)`,
      `daily: ${dailyFile} — your section marker: ${marker}`,
      'Notes about this work go to this vault only.',
    ].join('\n');
  }
  return [
    `[second-brain] you are now working in workspace=${ws} vault=${vault}`,
    `cli: ${cliCmd(cli, sid, cliConfig)} --workspace ${ws}`,
    `daily: ${dailyFile} — your section marker: ${marker}`,
    `Read AGENTS.md, WORKFLOW.md and TOOLS.md of this vault before writing there. Keep this workspace's notes about this workspace only.`,
  ].join('\n');
}

function captureLine(target, project) {
  const dest = project ? `20_Projects/${project}/Features` : '10_Notes/Features';
  return `capture: summarise ${target} into the feature note in ${dest} (summary, rules, open decisions, sources with this path) and TODOs into the active task; never a full copy`;
}

module.exports = { TARGET, CAP, buildSessionContext, switchContext, captureLine, cliCmd };
