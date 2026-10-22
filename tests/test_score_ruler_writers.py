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

import functools
import re
import subprocess
import warnings
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
    # L'harness API (agent-harness/runtime) e' il secondo motore che scrive
    # `scores`: gli agenti che girano sull'API invece che nella TUI passano di
    # li'. Stessi due ruoli del prodotto — lo schema sono trigger, il tool
    # valida — e sotto si dimostrano entrambi.
    "agent-harness/runtime/src/db/schema.sql": "schema",
    "agent-harness/runtime/src/db/tools.ts": "valida",
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
# `agent-harness/runtime/tests/` e' l'equivalente di `tests/` per l'harness —
# database sintetici in cartelle temporanee, mai quello dell'utente — e va
# nominato a parte perche' il prefisso `tests/` non lo copre. Escluso l'albero
# dei test, non l'harness: i suoi sorgenti restano sorvegliati (sopra).
# `desktop/app-payload/` non c'e' piu': e' stato tolto dal repo e dal contesto
# dell'immagine (#177). Se tornasse, va sorvegliato come il resto, quindi non
# sta qui; il test sulle voci morte sotto impedisce che ci rientri un albero
# che non esiste.
SKIP = (
    "tests/",
    "agent-harness/runtime/tests/",
    "archive/",
    "docs/",
    ".git/",
)
SEARCHED = ("*.py", "*.js", "*.ts", "*.tsx", "*.sql", "*.mjs")
# Lo stesso vale per i test che vivono accanto al codice (vitest `*.test.ts`
# nel desktop e nel web): costruiscono database sintetici, mai quello
# dell'utente. Si escludono per suffisso, non per cartella, cosi' il codice
# che sta accanto a loro resta sorvegliato.
TEST_SUFFIXES = (".test.ts", ".test.tsx", ".test.js", ".test.mjs")


# Escluderli per suffisso regge solo se il codice di prodotto non li IMPORTA:
# uno scrittore vero chiamato `*.test.ts` e importato da una rotta sparirebbe
# dal censimento. Si cerca la forma dell'import (from, import, require,
# import(), import.meta.glob), non il nome: molti commenti citano i test per
# nome. L'estensione puo' mancare (`./x.test`) e la query di Vite (`?raw`) pure.
JS_SOURCES = ("*.js", "*.mjs", "*.cjs", "*.jsx", "*.ts", "*.tsx")
_TEST_MODULE = (
    r"[^'\"`\n]*\.test(?:"
    + "|".join(re.escape(s[len(".test"):]) for s in TEST_SUFFIXES)
    + r")?(?:\?[^'\"`\n]*)?"
)
TEST_IMPORT = re.compile(
    r"(?:\b(?:from|import)\s*['\"]" + _TEST_MODULE + r"['\"]"
    r"|\b(?:require|import|import\.meta\.glob)\s*\(\s*['\"`]" + _TEST_MODULE + r"['\"`])"
)
ANY_IMPORT = re.compile(r"\b(?:from|import)\s*['\"]|\brequire\s*\(\s*['\"]")


def _tracked(pattern: str) -> list[str]:
    out = subprocess.check_output(
        ["git", "-C", str(ROOT), "ls-files", pattern], text=True
    )
    return [
        p for p in out.splitlines()
        if not p.startswith(SKIP) and not p.endswith(TEST_SUFFIXES)
    ]


# File tracciati che non stanno sul disco (checkout parziale, sparse): si
# leggono dall'indice di git e si contano, mai si saltano. Un file saltato e'
# un file che il censimento non ha visto, e il verde direbbe il contrario.
ABSENT: dict[str, int] = {}


@functools.lru_cache(maxsize=None)
def _read(rel: str) -> str:
    try:
        return (ROOT / rel).read_text(encoding="utf-8", errors="ignore")
    except OSError:
        pass
    shown = subprocess.run(
        ["git", "-C", str(ROOT), "show", f":{rel}"], capture_output=True
    )
    assert shown.returncode == 0, (
        f"{rel} e' tracciato ma non si legge ne' dal disco ne' dall'indice: "
        f"il censimento non puo' dire di averlo visto"
    )
    ABSENT[rel] = len(shown.stdout)
    return shown.stdout.decode("utf-8", errors="ignore")


def _writers_found() -> set[str]:
    found = set()
    for pattern in SEARCHED:
        for rel in _tracked(pattern):
            body = _read(rel)
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


def test_lo_skip_non_nomina_alberi_che_non_esistono_piu():
    """Una voce morta nello SKIP e' un buco pronto: l'albero torna, e nessuno lo guarda.

    E' successo con `desktop/app-payload/`, tolto dal repo il 17/08 e rimasto
    escluso qui per due mesi. `.git/` non e' mai tracciato: resta come guardia.
    """
    tracciati = subprocess.check_output(
        ["git", "-C", str(ROOT), "ls-files"], text=True
    ).splitlines()
    morte = [
        voce for voce in SKIP
        if voce != ".git/" and not any(p.startswith(voce) for p in tracciati)
    ]
    assert not morte, f"lo SKIP esclude alberi che non esistono: {morte}"


def test_i_file_assenti_dal_disco_sono_letti_e_dichiarati():
    """Su un checkout parziale il censimento legge dall'indice, e lo dice."""
    for pattern in sorted(set(SEARCHED) | set(JS_SOURCES)):
        for rel in _tracked(pattern):
            _read(rel)
    if ABSENT:
        esempi = ", ".join(sorted(ABSENT)[:5])
        warnings.warn(
            f"{len(ABSENT)} file tracciati non sono sul disco e il censimento "
            f"li ha letti dall'indice di git (per esempio {esempi})",
            stacklevel=1,
        )


def test_un_file_che_non_si_legge_ferma_il_censimento():
    """Ne' sul disco ne' nell'indice: rosso, non un file in meno."""
    with pytest.raises(AssertionError, match="non si legge"):
        _read.__wrapped__("shared/skills/non-esiste-davvero.py")


def test_il_censimento_non_nomina_scrittori_che_non_esistono_piu():
    """Una riga di censimento stantia sorveglia un file che nessuno esegue."""
    spariti = sorted(set(WRITERS) - FOUND)
    assert not spariti, spariti


def test_nessun_file_di_prodotto_importa_un_modulo_di_test():
    """L'esclusione per suffisso vale solo se i `*.test.*` restano test.

    Se un file di prodotto ne importa uno, quel modulo gira nel prodotto ma
    il censimento non lo legge: uno scrittore di `scores` li' dentro non
    comparirebbe mai sopra.
    """
    importatori = {}
    import_letti = 0
    for pattern in JS_SOURCES:
        for rel in _tracked(pattern):
            body = _read(rel)
            import_letti += len(ANY_IMPORT.findall(body))
            trovati = [m.group(0) for m in TEST_IMPORT.finditer(body)]
            if trovati:
                importatori[rel] = trovati
    # Senza import letti il controllo sarebbe verde su un albero vuoto.
    assert import_letti >= 100, import_letti
    assert not importatori, (
        f"codice di prodotto che importa moduli di test: {importatori}. "
        f"Il censimento degli scrittori salta i `*.test.*` "
        f"({', '.join(TEST_SUFFIXES)}): quel che serve al prodotto va in un "
        f"file senza il suffisso."
    )


@pytest.mark.parametrize(
    "riga, importa",
    [
        ('import { scrivi } from "./scores.test";', True),
        ("import { scrivi } from './scores.test.ts';", True),
        ('export * from "../lib/scores.test.tsx";', True),
        ('import "./setup.test.js";', True),
        ('const m = await import("./scores.test.mjs");', True),
        ("const m = require('./scores.test');", True),
        ('const all = import.meta.glob("./**/*.test.ts");', True),
        ('import raw from "./scores.test.ts?raw";', True),
        ("// la guardia sta in `tests/js/tasks/scores.test.ts`", False),
        ('import { a } from "./scores.testing";', False),
        ('import { a } from "./latest";', False),
        ('include: ["../../web/lib/**/*.test.ts"],', False),
    ],
)
def test_la_forma_dell_import_di_un_test(riga, importa):
    """Le forme che il controllo sopra riconosce, e i commenti che non deve prendere."""
    assert bool(TEST_IMPORT.search(riga)) is importa


@pytest.mark.parametrize(
    "path", sorted(p for p, ruolo in WRITERS.items() if ruolo == "specchio")
)
def test_ogni_specchio_conta_cio_che_lascia_passare(path):
    """Copiare alla lettera e' una scelta; farlo in silenzio no.

    E' la differenza fra «non correggiamo i punteggi degli utenti» e «non
    sappiamo quanti ne passano»: la prima e' una decisione, la seconda e' il
    motivo per cui il ticket e' rimasto senza numeri per mesi.
    """
    body = _read(path)
    # La CHIAMATA, non il nome: l'`import` da solo passerebbe un controllo di
    # sottostringa, e uno specchio che importa il righello senza usarlo e'
    # indistinguibile da uno che non ce l'ha. Verificato per mutazione.
    assert re.search(r"summarizeOutOfRange\s*\(", body), (
        f"{path} scrive su `scores` senza contare le dimensioni fuori scala. "
        f"Il righello condiviso e' gia' in tre lingue "
        f"(shared/skills/score_ranges.py, cli/src/lib/score-ranges.js, "
        f"web/lib/score-ranges.ts): usarlo costa una riga."
    )


@pytest.mark.parametrize(
    "path", sorted(p for p, ruolo in WRITERS.items() if ruolo == "schema")
)
def test_i_trigger_dello_schema_non_toccano_una_dimensione(path):
    """L'esenzione degli schemi si dimostra, non si dichiara.

    Le scritture su `scores` di `_db.py` e dello schema dell'harness (che di
    quello e' una copia) sono trigger che rimettono a posto
    `created_at`/`updated_at`. Se un domani un trigger toccasse una dimensione
    sarebbe uno scrittore a tutti gli effetti — e per giunta invisibile, perche'
    non compare in nessun chiamante.
    """
    from score_ranges import COMPONENT_LIMITS

    body = _read(path)
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
    body = _read("shared/skills/db_insert.py")
    assert "for column, maximum in COMPONENT_LIMITS.items():" in body
    assert "_validate_score_range(getattr(args, column), column, 0, maximum)" in body
    assert "from score_ranges import" in body, (
        "i tetti sono tornati a essere scritti a mano dentro db_insert.py"
    )


def test_il_writer_dell_harness_ha_lo_STESSO_righello_e_lo_copre_tutto():
    """Il secondo motore ha una COPIA del righello: qui si dimostra uguale.

    `agent-harness/runtime` gira in un'immagine senza `shared/`, quindi non
    puo' importare `score_ranges.py`: i tetti sono ricopiati in TypeScript.
    Una copia e' il modo in cui il righello si sdoppia in silenzio — e' gia'
    successo fra il prompt dello Scorer e `db_insert.py`, con
    `--experience-fit 20` contro un tetto di 10 per mesi. Quindi non basta che
    l'harness validi «qualcosa»: deve validare le STESSE colonne con gli
    STESSI numeri, e il giorno che il righello ne guadagna una, questo test
    diventa rosso invece di lasciarla passare.
    """
    from score_ranges import COMPONENT_LIMITS, TOTAL_LIMIT

    body = _read("agent-harness/runtime/src/db/tools.ts")
    totale = re.search(r"const SCORE_TOTAL_LIMIT = (\d+);", body)
    blocco = re.search(r"const SCORE_COMPONENT_LIMITS = \{(.*?)\}", body, re.S)
    assert totale and blocco, "i tetti dell'harness non si leggono piu': il gate non sorveglia piu' niente"
    assert int(totale.group(1)) == TOTAL_LIMIT
    assert {k: int(v) for k, v in re.findall(r"(\w+):\s*(\d+)", blocco.group(1))} == COMPONENT_LIMITS

    # E la validazione gira su TUTTA la mappa, non su cinque righe scritte a
    # mano: e' la stessa lezione del 2026-08-11 sul writer Python.
    assert re.search(
        r'for \(const \[column, maximum\] of \[\["total", SCORE_TOTAL_LIMIT\], '
        r'\.\.\.Object\.entries\(SCORE_COMPONENT_LIMITS\)\]',
        body,
    ), "l'harness non valida piu' ogni dimensione del righello"


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
