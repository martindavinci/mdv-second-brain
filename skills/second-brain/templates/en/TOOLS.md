# Tags and markers

## Areas
`#area/<name>`. Areas of this workspace:

## Status
`#status/todo` `#status/in-progress` `#status/blocked` `#status/completed` `#status/discarded`
Blocked is a flag (`blocked: true` + `#status/blocked`), not a board lane.

## Implementation status (feature notes)
✅ done · 🟡 partial · ❌ missing · 🔒 blocked

## Evidence
Cite file paths, commands and their output; mark a cause as candidate until it is confirmed.

## Project relations (hub frontmatter)
`depends_on`, `used_by`, `source_of`, `built_from`, `related`: lists of `"[[project]]"`. Set them with `brain project relate <a> --depends-on <b>` (or `--used-by`, `--source-of`, `--built-from`, `--related`), which updates both hubs; `--remove` takes a relation off both.

## Playbooks and checks
A playbook is a note in `10_Notes/` with `type: playbook` and `applies_when: ["<glob>", …]` (repo files that mark the family; a match only suggests it). Each check is one line anywhere in it:
`` - `<id>` — `<glob>` has|lacks|exists `<text or /regex/>` ``
The glob is relative to the repo; each wildcard folder is checked on its own (`apps-*/Manifest.xml` → one result per `apps-*` folder). A hub follows a playbook with `brain project playbook <p> "<playbook>"`; intentional differences go in `brain project waive <p> <id|id@folder|"[[Playbook]]">`. `brain check` reports, before every tag or release.
