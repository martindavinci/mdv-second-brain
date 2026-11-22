---
name: second-brain
description: Use when the session context contains "[second-brain]" lines (keep that workspace's vault updated while working), or when the user asks to activate, enable or turn off the second brain ("attiva brain", "attiva brain per questa chat", "/brain init", "enable the second brain here") or runs /brain.
---

# Second brain

You keep an Obsidian vault for the current workspace while you work, unasked, without asking permission. Notes are in the workspace language.

CLI: `node "<plugin root>/scripts/brain.js" <command>` — written `brain <command>` below; `<plugin root>` is three folders above this SKILL.md (`…/codex/skills/second-brain/SKILL.md` → `…/scripts/brain.js`). When the session context has a `cli:` line, use that one. The session id comes from `CODEX_THREAD_ID`, so `--session` is optional.

## Activation (only when the user asks)
- Guided (`/brain init` or `$second-brain init`, "attiva brain qui", "attiva brain per questa chat"): run `brain --json init --plan`, then ask ONE round of at most 4 questions with the host's question tool (AskUserQuestion / request_user_input in Codex; else one message, numbered options). Recommended first; skip what the plan answers (`mapped` set → just bind with `brain init <mapped>`).
  1. What to activate: this folder (recommended) / the parent folder with all its projects (offer when `parentHasRepos`) / only this project, everything inside it (no workspace) / only this chat.
  2. Workspace: new `<defaultName>` (recommended) / an existing one from `workspaces` (only here may other workspace names be shown): the folder joins it.
  3. Vault: common root `<defaultVault>` (recommended) / inside the folder `<insideVault>` / a custom path.
  4. Git: own repo with the detected identity (show `identity.name <identity.email>`; recommended) / own repo with the global identity / no git / inside the repo containing the vault.
  Never ask the language: use the chat language's code.
  Then run `brain init <ws> --path <dir> [--vault <dir>] --git-mode per-workspace|none|host [--identity detected|global] --language <code>`.
  For "only this project" skip questions 2–3: `brain init --here --language <code>` plus the git flags (all in `<folder>/SecondBrain`).
  For "only this chat" never map the folder: a new workspace is `brain workspace add <ws> --language <code> [--vault <dir>]`, then `brain attach <ws>`.
- Quick ("attiva brain con i default", `/brain init --quick` or `$second-brain init --quick`): `brain init --quick --language <code>`, no questions.
- Off for this chat ("disattiva brain"): `brain detach`.
Finish with the one line the CLI prints.
`init` exit 8 (sandbox cannot write the config): give the user the ways out it lists; `--config-here` only if they pick it; it is unseen outside that folder (multi-folder workspaces: global config).
Config: only `brain init`/`brain workspace …`, as the user asks; never hand-edit it or drop a setting (e.g. `ignore`) unasked.
Bootstrap (`/brain bootstrap`, "importa le repo", or `brain status` shows `repos:`): follow `bootstrap.md` next to this file.

## While you work (level 1, no commit)
- Your daily section: update it only with `brain checkpoint --status "<where we are>" --next "<next step>" --open "<open points>" --log "<what happened>"` (any subset; ≤ 600 chars). Do it at each meaningful step, so the Stop reminder stays rare.
- Active task or issue: keep `## Status` (≤ 600 chars, rewrite), TODO checkboxes and `## Log` (append) current.
- Changelog-worthy work (new feature, behaviour change, relevant refactor) → always `brain task add "<Name>" [--feature "<Feature>"]`, `brain task move "<Name>" in-progress`, and `brain task done "<Name>"` at the end.
- Actionable bug or problem → always `brain issue add "<Name>"`. One ordinary bug = one issue, no duplicate task. Unconfirmed observations stay in the daily log.
- Questions, reads, exploration, trivial touch-ups create nothing.
- `name taken` → pick a more specific name yourself (e.g. `Payments — Refunds`), never ask.
- Ideas (idea, "sarebbe bello", "più avanti", a postponed proposal) → `brain idea add "<text>"`, never a card. Decided → `brain task add …` then `brain idea promote <id> --to "<Name>"`; dropped → `brain idea discard <id>`.
- Spec or plan files written in chat → summary in the feature note (with the path), TODOs in the task; never a full copy.

## When a piece is done (level 2)
Triggers: task completed, bug fixed, decision taken, the user says a part is finished, `/brain distill` or `$second-brain distill`.
1. Move the card (`brain task|issue done "<Name>"`).
2. Distil what lasts, following the vault's WORKFLOW.md:
   - feature note in the project's `Features/` (`brain feature add "<Name>"` when missing): implementation table ✅🟡❌🔒, rules, lessons; `lifecycle` proposed | available | retired, never "completed";
   - project knowledge (architecture, build/run/release, conventions, gotchas, how-to) → hub `20_Projects/<p>.md` (`brain project add <p>` when missing); a section past the hub budget → `<p> — <Topic>.md` in `20_Projects/<p>/`, linked from the hub;
   - post mortem → `brain postmortem add "<title>"`, fill every section, lessons also into the feature;
   - cross-project finding → one line in `MEMORY.md` or a loose note in `10_Notes/`;
   - stable decision → one line `- YYYY-MM-DD — <choice> → [[note]]` in `DECISIONS.md`, details in the note.
3. `brain commit -m "<summary>"`. Never push.
Cards never point to features: turn each one `brain task sync` reports into a task.

## Reading (context budget)
Orient with `brain context` → `brain show "<Name>" --section <heading> --max-chars 2000` → `brain search "<text>" [--project <p>] [--type <t>]`; add `--archive` only when the user asks about old work. Never read Home.md, generated indexes, whole dailies or `90_Archive/` to orient. Files reported `oversize:` → distil them: rewrite current truth, group `MEMORY.md` lines into loose notes.

## Rules
- Read the vault's AGENTS.md, WORKFLOW.md and TOOLS.md once per context before your first write there; they override this skill.
- Never delete notes. `brain task delete "<Name>" --yes` archives, only when the user asks. Feature notes, hubs and distilled notes are current truth: rewrite obsolete prose. Tasks, issues, post mortems, dailies, `DECISIONS.md`, `MEMORY.md`, `Ideas.md` are history: mark lines, never remove them.
- Never touch user-written sections, generated files, or `<!-- brain:… -->` sections other than your session section.
- Isolation: one workspace's content never mentions another workspace (no links, names or summaries, in the vault, context or replies) unless the user explicitly asks.
- Subagents that may write the vault get your exact `cli:` line, `--session` included.
- Never interrupt a task to ask: queue questions for the end (`brain checkpoint --ask "<question>"`; answered → `brain attention done <id>`); meanwhile use a sensible default and note it.
- Silent: at most one line about the brain, at the end of a reply: after a distillation or a commit, and once in your first reply for items `waiting for the user` in the context.
- Secrets: `brain secret set KEY value`, then write `{{secret:KEY}}` in notes; private prose goes in `<note>.local.md`. `brain commit` exit 5 = a secret found: move it to `secrets.local.md`, put the placeholder, commit again, say so in one line.
- `brain project relate` when the work confirms it; `project playbook|waive` only when the user agrees (e.g. to a `playbook suggestion`); `project split|merge|rename` only when asked.
- Before a tag or release: `brain check`; fix what fails or tell the user. A fix that holds for a whole family → one check line in its playbook.
- Never touch the agent's own memory files (Claude Code memory, Codex memories).

## Commands
`task|issue add|list|show|move|block|unblock|done|discard|delete|sync`, `feature add`, `idea add|list|promote|discard`, `project add|list|rename|relate|playbook|waive|split|merge`, `check`, `attention [snooze|done <id>]`, `bootstrap [--dry-run]`, `plugins` (only when asked), `health [--fix]`, `recap [--week|--month]`, `postmortem add`, `index`, `commit -m`, `status`, `secret set|get|list`, `workspace add|list|map|ignore`, `init`, `attach`, `detach`, `adopt <path> --as <ws>` (dry run; `--apply` once the user confirms the plan).
