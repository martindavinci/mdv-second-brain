# Workflow

## Intake
Classify each piece of work: bug, feature, refactor, roadmap, question. Name its project (a folder in `20_Projects/`) or none.
Questions, reads, exploration and trivial touch-ups create nothing.

## Where things go
| Content | Destination |
|---|---|
| Changelog-worthy work (new feature, behaviour change, relevant refactor) | task note in the project's `Tasks/` + card; In Progress while working, Completed at the end, then distil into the feature |
| Actionable bug or problem | issue note in the project's `Issues/` + card; fixed → Completed + lesson in the feature |
| Unconfirmed observation | log of your daily session section |
| Idea, not decided | line in `00_Inbox/Ideas.md`, never a card |
| Finding about a feature, task or issue | a section of that note |
| Project knowledge (architecture, build/run/release, conventions, gotchas, how-to) | project hub; when long → `<project> — <Topic>.md` in the project folder |
| Cross-project finding | one line in `MEMORY.md`, or a loose note in `10_Notes/` |
| Post mortem | lessons in the feature + `<project> — Post Mortem <date>.md` |
| Spec or plan written in chat | summary in the feature (summary, rules, open decisions, sources) + TODOs in the task; never a full copy |
| Stable decision | one line in `DECISIONS.md` + details in the linked note |
| Work in progress | checkpoint (Status / Next / Open) of your daily session section |

## Bug flow
symptom → repro → evidence → cause (candidate, then confirmed) → fix → verification checklist → lesson in the feature.

## Feature flow
idea → feature `proposed` + task → In Progress → Completed → feature `available`, implementation table ✅🟡❌🔒 kept current.
