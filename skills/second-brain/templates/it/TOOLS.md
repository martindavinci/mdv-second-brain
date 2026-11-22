# Tag e marker

## Aree
`#area/<nome>`. Aree di questa workspace:

## Stato
`#status/todo` `#status/in-progress` `#status/blocked` `#status/completed` `#status/discarded`
Bloccato è un flag (`blocked: true` + `#status/blocked`), non una colonna della board.

## Stato implementazione (note feature)
✅ fatto · 🟡 parziale · ❌ mancante · 🔒 bloccato

## Evidenze
Cita path, comandi e il loro output; una causa resta candidata finché non è confermata.

## Relazioni tra progetti (frontmatter dell'hub)
`depends_on`, `used_by`, `source_of`, `built_from`, `related`: liste di `"[[progetto]]"`. Si impostano con `brain project relate <a> --depends-on <b>` (o `--used-by`, `--source-of`, `--built-from`, `--related`), che aggiorna entrambi gli hub; `--remove` toglie la relazione da tutti e due.

## Playbook e controlli
Un playbook è una nota in `10_Notes/` con `type: playbook` e `applies_when: ["<glob>", …]` (file della repo che riconoscono la famiglia; una corrispondenza lo suggerisce soltanto). Ogni controllo è una riga, in qualunque punto della nota:
`` - `<id>` — `<glob>` has|lacks|exists `<testo o /regex/>` ``
Il glob è relativo alla repo; ogni cartella con caratteri jolly si verifica a sé (`apps-*/Manifest.xml` → un esito per cartella `apps-*`). Un hub segue un playbook con `brain project playbook <p> "<playbook>"`; le differenze volute vanno in `brain project waive <p> <id|id@cartella|"[[Playbook]]">`. `brain check` riporta l'esito, prima di ogni tag o release.
