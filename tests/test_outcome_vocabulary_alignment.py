"""
Un vocabolario solo per l'esito di una candidatura (#187).

Perché esiste: `applications.response` aveva **cinque** vocabolari in
circolazione e nessun `CHECK` a imporne uno — la colonna è TEXT libero sia in
SQLite sia in Postgres. Uno solo aveva un lettore vero (il Mentor:
`interview` / `rejected` / `ghosted`); gli altri erano documentazione che
diceva `rejection`, una dashboard con quattro valori suoi, e un modello
parallelo del web che non tocca nemmeno questa tabella.

Con `response` valorizzato in zero righe su 428, allinearli è costato zero
migrazioni: questo gate serve a non ricominciare da capo.

Cosa protegge:
  1. i tre valori compaiono **letterali** in tutte e sette le lingue di ogni
     superficie che li documenta — tradurli è il modo in cui un agente
     italiano finisce per scrivere `rifiuto` nel database;
  2. il vocabolario privato della vecchia dashboard non torna, in nessun file
     tracciato e senza eccezioni;
  3. la ricerca su cui si basa il punto 2 non è vuota: un gate che non trova
     niente perché sta guardando nel posto sbagliato è verde per il motivo
     sbagliato.

⚠️ NON è coperto, ed è voluto: `web/app/api/applications/route.ts` ha un suo
vocabolario (`draft`/`sent`/`viewed`/`interview`/`offer`/`rejected`) su un
modello PARALLELO salvato in `~/.jht/applications.json`, che non ha niente a
che vedere con la tabella `applications`. Non si allinea qui perché non è la
stessa cosa; va rimosso o riconciliato in un ticket suo.

Eseguire con: pytest tests/test_outcome_vocabulary_alignment.py -v
"""

import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
LOCALES = ("it", "es", "fr", "de", "pt", "hu")
OUTCOMES = ("interview", "rejected", "ghosted")

# Le superfici che DOCUMENTANO i valori all'utente-agente.
DOCUMENTING_SURFACES = (
    ("agents/_manual", "db-schema"),
    ("agents/_skills/db-update", "SKILL"),
    ("agents/_team", "architettura"),
)

# I valori del vocabolario privato della vecchia dashboard locale. Stanno qui
# e in nessun altro posto del repo: se ricompaiono altrove, il gate lo dice.
RETIRED_DASHBOARD_VALUES = (
    "interview_scheduled",
    "interview_done",
    "call_scheduled",
)


def surface_paths():
    for directory, stem in DOCUMENTING_SURFACES:
        base = REPO_ROOT / directory
        yield base / f"{stem}.md"
        for locale in LOCALES:
            yield base / f"{stem}.{locale}.md"


@pytest.mark.parametrize("path", list(surface_paths()), ids=lambda p: p.name)
def test_i_tre_valori_sono_letterali_in_ogni_lingua(path):
    text = path.read_text(encoding="utf-8")
    for value in OUTCOMES:
        assert f"`{value}`" in text, (
            f"{path.relative_to(REPO_ROOT)} non documenta il valore letterale "
            f"`{value}`: tradotto o assente, un agente scriverà altro nel DB"
        )


def tracked_text_files():
    """Tutti i file tracciati, chiesti a git e non a una lista scritta a mano."""
    listed = subprocess.run(
        ["git", "ls-files", "-z"], cwd=REPO_ROOT,
        capture_output=True, text=True, check=True,
    )
    for name in listed.stdout.split("\0"):
        if not name:
            continue
        path = REPO_ROOT / name
        if not path.is_file():
            continue
        # I test possono nominare i valori ritirati: è il loro mestiere.
        if name.startswith("tests/"):
            continue
        yield name, path


def test_la_ricerca_non_e_vuota():
    """La clausola che tiene onesto il test qui sotto.

    Se `git ls-files` cambiasse forma, o il filtro escludesse tutto, il gate
    diventerebbe verde senza aver guardato niente. Questo test dichiara la
    dimensione minima di ciò che stiamo davvero leggendo.
    """
    names = [name for name, _ in tracked_text_files()]
    assert len(names) > 500, f"perimetro sospetto: solo {len(names)} file letti"
    assert "shared/skills/dashboard_server.py" in names


def test_il_vocabolario_ritirato_non_torna():
    offenders = {}
    for name, path in tracked_text_files():
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue  # binari: non contengono vocabolari
        hits = [v for v in RETIRED_DASHBOARD_VALUES if v in text]
        if hits:
            offenders[name] = hits
    assert not offenders, (
        "vocabolario dell'esito ritirato ricomparso (usa `interview`): "
        f"{offenders}"
    )


def test_il_modello_parallelo_resta_dichiarato_e_fuori():
    """L'eccezione è nominata, non nascosta.

    Se un giorno quel file sparisce (rimosso o riconciliato), questo test
    diventa rosso e obbliga a togliere anche l'avvertimento dalla docstring —
    un'eccezione che sopravvive alla sua ragione è una trappola in più.
    """
    parallel = REPO_ROOT / "web/app/api/applications/route.ts"
    assert parallel.exists(), (
        "il modello parallelo non c'è più: aggiorna la docstring di questo "
        "file e la trappola in cima alla issue #187"
    )
    text = parallel.read_text(encoding="utf-8")
    assert "applications.json" in text, (
        "questo file non è più il modello parallelo su file: l'eccezione "
        "documentata qui non descrive più la realtà"
    )
