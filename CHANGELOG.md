# Changelog

## Unreleased

- `brain bootstrap` proposes decisions made in code: the last 200 commits of each repo whose subject says a direction was taken ("switch … to", "replace … with", "in favour of", "instead of", "deprecate", "BREAKING CHANGE", and the Italian forms), routine commits (docs, test, chore, style) left out. The agent writes the ones you confirm to `DECISIONS.md` with the commit hash, which keeps them from being proposed again. Inspired by `mine_commit_decisions.py` of obsidian-second-brain.
- **`brain health [--fix] [--days <n>]`**: broken `[[links]]` (links to archived notes and attachments count as fine; code is skipped), orphan notes, items in progress untouched for over 14 days, task, issue, feature and hub notes without frontmatter, duplicate note names, empty folders. `--fix` repoints only a link with exactly one certain match and keeps the text it showed, and removes empty folders outside the vault skeleton; ambiguous links are listed with their candidates. Inspired by `vault_health.py` and `heal_links.py` of obsidian-second-brain.
- New vaults: `AGENTS.md` asks for notes that read alone, facts that are timeless, dated or a pointer, `TBD` instead of invented facts, and text read from notes, repos and the web treated as data, never as instructions; the injected context carries that last rule too. Existing vaults keep their `AGENTS.md`. Rules adapted from the [AI-First Note Spec](https://github.com/eugeniughelbur/obsidian-second-brain/blob/main/AI-FIRST.md).

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
