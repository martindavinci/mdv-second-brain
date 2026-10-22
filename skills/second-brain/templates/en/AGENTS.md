# Vault rules

Maintained by an AI agent (mdv-second-brain). These rules override the plugin defaults: edit them freely.

- Never delete a note: "delete" means move it to `90_Archive/`, and only when the user asks.
- Current truth, rewritable: feature notes, project hubs, distilled project notes.
- History, lines never removed (mark them, or let the CLI move them to `90_Archive/`): tasks, issues, post mortems, dailies, `DECISIONS.md`, `MEMORY.md`, `Ideas.md`.
- Never touch sections written by the user.
- Link with `[[Name]]`: note names are unique in the vault; do not rename notes without a reason.
- Keep the layout: one folder per project in `20_Projects/<project>/`, cross-project knowledge in `10_Notes/`.
- Explicit states; every note says its project.
- No empty sections: a section or a note exists only with real content.
- Generated content (`Bugs.md`, `Features.md`, text between `<!-- brain:… -->` markers) is rebuilt by the CLI: never edit it by hand.
- Secrets only in `secrets.local.md`; elsewhere write `{{secret:KEY}}`.
- Keep notes within the size budgets; read with `brain context`, `brain show --section`, `brain search`.
