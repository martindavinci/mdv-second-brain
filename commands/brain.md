---
description: Second brain — activate it for a folder or chat (/brain init); in activated workspaces manage tasks, issues and ideas, search and commit the vault.
argument-hint: "[init [--quick] | attach <ws> | detach | bootstrap | plugins [<id>…] | health [--fix] | task … | issue … | idea … | context | search <text> | project … | distill | postmortem <title> | index | commit -m <msg> | status]"
---

Use the second-brain skill for this request. Arguments: $ARGUMENTS

- No arguments → run `brain status` and report it in one or two lines.
- `init` alone → the skill's guided activation (one round of questions). `init --quick` → quick activation, no questions.
- `health` → `brain health`; show the findings, run `--fix` only when the user agrees.
- `bootstrap` → the skill's bootstrap procedure (`bootstrap.md` next to SKILL.md): dry run, renames only after the user confirms, hubs, prose, relations, commit.
- `plugins [<id>…]` → `brain plugins [<id>…]`: Dataview, Kanban and Homepage by default; pass on the line about trusting the plugins that it prints.
- `distill` → level 2 of the skill for the current work, then `brain commit -m "<summary>"`.
- `postmortem <title>` → `brain postmortem add "<title>"`, fill every section from this session, put the lessons into the feature, then `brain commit -m "post mortem: <title>"`.
- Anything else → run `brain <arguments>` with the CLI line from the skill and summarise the result in one or two lines.
