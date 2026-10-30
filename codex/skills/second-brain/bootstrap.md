# Bootstrap: the workspace's repos as projects

Follow this when the user asks to bootstrap the workspace (`/brain bootstrap`, `$second-brain bootstrap`, "importa le repo", "crea gli hub delle repo") or `brain status` shows a `repos:` line. It is safe to re-run whenever repos are added or renamed. Commands are written `brain …`: use the CLI line from the skill.

1. `brain --json bootstrap --dry-run`. Tell the user in a few lines: new repos, existing hubs, excluded folders with the reason, names taken by other notes, rename proposals, hubs whose repo folder is gone.
2. Renames (`renames`): ask the user once, for all of them together; for each one confirmed run `brain project rename "<from>" "<to>"`. Never rename on your own. Hubs without their folder (`orphans`): report them; nothing is deleted.
3. `brain --json bootstrap`: creates the missing hubs and regenerates the `## Repo` section of every hub (generated: never edit it by hand).
4. Prose, only for the hubs in `created` (existing hubs keep theirs): up to 5 repos yourself; more → subagents in parallel, at most 5 repos each, with the brief below.
5. Relations (`candidates`): read each evidence; confirm the true ones with `brain project relate <a> --<relation> <b>` (both hubs are updated), skip the doubtful ones. Never write relation lists by hand.
6. Decisions (`decisions`: commits whose subject says a direction was taken): list them for the user in one message; for each one they confirm, add a line to `DECISIONS.md`: `- <date> — <the choice, in the vault language> (<hash>) → [[<project>]]`. The hash keeps it from being proposed again; never write one the user did not confirm.
7. Anomalies (`broken` references and what the subagents report): `brain issue add` only when actionable (for example a build that writes into a folder that no longer exists); the rest goes in the hub's Gotchas.
8. `brain index`, then `brain commit -m "bootstrap: <n> projects"`.

## Brief for the subagents

> Fill the project hubs, in <vault language>, for these repos: <folder → hub list>. Each hub already exists at `20_Projects/<project>.md`.
> 1. Read only, and lightly: README, CLAUDE.md / AGENTS.md, manifests (package.json, Cargo.toml, pyproject, Makefile, *.sln…), the top-level layout, `git log --oneline -15`. For content repos (books, sites), structure and progress only, never the text.
> 2. Rewrite the hub body with your file tools: a summary of 2–4 sentences, then only the sections with real content among Stack, Structure, Build / run / release (or Workflow), Conventions, Gotchas, State, with their names in the vault language. Keep the frontmatter and the `brain:repo` and `brain:project-index` sections exactly as they are.
> 3. At most 3800 characters per hub; only facts you read, inferences marked "(to verify)".
> 4. Never copy a secret or a token, not even from gitignored local files (`*.local.md`, `.env`): at most "exists, in `<file>`".
> 5. No `brain` commands and no writes outside your hubs.
> Report: one line per repo; candidate relations with the path of the evidence; anomalies (broken references, old names, dated docs).
