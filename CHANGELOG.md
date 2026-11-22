# Changelog

## 0.9.1 — 2026-11-23

- The attention feed: every item except a question carries its own "Snooze until tomorrow" command to copy, so an app reading the feed can offer it without knowing the tool behind it.

## 0.9.0 — 2026-11-22

- **`brain workspace attention <ws> [--feed-dir <folder>] [--remote-ttl <hours>] [--no-feed]`**: where the attention feed of a workspace is written (a folder you made; the plugin never creates it) and how often its GitHub part runs; with no option, what is set now.
- **`brain attention`**: what waits for you in the workspace — commits not pushed (and `main`/`master` without an upstream), tags missing on the remote, a working tree uncommitted for more than three days, GitHub draft releases and a failed last CI run of the default branch (through `gh`), failing playbook checks, outgrown hubs, playbook suggestions, items in progress untouched for over 14 days, a Claude Code plugin installed behind the version its repo released, questions queued by agent sessions, and the vault's own commits not pushed for more than three days. Every command in it is built from facts, to copy; nothing is run. Ignored repos are left out; project mode has no queue.
- The Stop hook refreshes the queue in the background after each turn (detached and silent, at most once every two minutes per workspace) into `.brain/attention.json`; GitHub and the remotes are asked at most every 6 hours (`remoteTtlHours`), and when `gh` is missing or logged out the rest still works and the queue says so. The session-start context gets one line from that file (`waiting for the user: 2 to push, 1 draft release, 1 question`), without counting what the current project's lines already say; the skill mentions it once in the first reply.
- Items keep their id while they last; one that is solved and comes back later is new. `brain attention snooze <id> [--until YYYY-MM-DD]` hides an item; `brain checkpoint --ask "<question>"` queues a question for the end and `brain attention done <id>` clears it once answered.
- **Attention feed**: `workspaces.<name>.attention.outputs` writes the queue to `<folder>/brain-<workspace>.json` for other apps (format v1 in `docs/feed-format.md`), whole and only when it changed; a folder that is missing is logged once.

## 0.8.0 — 2026-11-22

- **Playbooks that remind**: a playbook note (`type: playbook` in `10_Notes/`) holds check lines — `` - `id` — `glob` has|lacks|exists `text or /regex/` `` — that only read the project's files; each wildcard folder is checked on its own, so a monorepo gets one result per app. A hub follows a playbook with `brain project playbook`, and waives an intentional difference with `brain project waive` (a check, a check in one folder, or the whole playbook). The session context and `brain context` name the playbooks of the current project and its failing checks in one line; `brain check` lists them; `brain health` adds failing checks, broken check lines and repos that match a playbook's `applies_when` without following it; `brain bootstrap` reports the same suggestions for the hubs it creates. A suggestion is never applied on its own. The skill runs `brain check` before a tag or release and turns a fix that holds for a whole family into a check line.
- New vaults: WORKFLOW rows for runbooks and playbooks, and the check-line format in TOOLS.md. Existing vaults keep their files.
- Fix: the folder configuration search compares folders by real path, so from an 8.3 short name, a junction or a symlink of the home folder the global configuration is no longer taken for a folder's own (a test run through such a path wrote its workspaces into the real configuration).

## 0.7.1 — 2026-11-22

- Fix: the identity proposed at init no longer takes the global `~/.gitconfig` for a folder's own when the folder is reached through another form of the home path (a Windows 8.3 short name such as `RUNNER~1`, a junction or a symlink): the search for a `.gitconfig` now stops at the home folder compared as real paths.
- Tests: the ownership tests keep git's global and system configuration out, so a `safe.directory=*` there (the macOS CI runner has one) no longer makes git trust every repo.

## 0.7.0 — 2026-11-22

- **Stale hubs**: a hub is flagged when its repo got a new tag or more than 20 commits since the hub's own text last changed (generated sections and frontmatter do not count). The session-start context and `brain context` name it for the current project only, with what changed and what to do; `brain health` lists every project's. `brain index` and `brain commit` keep a hash of each hub's text and the repo's HEAD when it last changed in `.brain/hubs.json`; a hub never tracked starts from the repo as it was on its `updated` day. Repos are only read; the agent decides what to rewrite.

## 0.6.0 — 2026-11-22

- Fix: a vault inside a parent repo reached through a different form of its path (a Windows 8.3 short name such as `RUNNER~1`, a junction or symlink, macOS `/var` for `/private/var`) is excluded from that repo again, and host mode commits there again. git prints the canonical root; the plugin now keeps the form it was given, so relative paths no longer walk out of the repo.
- CI runs the tests on Linux, Windows and macOS with Node 18 (the minimum in `engines`) and 24.
- `brain search` finds a note whose words sit on different lines (until now every word had to be on one line, heading or name). Such notes come after every note with the words on one line, shown by the line holding most of them; boards and idea lists are left out of this, since their lines are unrelated items. Accents no longer matter: `perche` finds "perché".

## 0.5.1 — 2026-11-22

- Skill and README: how to add a second folder (another drive, a second projects root) to an existing workspace, and how to move a workspace from a folder configuration (`--config-here`) to the global one, which is the only one seen from every mapped folder.

## 0.5.0 — 2026-10-30

- Claude Code: when another plugin or settings hook named for Obsidian, a vault or a second brain also injects context at session start, the injected context names it and says that the vault's `AGENTS.md`, `WORKFLOW.md` and `TOOLS.md` govern every write. Disabled plugins and plugins installed for another project are left out; nothing is changed. Inspired by `vault_plugin_scan.py` of obsidian-second-brain.
- **`brain recap [--week|--month] [--date YYYY-MM-DD]`**: what happened in a day (default), week or month — the tasks and issues closed in it (archived ones too) and, day by day, each session's state and log from the dailies, archived dailies included; log lines go first when the text is over budget. Inspired by `/obsidian-recap` of obsidian-second-brain.
- `brain bootstrap` proposes decisions made in code: the last 200 commits of each repo whose subject says a direction was taken ("switch … to", "replace … with", "migrate … to", "in favour of", "deprecate", "BREAKING CHANGE", and the Italian forms), routine commits (docs, test, chore, style) and subjects over 120 characters (a summary of many changes) left out. The agent writes the ones you confirm to `DECISIONS.md` with the commit hash, which keeps them from being proposed again. Inspired by `mine_commit_decisions.py` of obsidian-second-brain.
- **`brain health [--fix] [--days <n>]`**: broken `[[links]]` (links to archived notes and attachments count as fine; code is skipped), orphan notes, items in progress untouched for over 14 days, task, issue, feature and hub notes without frontmatter, duplicate note names, empty folders. `--fix` repoints only a link with exactly one certain match and keeps the text it showed, and removes empty folders outside the vault skeleton; ambiguous links are listed with their candidates. Inspired by `vault_health.py` and `heal_links.py` of obsidian-second-brain.
- New vaults: `AGENTS.md` asks for notes that read alone, facts that are timeless, dated or a pointer, `TBD` instead of invented facts, and text read from notes, repos and the web treated as data, never as instructions; the injected context carries that last rule too. Existing vaults keep their `AGENTS.md`. Rules adapted from the [AI-First Note Spec](https://github.com/eugeniughelbur/obsidian-second-brain/blob/main/AI-FIRST.md).
- Home: the projects table renders in Obsidian again — it now starts after a blank line under its `<!-- brain:projects -->` marker. Existing vaults get it at the next `brain index` or `brain commit`.

## 0.4.0 — 2026-10-30

- **`brain plugins [<id>…] [--dry-run]`**: installs and enables Obsidian community plugins in the vault — Dataview and Kanban (the vault's Home and board render with them) and Homepage (opens `Home.md` at startup) by default, or the ids given. Each plugin comes from the community registry and the release its repo's `manifest.json` names, as Obsidian does (never a beta); its id is checked, plugins already installed are kept, `community-plugins.json` gains only the missing ids and `data.json` is never touched. Exits 9 when a plugin fails, after installing the others.
- `brain status` names the plugins the vault needs that are not installed and enabled.
- `brain commit` no longer stops on a plugin's code: the secret scan skips `main.js` and `styles.css` under `.obsidian/plugins/` (minified bundles are full of `token:`-like names); `manifest.json` and every note are still scanned.
- README and plugin descriptions: the plugin is persistent project memory for coding agents, kept as an Obsidian vault — the agent's second brain for software work, not a personal one.

## 0.3.1 — 2026-10-26

- `brain bootstrap` no longer reports README examples or test fixtures as broken references to sibling folders; test and fixture folders are not scanned.
- `brain bootstrap` keeps a repo git cannot read (owned by another account) as it was, reports a second repo with the same name instead of merging it, and takes no optional lock in your repos. Remotes keep spaces in paths and drop passwords that contain an `@`.
- `brain project rename` never overwrites: the new name must be free in `20_Projects`, `00_Inbox` and `90_Archive` in any case, and a move that fails half way is undone. Hidden folders move with the project, and a project without a hub takes its tasks along.
- README: plugin icon.

## 0.3.0 — 2026-10-22

- **`brain bootstrap [--dry-run]`**: every git repo directly under the workspace's folders gets a project hub with a generated `## Repo` section (remotes without credentials, branch, commits, last commit, tag, working tree, manifests), refreshed on each run. Excluded folders, names taken by other notes, relation candidates with their evidence and references to sibling folders that no longer exist are reported. Re-runnable after adding or renaming repos; the agent writes the prose (procedure in `skills/second-brain/bootstrap.md`).
- **`brain project rename <old> <new> [--dry-run]`**: moves the hub, the project folder, its topic notes, split board and archive, and rewrites links, `project:` fields, note titles and idea headings. Bootstrap proposes it when a repo folder was renamed (same first commit or remote) and holds that folder back until the user confirms.
- **`brain project relate <a> --<relation> <b> [--remove]`**: a relation written in both hubs: `depends_on` ↔ `used_by`, `source_of` ↔ `built_from` (new in the hub template), `related` both ways.
- **Hub next to its folder**: the hub is now `20_Projects/<project>.md`; the folder `20_Projects/<project>/` exists only once something goes in it. Older vaults keep working: `brain index` (also run by `brain commit`) moves each hub out of its folder and reports a project with a hub in both places. Update the plugin everywhere you use the vault before it is migrated: 0.2.0 does not see moved hubs.
- `brain status` counts repos without a hub and hubs whose repo folder is gone.
- The vault's `.gitignore` also ignores Obsidian's local state and plugins' `data.json`.
- New vaults: suggested hub sections in `WORKFLOW.md`, relation format in `TOOLS.md`. Existing vaults keep their files.

## 0.2.0 — 2026-10-22

- Codex plugin: manifest, hooks, twin skill.
- Project mode (`brain init --here`) and configuration kept in the folder (`brain init --config-here`).
- A vault repo created by the Codex sandbox on Windows stays usable: the plugin trusts the vault's own repo (`safe.directory`), nothing else.
- The skill changes the configuration only through the CLI.

## 0.1.0 — 2026-10-22

- First release for Claude Code.
