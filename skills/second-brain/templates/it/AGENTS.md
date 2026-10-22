# Regole del vault

Gestito da un agente AI (mdv-second-brain). Queste regole hanno la precedenza sui default del plugin: modificale liberamente.

- Mai cancellare una nota: "elimina" vuol dire spostarla in `90_Archive/`, e solo se lo chiede l'utente.
- Verità attuale, riscrivibile: note feature, hub di progetto, note distillate di progetto.
- Storia, righe mai rimosse (si marcano, oppure la CLI le sposta in `90_Archive/`): task, issue, post mortem, daily, `DECISIONS.md`, `MEMORY.md`, `Ideas.md`.
- Mai toccare le sezioni scritte dall'utente.
- Link con `[[Nome]]`: i nomi delle note sono unici nel vault; non rinominare note senza motivo.
- Rispetta la struttura: un hub per progetto in `20_Projects/<progetto>.md`, le sue note in `20_Projects/<progetto>/`, conoscenza trasversale in `10_Notes/`.
- Stati espliciti; ogni nota indica il suo progetto.
- Nessuna sezione vuota: una sezione o una nota esiste solo con contenuto reale.
- Contenuto generato (`Bugs.md`, `Features.md`, testo tra i marker `<!-- brain:… -->`) è ricostruito dalla CLI: mai modificarlo a mano.
- Segreti solo in `secrets.local.md`; altrove scrivi `{{secret:KEY}}`.
- Tieni le note entro i budget di dimensione; leggi con `brain context`, `brain show --section`, `brain search`.
