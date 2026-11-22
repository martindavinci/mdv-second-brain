# Attention feed — format v1

The second brain keeps, per workspace, a queue of things that wait for the user: commits and tags to push, a draft release, a failed CI run, a question an agent session left for later, and so on. It can export that queue as a JSON file — the **attention feed** — for a reader app to show (a list, a badge, desktop notifications). This document is the whole contract: a reader needs nothing else from the brain.

## Where the file is

The user lists folders in the brain's configuration:

```json
"workspaces": {
  "<workspace>": {
    "attention": { "outputs": [{ "type": "feed", "dir": "<absolute folder>" }], "remoteTtlHours": 6 }
  }
}
```

Each workspace writes `<dir>/brain-<workspace>.json`. Two workspaces never share a file, and a file never holds another workspace's items. The folder belongs to the reader: the brain never creates it (a missing folder is reported in the brain's log, and the rest of the brain keeps working).

## When it changes

The brain recomputes the queue in the background after each agent turn (at most once every two minutes per workspace), and when the user runs `brain attention --refresh`, snoozes an item or answers a question. The file is rewritten only when its content changed (`generatedAt` alone does not count), and always whole: written to a temporary file in the same folder, then renamed over the old one. A reader may watch the file or poll it; it never sees half a file. Ignore files in the folder that do not match `brain-*.json`.

## Top level

```json
{
  "format": "attention-feed",
  "version": 1,
  "source": "mdv-second-brain",
  "workspace": "work",
  "generatedAt": "2026-11-22T17:04:11.000Z",
  "remote": { "ok": false, "reason": "gh not found", "at": "2026-11-22T11:00:02.000Z" },
  "items": [ … ]
}
```

| Field | Type | Meaning |
|---|---|---|
| `format` | string | always `"attention-feed"`; skip a file with any other value |
| `version` | integer | `1` for this document. A reader that knows version 1 reads any `1`; a higher version may change meanings: show it as unsupported, or read it as 1 only if you accept the risk |
| `source` | string | the program that wrote the file |
| `workspace` | string | the workspace this file is about |
| `generatedAt` | string | ISO 8601 UTC time of the computation |
| `remote` | object | the network part of the queue (GitHub releases and CI, tags on remotes) |
| `remote.ok` | boolean | `true`: the last attempt worked. `false`: it was skipped or failed; the GitHub items may be old or missing |
| `remote.reason` | string, optional | why `ok` is false, for a person to read (e.g. `"gh not found"`, `"gh not authenticated or offline"`) |
| `remote.at` | string, optional | when the network part last worked |
| `items` | array | the queue, without the items the user snoozed or answered |

The network part is asked at most every `remoteTtlHours` (default 6), so its items can be that old even when `ok` is true.

## Items

```json
{
  "id": "3f9a1c0b7e21",
  "kind": "unpushed",
  "severity": "action",
  "title": "app: 2 commits to push (main)",
  "detail": "main is 2 ahead of origin/main",
  "project": "app",
  "firstSeen": "2026-11-22T09:12:40.000Z",
  "actions": [
    { "type": "copy", "label": "Push", "value": "git -C \"C:\\code\\app\" push origin main" },
    { "type": "open-folder", "label": "Open folder", "path": "C:\\code\\app" }
  ]
}
```

| Field | Type | Meaning |
|---|---|---|
| `id` | string | identifies this item *episode* (see below); stable while the item stays in the queue |
| `kind` | string | what it is (list below); a reader may group or pick icons by it, and must accept kinds it does not know |
| `severity` | string | `"action"`: the user has something to do; `"info"`: worth knowing, nothing urgent. Treat an unknown value as `"info"` |
| `title` | string | one line, at most 200 characters, ready to show |
| `detail` | string | more text, may be empty |
| `project` | string or null | the project (repo) it belongs to, null for the workspace as a whole |
| `firstSeen` | string | ISO 8601 UTC time the episode started |
| `actions` | array | what the reader can offer; may be empty |

Kinds in version 1:

| Kind | Severity | Meaning |
|---|---|---|
| `unpushed` | action | commits on a branch not yet on its upstream |
| `no-upstream` | action | `main` or `master` tracks no remote branch, though the repo has a remote |
| `tag-not-pushed` | action | local tags missing on the remote |
| `dirty` | action | uncommitted changes older than three days |
| `draft-release` | action | a GitHub release left as a draft |
| `ci-failed` | action | the latest CI run of the default branch failed |
| `playbook` | action | checks of a playbook the project follows fail |
| `plugin-behind` | action | a Claude Code plugin is installed at an older version than its repo released |
| `question` | action | a question an agent session queued for the user |
| `stale-hub` | info | the project's note no longer matches its repo (new tags or many commits since it was written) |
| `playbook-suggestion` | info | the repo looks like a family a playbook describes, but its note does not follow it |
| `stalled` | info | a task or issue in progress untouched for over 14 days |
| `vault-unpushed` | info | the brain's own notes have commits not pushed for over three days |

## Actions

| Type | Fields | What a reader does |
|---|---|---|
| `copy` | `label`, `value` | offers to copy `value` (a command line) to the clipboard. Never run it: the user decides |
| `open-folder` | `label`, `path` | opens the folder in the file manager |
| `open-url` | `label`, `url` | opens the `https://` URL in the browser |
| `open-note` | `label`, `path` | opens the Markdown note at `path` (absolute), for example in Obsidian or an editor |

Commands in `copy` actions are built by the brain from facts it read (folder paths, branch, tag and plugin names), never taken from a note's text; a part that some shell would expand inside double quotes makes the brain leave the action out. Skip action types you do not know.

## Ids and episodes

An item is an **episode** of a situation: one kind, in one repo, about one thing (a branch, a tag, a playbook, a question). While the situation lasts, every refresh keeps its `id` and `firstSeen`, even when its title or detail change (more commits to push, more days dirty). When it is solved it leaves the queue; if it comes back later, it is a new episode with a new `id` and a new `firstSeen`. So:

- notify once per `id`: an id you have not seen before is news;
- an id that disappears was solved, snoozed or answered — drop it;
- do not try to match a returning item to an old one.

The user hides an item with `brain attention snooze <id> [--until YYYY-MM-DD]` (it comes back with the same `id` if it is still there after that date) and clears a question with `brain attention done <id>`. Other kinds leave the queue only when the brain sees them solved.

## Compatibility

Readers must ignore fields they do not know, at any level, and items or actions of unknown kinds or types. New fields, kinds and action types may appear within version 1; a change that alters the meaning of an existing field raises `version`.

## Privacy

The file holds repo names, local paths and the text of queued questions. It stays on the machine, in the folder the user chose; the brain never sends it anywhere.
