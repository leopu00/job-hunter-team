#!/usr/bin/env python3
"""Tetti per dimensione di uno score — la sola fonte, lato Python.

Prima questi cinque numeri stavano scritti a mano in `db_insert.py`, nei sette
prompt dello Scorer, in `tests/test_pipeline_agents.py`, nella pagina posizione
del web e nel pannello del gioco. Divergevano: l'esempio copiabile del prompt
ha insegnato `--experience-fit 20` contro un tetto di 10 per mesi, e nessuno
se n'è accorto perché ogni copia era corretta rispetto a sé stessa.

I gemelli JS sono `cli/src/lib/score-ranges.js` e `web/lib/score-ranges.ts`;
`tests/js/tasks/score-ranges.test.ts` rilegge da qui e fallisce se divergono.

⚠️ Contraddizione nota e NON risolta qui: la somma dei tetti fa 110, mentre
`--total` è validato 0..100. Le due regole «il totale è la somma delle
dimensioni» e «il totale sta in 0..100» non possono valere insieme in cima
alla scala. Chiuderla vuol dire ripesare le dimensioni, che è una decisione di
prodotto, non un riordino di questo file.
"""

from __future__ import annotations

# Ordine: quello in cui `db_insert.py score` li valida, per leggere il diff
# accanto al codice che li applica.
COMPONENT_LIMITS: dict[str, int] = {
    "stack_match": 40,
    "remote_fit": 25,
    "salary_fit": 20,
    "experience_fit": 10,
    "strategic_fit": 15,
}

#: Tetto del punteggio complessivo. Vedi la contraddizione nel docstring.
TOTAL_LIMIT = 100

#: Nome leggibile di ogni dimensione, per il testo di `--help` della CLI.
SCORE_COMPONENT_LABELS: dict[str, str] = {
    "stack_match": "Stack",
    "remote_fit": "Remote/location",
    "salary_fit": "Salary",
    "experience_fit": "Seniority",
    "strategic_fit": "Strategic",
}


def out_of_range(values: dict[str, int | None]) -> list[tuple[str, int, int]]:
    """Elenca le dimensioni fuori dal proprio intervallo `[0, tetto]`.

    Conta, non corregge: i punteggi già scritti appartengono a utenti reali e
    un clamp silenzioso nasconderebbe il fenomeno invece di chiuderlo.

    :returns: lista di ``(colonna, valore, tetto)``, vuota se tutto è in scala.
    """
    found = []
    for column, maximum in COMPONENT_LIMITS.items():
        value = values.get(column)
        if value is None or isinstance(value, bool):
            continue
        if not isinstance(value, int):
            continue
        if value < 0 or value > maximum:
            found.append((column, value, maximum))
    return found
