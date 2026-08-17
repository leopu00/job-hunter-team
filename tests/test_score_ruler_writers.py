"""[SCORE-DIMENSIONS-EXCEED-THEIR-CAP], passo 1: chi scrive fuori scala.

Il ticket imponeva un ordine — prima **chi** scrive, poi se i totali gia'
scritti vanno ricalcolati, la UI per ultima. Questo file chiude il primo
passo, e la risposta non e' «lo scorer» ne' «un backfill»:

    il righello esiste in UN SOLO posto di tutto il sistema, ed e' una
    funzione Python che il chiamante puo' semplicemente non chiamare.

Censito il 2026-08-17, leggendo il codice:

  * `shared/skills/db_insert.py::insert_score` valida tutte e cinque le
    dimensioni ed esce 1 — e lo fa dal 2026-03-24, quindi non e' mai stato lui
    a scrivere i valori fuori scala;
  * **nessun database lo impone**: la `scores` di SQLite non ha un solo CHECK
    (nemmeno su `total_score`), e sul cloud il CHECK copre `total_score` e
    lascia libere tutte e sette le colonne di dimensione (mig 001 + 003);
  * gli specchi — restore, push, local/sync — copiano alla lettera **per
    scelta**, e contano cio' che lasciano passare: i punteggi sono di utenti
    reali e un clamp al confine nasconderebbe il fenomeno invece di chiuderlo;
  * e le skill degli agenti concedono `Bash(python3 *)` — la `db-query` lo
    dichiara per iscritto — quindi un `INSERT` a mano su `jobs.db` non
    incontra nessun controllo, in nessun punto della catena.

Da qui la sorveglianza che questo file esercita: non «i valori sono in
scala» (non lo si puo' sapere senza i dati di un utente), ma **ogni scrittore
di `scores` o passa dal righello, o si dichiara specchio e conta**. Un
scrittore nuovo che non fa ne' l'una ne' l'altra e' il modo in cui il
fenomeno e' potuto crescere per mesi senza un colpevole.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))

# Chi puo' scrivere sulla tabella `scores`, e con quale ruolo. Non e' una lista
# di comodo: e' il censimento, e il test sotto fallisce se l'albero ne contiene
# uno che non e' qui.
#
#   valida   → rifiuta il fuori scala (e oggi ce n'e' esattamente uno)
#   specchio → copia alla lettera per scelta, ma DEVE contare cio' che passa
#   migrazione → gira una volta sola su dati gia' scritti
#   schema   → trigger che non toccano una dimensione (dimostrato sotto)
WRITERS = {
    "shared/skills/_db.py": "schema",
    "shared/skills/db_insert.py": "valida",
    "cli/src/commands/cloud.js": "specchio",
    "web/app/api/cloud-sync/push/route.ts": "specchio",
    "web/app/api/local/sync/route.ts": "specchio",
    "shared/skills/db_migrate.py": "migrazione",
    "shared/skills/db_migrate_v2.py": "migrazione",
    "supabase/seed.sql": "migrazione",
}

# Una scrittura sulla tabella, in SQL o via client Supabase.
WRITE = re.compile(
    r"(?:INSERT\s+(?:OR\s+REPLACE\s+)?INTO\s+scores\b"
    r"|UPDATE\s+scores\b"
    r"|from\([\"']scores[\"']\)\s*\.\s*(?:upsert|insert|update))",
    re.I,
)
# Dove NON si cerca: i test costruiscono database sintetici, l'archivio e' morto.
SKIP = ("tests/", "archive/", "docs/", "desktop/app-payload/", ".git/")
SEARCHED = ("*.py", "*.js", "*.ts", "*.tsx", "*.sql", "*.mjs")


def _tracked(pattern: str) -> list[str]:
    out = subprocess.check_output(
        ["git", "-C", str(ROOT), "ls-files", pattern], text=True
    )
    return [p for p in out.splitlines() if not p.startswith(SKIP)]


def _writers_found() -> set[str]:
    found = set()
    for pattern in SEARCHED:
        for rel in _tracked(pattern):
            try:
                body = (ROOT / rel).read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            if WRITE.search(body):
                found.add(rel)
    return found


FOUND = _writers_found()


def test_il_censimento_ha_trovato_qualcosa():
    """Un censimento vuoto renderebbe verde qualunque cosa."""
    assert len(FOUND) >= 4, FOUND


def test_nessuno_scrive_su_scores_senza_essere_censito():
    """Uno scrittore nuovo e' il modo in cui il fenomeno cresce senza colpevole."""
    ignoti = sorted(FOUND - set(WRITERS))
    assert not ignoti, (
        f"scrivono su `scores` e non sono nel censimento: {ignoti}. "
        f"O passano dal righello (`score_ranges.COMPONENT_LIMITS`), o si "
        f"dichiarano specchio e CONTANO cio' che lasciano passare "
        f"(`summarizeOutOfRange`). Un terzo modo non esiste: la tabella non "
        f"ha vincoli, ne' in SQLite ne' sul cloud."
    )


def test_il_censimento_non_nomina_scrittori_che_non_esistono_piu():
    """Una riga di censimento stantia sorveglia un file che nessuno esegue."""
    spariti = sorted(set(WRITERS) - FOUND)
    assert not spariti, spariti


@pytest.mark.parametrize(
    "path", sorted(p for p, ruolo in WRITERS.items() if ruolo == "specchio")
)
def test_ogni_specchio_conta_cio_che_lascia_passare(path):
    """Copiare alla lettera e' una scelta; farlo in silenzio no.

    E' la differenza fra «non correggiamo i punteggi degli utenti» e «non
    sappiamo quanti ne passano»: la prima e' una decisione, la seconda e' il
    motivo per cui il ticket e' rimasto senza numeri per mesi.
    """
    body = (ROOT / path).read_text(encoding="utf-8")
    # La CHIAMATA, non il nome: l'`import` da solo passerebbe un controllo di
    # sottostringa, e uno specchio che importa il righello senza usarlo e'
    # indistinguibile da uno che non ce l'ha. Verificato per mutazione.
    assert re.search(r"summarizeOutOfRange\s*\(", body), (
        f"{path} scrive su `scores` senza contare le dimensioni fuori scala. "
        f"Il righello condiviso e' gia' in tre lingue "
        f"(shared/skills/score_ranges.py, cli/src/lib/score-ranges.js, "
        f"web/lib/score-ranges.ts): usarlo costa una riga."
    )


def test_i_trigger_dello_schema_non_toccano_una_dimensione():
    """L'esenzione di `_db.py` si dimostra, non si dichiara.

    Le sue due scritture su `scores` sono trigger che rimettono a posto
    `created_at`/`updated_at`. Se un domani un trigger toccasse una dimensione
    sarebbe uno scrittore a tutti gli effetti — e per giunta invisibile, perche'
    non compare in nessun chiamante.
    """
    from score_ranges import COMPONENT_LIMITS

    body = (ROOT / "shared/skills/_db.py").read_text(encoding="utf-8")
    for statement in re.findall(r"UPDATE scores\s+SET(.*?)WHERE", body, re.S):
        toccate = set(re.findall(r"(\w+)\s*=", statement))
        fuori = toccate - {"created_at", "updated_at"}
        assert not fuori, f"un trigger scrive {sorted(fuori)} su `scores`"
        assert not toccate & set(COMPONENT_LIMITS), statement


def test_l_unico_writer_che_valida_copre_ogni_dimensione():
    """Non 'valida qualcosa': valida OGNI colonna che il righello dichiara.

    Fino al 2026-08-11 le cinque chiamate erano scritte a mano una per una —
    aggiungere una dimensione al righello non l'avrebbe validata, e nessuno
    se ne sarebbe accorto.
    """
    body = (ROOT / "shared/skills/db_insert.py").read_text(encoding="utf-8")
    assert "for column, maximum in COMPONENT_LIMITS.items():" in body
    assert "_validate_score_range(getattr(args, column), column, 0, maximum)" in body
    assert "from score_ranges import" in body, (
        "i tetti sono tornati a essere scritti a mano dentro db_insert.py"
    )


def test_il_righello_rifiuta_davvero_invece_di_avvisare():
    """Il comportamento, non solo il cablaggio: fuori scala ⇒ uscita 1."""
    from db_insert import _validate_score_range
    from score_ranges import COMPONENT_LIMITS

    for column, maximum in COMPONENT_LIMITS.items():
        with pytest.raises(SystemExit) as uscita:
            _validate_score_range(maximum + 1, column, 0, maximum)
        assert uscita.value.code == 1, column
        with pytest.raises(SystemExit):
            _validate_score_range(-1, column, 0, maximum)
        # Il confine e' ammesso, e `None` (dimensione non assegnata) pure.
        _validate_score_range(maximum, column, 0, maximum)
        _validate_score_range(None, column, 0, maximum)
