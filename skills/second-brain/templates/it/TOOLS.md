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
