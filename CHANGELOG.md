# Changelog

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
