"""O-26 — un database non configurato deve FALLIRE, non essere indovinato.

`_db.py` ripiegava su `shared/data/jobs.db` quando non trovava le variabili
che legge. Chi sbagliava nome — `JHT_DB_PATH`, che è il nome lato web e viene
per riflesso a chiunque passi da lì — non riceveva nessun errore: la scrittura
riusciva, nel posto sbagliato, e un'operazione riuscita non lascia niente da
cercare. È successo almeno due volte (13/07/2026 e 10/08/2026), a persone
diverse, senza che nessuna se ne accorgesse.

⚠️ Questi test girano SENZA le variabili, ed è l'unico modo di vederlo: con
`JHT_HOME` impostata il difetto non si manifesta, esattamente come il test a
cloud spento non distingue "funziona offline" da "ha trovato la rete".

Il danno peggiore non è il file sporco nel repo (che .gitignore copre): è che
con `JHT_HOME` che punta ai dati veri di qualcuno, lo stesso errore di nome ci
scrive dentro dati di prova. Per questo il nome sbagliato viene respinto
*prima* di qualunque scrittura.
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))

DB_ENV = ("JHT_DB", "JHT_HOME", "JHT_DB_FALLBACK", "JHT_DB_PATH")


@pytest.fixture()
def unconfigured(monkeypatch):
    """Nessuna variabile: la condizione in cui il difetto esisteva."""
    for name in DB_ENV:
        monkeypatch.delenv(name, raising=False)
    import _db
    return importlib.reload(_db)


def test_importing_the_module_still_works(unconfigured):
    """Il fallimento è per chi USA il database, non per chi lo nomina.

    Risolvere il path all'import farebbe fallire anche la collection di
    pytest, che importa i moduli prima che le fixture preparino l'ambiente:
    un difetto silenzioso sostituito da un blocco rumoroso.
    """
    assert unconfigured is not None


def test_asking_for_the_path_fails_and_says_what_is_missing(unconfigured):
    with pytest.raises(unconfigured.DbPathNotConfigured) as err:
        unconfigured.DB_PATH
    message = str(err.value)
    # Il messaggio deve NOMINARE le variabili giuste: un errore che dice solo
    # "non configurato" lascia chi legge a indovinare quale scrivere.
    assert "JHT_DB" in message and "JHT_HOME" in message


def test_opening_the_database_fails_too(unconfigured):
    with pytest.raises(unconfigured.DbPathNotConfigured):
        unconfigured.get_db()


def test_the_likely_wrong_name_is_refused_BY_NAME(monkeypatch):
    """`JHT_DB_PATH` esiste lato web e non qui: ignorarlo era il difetto.

    Chi l'ha scritta crede di aver configurato il database. Dirle "nessun
    database configurato" la manderebbe a cercare nel posto sbagliato: il
    messaggio deve nominare la variabile che ha usato.
    """
    for name in DB_ENV:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("JHT_DB_PATH", "/tmp/whatever.db")
    import _db
    module = importlib.reload(_db)

    with pytest.raises(module.DbPathNotConfigured) as err:
        module.get_db()
    message = str(err.value)
    assert "JHT_DB_PATH" in message
    assert "/tmp/whatever.db" in message, "il valore ignorato va mostrato"


@pytest.mark.parametrize("wrong", ["JHT_DATABASE", "JHT_DB_FILE", "JHT_JOBS_DB"])
def test_other_plausible_wrong_names_too(monkeypatch, wrong):
    for name in DB_ENV + ("JHT_DATABASE", "JHT_DB_FILE", "JHT_JOBS_DB"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv(wrong, "/tmp/whatever.db")
    import _db
    module = importlib.reload(_db)
    with pytest.raises(module.DbPathNotConfigured) as err:
        module.get_db()
    assert wrong in str(err.value)


def test_the_documented_fallback_survives_but_must_be_asked_for(monkeypatch):
    """Il fallback fuori container è documentato in agents/_manual: resta.

    Cambia che va CHIESTO. Ci si finiva dentro per sbaglio, ed è la
    differenza fra un default e una scelta.
    """
    for name in DB_ENV:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("JHT_DB_FALLBACK", "1")
    import _db
    module = importlib.reload(_db)
    assert module.DB_PATH.endswith("jobs.db")
    assert "data" in module.DB_PATH


def test_the_normal_configuration_is_untouched(monkeypatch, tmp_path):
    """Chi oggi funziona — container e test, che impostano JHT_HOME — non
    deve accorgersi di niente."""
    for name in DB_ENV:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    import _db
    module = importlib.reload(_db)
    assert module.DB_PATH == str(tmp_path / "jobs.db")

    monkeypatch.setenv("JHT_DB", str(tmp_path / "custom.db"))
    module = importlib.reload(_db)
    assert module.DB_PATH == str(tmp_path / "custom.db")
