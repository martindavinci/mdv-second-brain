---
name: second-brain
description: Use when the session context contains "[second-brain]" lines (keep that workspace's vault updated while working), or when the user asks to activate, enable or turn off the second brain ("attiva brain", "attiva brain per questa chat", "/brain init", "enable the second brain here") or runs /brain.
---

# Second brain

You keep an Obsidian-compatible vault for the current workspace while you work. The user never has to ask, and you never ask permission to write it. Notes are written in the workspace language.

CLI: `node "${CLAUDE_SKILL_DIR}/../../scripts/brain.js" --session ${CLAUDE_SESSION_ID} <command>` — written `brain <command>` below. When the session context has a `cli:` line, use that one. Always pass `--session`. If `${CLAUDE_SKILL_DIR}` was not substituted, the CLI is `scripts/brain.js` in this plugin's folder.

## Activation (only when the user asks)
Outside a workspace the plugin is inert until the user asks.
- Guided (`/brain init` or `$second-brain init`, "attiva brain qui", "attiva brain per questa chat"): run `brain --json init --plan`, then ask ONE round of at most 4 questions with the host's question tool (AskUserQuestion, or request_user_input in Codex; else one plain message with numbered options). Recommended option first; skip what the plan already answers (`mapped` set → just bind with `brain init <mapped>`).
  1. What to activate: this folder (recommended) / the parent folder with all its projects (offer when `parentHasRepos`) / only this project, everything inside it (no workspace) / only this chat.
  2. Workspace: new `<defaultName>` (recommended) / an existing one from `workspaces` (the only time other workspace names may be shown).
  3. Vault: common root `<defaultVault>` (recommended) / inside the folder `<insideVault>` / a custom path.
  4. Git: own repo with the detected identity (show `identity.name <identity.email>`; recommended) / own repo with the global identity / no git / inside the repo that contains the vault.
  Never ask the language: use the code of the user's chat language.
  Then run `brain init <ws> --path <dir> [--vault <dir>] --git-mode per-workspace|none|host [--identity detected|global] --language <code>`.
  For "only this project" skip questions 2–3: `brain init --here --language <code>` plus the git flags (all in `<folder>/SecondBrain`).
  For "only this chat" never map the folder: a new workspace is `brain workspace add <ws> --language <code> [--vault <dir>]`, then `brain attach <ws>`.
- Quick ("attiva brain con i default", `/brain init --quick` or `$second-brain init --quick`): `brain init --quick --language <code>`, no questions.
- Off for this chat ("disattiva brain"): `brain detach`.
Finish with the single line the CLI prints. The workspace context arrives with the next message.
`init` exit 8 (sandbox cannot write the config): give the user the ways out it lists; `--config-here` only if they pick it.
Config: only `brain init`/`brain workspace …`, as the user asks; never hand-edit it or drop a setting (e.g. `ignore`) unasked.

## While you work (level 1, no commit)
- Your daily section: update it only with `brain checkpoint --status "<where we are>" --next "<next step>" --open "<open points>" --log "<what just happened>"` (any subset; ≤ 600 chars in all). Never edit the daily file by hand: other sessions write to it too. Do it on your own at each meaningful step, so the Stop reminder stays rare.
- Active task or issue: keep `## Status` (≤ 600 chars, rewrite), TODO checkboxes and `## Log` (append) current.
- Changelog-worthy work (new feature, behaviour change, relevant refactor) → always `brain task add "<Name>" [--feature "<Feature>"]`, then `brain task move "<Name>" in-progress`, and `brain task done "<Name>"` at the end.
- Actionable bug or problem → always `brain issue add "<Name>"`. One ordinary bug = one issue, no duplicate task. Unconfirmed observations stay in the daily log.
- Questions, reads, exploration and trivial touch-ups create nothing.
- `name taken` → pick a more specific name yourself (e.g. `Payments — Refunds`), never ask.
- Ideas (the user says idea, "sarebbe bello", "più avanti", or postpones a proposal) → `brain idea add "<text>"`, never a card. Decided → `brain task add …` then `brain idea promote <id> --to "<Name>"`; dropped → `brain idea discard <id>`.
- Spec or plan files written in chat: summarise them into the feature note (summary, rules, open decisions, sources with the path) and TODOs into the task; never a full copy.

## When a piece is done (level 2)
Triggers: task completed, bug fixed, decision taken, the user says a part is finished, `/brain distill` or `$second-brain distill`.
1. Move the card (`brain task done "<Name>"` or `brain issue done "<Name>"`).
2. Distil what lasts, following the vault's WORKFLOW.md:
   - feature note in the project's `Features/` (`brain feature add "<Name>"` when missing): implementation table ✅🟡❌🔒, rules, lessons; `lifecycle` proposed | available | retired, never "completed";
   - project knowledge (architecture, build/run/release, conventions, gotchas, how-to) → hub `20_Projects/<p>/<p>.md` (`brain project add <p>` when missing); a section past the hub budget → `<p> — <Topic>.md` in the same folder, linked from the hub;
   - post mortem → `brain postmortem add "<title>"`, fill every section, lessons also into the feature;
   - cross-project finding → one line in `MEMORY.md` or a loose note in `10_Notes/`;
   - stable decision → one line `- YYYY-MM-DD — <choice> → [[note]]` in `DECISIONS.md`, details in the note.
3. `brain commit -m "<summary>"`. Never push.
Cards never point to features: when `brain task sync` reports cards on features, turn each into a task.

## Reading (context budget)
Orient with `brain context`, then `brain show "<Name>" --section <heading> --max-chars 2000` (any note), then `brain search "<text>" [--project <p>] [--type task|issue|feature|note]`; add `--archive` only when the user asks about old work. Never read Home.md, generated indexes, whole dailies or `90_Archive/` to orient. Files reported `oversize:` → distil them: rewrite current truth, group `MEMORY.md` lines into loose notes.

## Rules
- Read the vault's AGENTS.md, WORKFLOW.md and TOOLS.md once per context before your first write there; they override this skill.
- Never delete notes. `brain task delete "<Name>" --yes` archives, and only when the user asks. Feature notes, hubs and distilled notes are current truth: rewrite obsolete prose. Tasks, issues, post mortems, dailies, `DECISIONS.md`, `MEMORY.md`, `Ideas.md` are history: mark lines, never remove them.
- Never touch user-written sections, generated files, or `<!-- brain:… -->` sections other than your own session section.
- Isolation: the content of one workspace never mentions another workspace — no links, names or summaries, in the vault, in context or in replies — unless the user explicitly asks.
- Subagents: when you delegate work that may write the vault, give the subagent your exact `cli:` line, `--session` included.
- Never interrupt a task to ask. Queue questions and ask once at the end; meanwhile use a sensible default and note it.
- Silent: at most one line about the brain at the end of a reply, and only after a distillation or a commit.
- Secrets: `brain secret set KEY value`, then write `{{secret:KEY}}` in notes; private prose goes in `<note>.local.md`. `brain commit` exit 5 means a secret was found: move it to `secrets.local.md`, put the placeholder, commit again, say so in one line at the end.
- Project relations (`depends_on`, `used_by`, `source_of`, `related` in the hub) only when the work confirms them.
- Never split or merge a project on your own: `brain project split <p>` / `brain project merge <p>` only when the user asks.
- Never touch the coding agent's own memory files (Claude Code memory, Codex memories).

## Commands
`checkpoint`, `show`, `task|issue add|list|show|move|block|unblock|done|discard|delete`, `task sync`, `feature add`, `idea add|list|promote|discard`, `context`, `search`, `project add|list|split|merge`, `postmortem add`, `index`, `commit -m`, `status`, `secret set|get|list`, `workspace add|list|map|ignore`, `init`, `attach`, `detach`, `adopt <path> --as <ws>` (dry run; `--apply` only after the user confirms the plan).
