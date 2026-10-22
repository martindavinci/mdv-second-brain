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
