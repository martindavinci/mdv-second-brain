# Workflow

## Intake
Classifica ogni lavoro: bug, feature, refactor, roadmap, domanda. Indica il progetto (un hub in `20_Projects/`) o nessuno.
Domande, letture, esplorazione e ritocchi banali non creano nulla.

## Dove va cosa
| Contenuto | Destinazione |
|---|---|
| Lavoro da changelog (feature nuova, cambio di comportamento, refactor rilevante) | nota task nei `Tasks/` del progetto + card; In Progress mentre si lavora, Completed alla fine, poi distillazione nella feature |
| Bug o problema azionabile | nota issue negli `Issues/` del progetto + card; risolto → Completed + lezione nella feature |
| Osservazione non confermata | log della tua sezione di sessione nella daily |
| Idea non decisa | riga in `00_Inbox/Ideas.md`, mai una card |
| Scoperta su una feature, un task o un'issue | una sezione di quella nota |
| Conoscenza del progetto (architettura, build/run/release, convenzioni, gotcha, how-to) | hub del progetto; se lunga → `<progetto> — <Argomento>.md` nella cartella del progetto |
| Scoperta trasversale | una riga in `MEMORY.md`, o una nota sciolta in `10_Notes/` |
| Post mortem | lezioni nella feature + `<progetto> — Post Mortem <data>.md` |
| Spec o plan scritti in chat | sintesi nella feature (riepilogo, regole, decisioni aperte, fonti) + TODO nel task; mai copia integrale |
| Decisione stabile | una riga in `DECISIONS.md` + dettagli nella nota linkata |
| Lavoro in corso | checkpoint (Stato / Next / Aperto) della tua sezione di sessione nella daily |

## Hub di progetto
`20_Projects/<progetto>.md`: riepilogo di 2–4 frasi, poi solo le sezioni con contenuto reale tra Stack, Struttura, Build / run / release (o Workflow), Convenzioni, Gotcha, Stato. `## Repo` è generato da `brain bootstrap`: non modificarlo.

## Flusso bug
sintomo → repro → evidenze → causa (candidata, poi confermata) → fix → checklist di verifica → lezione nella feature.

## Flusso feature
idea → feature `proposed` + task → In Progress → Completed → feature `available`, tabella di implementazione ✅🟡❌🔒 aggiornata.
