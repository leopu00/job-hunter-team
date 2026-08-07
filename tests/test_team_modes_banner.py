"""Test del contratto MODALITÀ nel banner orario (enum chiuso, 2026-08-03).

Il contratto: `profile/capitano-maintenance.json` porta `"mode"` con uno di
CINQUE valori — `search` (default, assenza del file), `harvest`, `care` (ex
`maintenance`), `calibration`, `saving`. Ogni modalità dichiara quattro cose e
il banner orario le trasmette TUTTE: code attive, cosa è sospeso, priorità di
budget, condizione di uscita. La quarta è la novità che chiude il buco storico
(nessuna modalità finiva da sola → 18 giorni di manutenzione persa): dove è
misurabile si valuta in SOLA LETTURA sul DB, dove non lo è si degrada in un
esplicito «non valutabile» — mai in un falso «finito».

Complementare a `test_mode_injection.py` (che copre il canale di consegna:
bridge, resume, silenzio): qui si copre il CONTENUTO della sezione.

Eseguire:
    pytest tests/test_team_modes_banner.py -v
"""

import importlib.util
import json
import sqlite3
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = REPO_ROOT / "shared" / "skills"
AGENTS_DIR = REPO_ROOT / "agents"
TEAM_MODES_SKILL = AGENTS_DIR / "_skills" / "team-modes" / "SKILL.md"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def home(tmp_path, monkeypatch):
    """`JHT_HOME` usa-e-getta; `JHT_DB` tolta perché vincerebbe su JHT_HOME."""
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.delenv("JHT_DB", raising=False)
    (tmp_path / "profile").mkdir(parents=True, exist_ok=True)
    return tmp_path


@pytest.fixture
def mb(home):
    return _load("mode_banner_modes_under_test", SKILLS_DIR / "mode_banner.py")


def set_mode(home, mode, orders=None):
    payload = {"mode": mode}
    if orders is not None:
        payload["orders"] = orders
    path = home / "profile" / "capitano-maintenance.json"
    path.write_text(json.dumps(payload, ensure_ascii=False) + "\n",
                    encoding="utf-8")
    return path


def make_db(home):
    """Un jobs.db MINIMO con le sole tabelle/colonne che le stime RO leggono.

    Volutamente non passa da `_db.ensure_schema`: le query del banner devono
    reggersi sulle colonne stabili dello schema, e un DB ridotto lo prova.
    """
    conn = sqlite3.connect(home / "jobs.db")
    conn.executescript("""
        CREATE TABLE companies (
            id INTEGER PRIMARY KEY, name TEXT, logo_fetched INTEGER DEFAULT 0);
        CREATE TABLE positions (
            id INTEGER PRIMARY KEY, company_id INTEGER,
            status TEXT DEFAULT 'scored', last_checked TIMESTAMP,
            expires_at TIMESTAMP, office_lat REAL,
            office_geocoded INTEGER DEFAULT 0, work_mode TEXT,
            is_open INTEGER);
        CREATE TABLE scores (
            id INTEGER PRIMARY KEY, position_id INTEGER, total_score INTEGER);
        CREATE TABLE applications (
            id INTEGER PRIMARY KEY, position_id INTEGER);
    """)
    conn.commit()
    return conn


def add_position(conn, pid, score=None, status="scored", cv=False,
                 last_checked="2026-08-01 00:00:00", expires_at=None,
                 office_geocoded=1, office_lat=1.0, work_mode="hybrid",
                 company_id=None, is_open=1):
    conn.execute(
        "INSERT INTO positions (id, company_id, status, last_checked, "
        "expires_at, office_lat, office_geocoded, work_mode, is_open) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (pid, company_id, status, last_checked, expires_at, office_lat,
         office_geocoded, work_mode, is_open))
    if score is not None:
        conn.execute("INSERT INTO scores (position_id, total_score) "
                     "VALUES (?, ?)", (pid, score))
    if cv:
        conn.execute("INSERT INTO applications (position_id) VALUES (?)",
                     (pid,))
    conn.commit()


# ── L'enum e la canonicalizzazione ────────────────────────────────────────

def test_assenza_del_file_e_search(mb):
    snap = mb.snapshot()
    assert snap["mode"] == mb.MODE_SEARCH
    text = mb.banner(snap=snap)
    assert "MODE: search" in text and "the default" in text


def test_i_cinque_valori_dell_enum_sono_riconosciuti(mb):
    for mode in mb.MODES:
        set_mode(mb._home(), mode)
        snap = mb.snapshot()
        assert snap["mode"] == mode
        assert f"MODE: {mode} ({mb.MODE_LABELS[mode]})" in mb.banner(snap=snap)


def test_i_valori_legacy_vengono_canonicalizzati_ma_restano_visibili(mb):
    """`maintenance` (vivo su una VPS in produzione) e `normal` non spariscono:
    diventano il nome canonico E il valore grezzo resta nel banner."""
    set_mode(mb._home(), "maintenance", {"stop_search": True})
    snap = mb.snapshot()
    assert snap["mode"] == mb.MODE_CARE and snap["mode_raw"] == "maintenance"
    text = mb.banner(snap=snap)
    assert "MODE: care" in text and '"maintenance", legacy value' in text

    set_mode(mb._home(), "normal")
    snap = mb.snapshot()
    assert snap["mode"] == mb.MODE_SEARCH and snap["mode_raw"] == "normal"


def test_un_valore_fuori_enum_resta_un_ordine_attivo(mb):
    """Una modalità che non conosciamo non si normalizza via: si riferisce,
    e la direzione sicura è sourcing fermo."""
    set_mode(mb._home(), "strano")
    snap = mb.snapshot()
    assert snap["mode"] == "strano"
    text = mb.banner(snap=snap)
    assert "OUTSIDE the enum" in text and "ACTIVE ORDER" in text
    assert mb.sourcing_stopped(snap) is True
    assert mb.has_standing_orders(snap) is True


def test_un_file_illeggibile_resta_sconosciuto_e_non_valutabile(mb):
    (mb._home() / "profile" / "capitano-maintenance.json").write_text(
        "{rotto", encoding="utf-8")
    snap = mb.snapshot()
    assert snap["mode"] == mb.MODE_UNKNOWN
    assert snap["exit"]["kind"] == mb.EXIT_UNAVAILABLE
    assert mb.has_standing_orders(snap) is True
    assert "MODE: unknown" in mb.banner(snap=snap)


# ── La specifica nel banner (le 4 dichiarazioni + rimando al manuale) ─────

def test_ogni_modalita_porta_le_quattro_dichiarazioni(mb):
    """Il requisito del contratto: il battito orario trasmette la SPECIFICA,
    non solo il nome — code attive, sospeso, budget, uscita — più il rimando
    alla skill `team-modes` per il dettaglio."""
    for mode in mb.MODES:
        set_mode(mb._home(), mode)
        text = mb.banner()
        for marker in ("ACTIVE QUEUES:", "SUSPENDED:", "BUDGET:", "EXIT:"):
            assert marker in text, f"{mode}: manca {marker}"
        assert "team-modes" in text, f"{mode}: manca il rimando al manuale"


def test_la_specifica_c_e_anche_a_modalita_search_default(mb):
    """`search` senza file è comunque una modalità con una specifica: il
    Capitano deve sapere cosa implica anche il default."""
    text = mb.banner()
    assert "ACTIVE QUEUES:" in text and "EXIT:" in text


def test_la_riga_singola_resta_una_riga_con_la_specifica(mb):
    for mode in mb.MODES:
        set_mode(mb._home(), mode, {"stop_search": True})
        one = mb.line()
        assert "\n" not in one and "\r" not in one, mode
        assert one.endswith(mb.FOOTER), mode


def test_gli_ordini_di_care_in_produzione_si_compongono_con_la_specifica(mb):
    """Il vocabolario `orders` esistente (vivo su una VPS) NON è stato
    buttato: le righe per-chiave restano, e la specifica si aggiunge."""
    set_mode(mb._home(), "care", {
        "stop_search": True, "discard_expired_rotating": True,
        "cv_min_score": 90, "pre_check_liveness_for_cv": True})
    text = mb.banner()
    assert "stop_search: true — NO Scouts" in text
    assert "cv_min_score: 90" in text
    assert "ACTIVE QUEUES: scheduled recheck" in text


# ── sourcing_stopped per modalità ─────────────────────────────────────────

def test_sourcing_stopped_default_per_modalita(mb):
    expected = {mb.MODE_SEARCH: False, mb.MODE_HARVEST: True,
                mb.MODE_CARE: True, mb.MODE_CALIBRATION: True,
                mb.MODE_SAVING: True}
    for mode, want in expected.items():
        set_mode(mb._home(), mode)
        assert mb.sourcing_stopped() is want, mode
    # `orders` esplicito vince sempre sul default della modalità.
    set_mode(mb._home(), "harvest", {"stop_search": False})
    assert mb.sourcing_stopped() is False
    set_mode(mb._home(), "search", {"stop_search": True})
    assert mb.sourcing_stopped() is True


# ── Condizione di uscita: harvest (valutabile sul DB) ─────────────────────

def test_harvest_pending_poi_done_quando_le_candidate_finiscono(mb):
    conn = make_db(mb._home())
    add_position(conn, 1, score=80)                 # candidata senza CV
    add_position(conn, 2, score=80, cv=True)        # già convertita
    add_position(conn, 3, score=60)                 # sotto soglia (75)
    add_position(conn, 4, score=95, status="excluded")  # esclusa
    conn.close()

    set_mode(mb._home(), "harvest")
    snap = mb.snapshot()
    assert snap["exit"]["kind"] == mb.EXIT_PENDING
    assert "1 live positions" in snap["exit"]["detail"]
    assert "EXIT:" in mb.banner(snap=snap)

    # La candidata riceve il CV → il raccolto è finito, e il banner lo DICE.
    conn = sqlite3.connect(mb._home() / "jobs.db")
    conn.execute("INSERT INTO applications (position_id) VALUES (1)")
    conn.commit()
    conn.close()
    snap = mb.snapshot()
    assert snap["exit"]["kind"] == mb.EXIT_DONE
    text = mb.banner(snap=snap)
    assert "WORK EXHAUSTED" in text
    assert "REPORT IT to the user" in text


def test_harvest_rispetta_la_soglia_negli_orders(mb):
    conn = make_db(mb._home())
    add_position(conn, 1, score=80)
    conn.close()
    # Con soglia 90 la posizione a 80 non è più una candidata → done.
    set_mode(mb._home(), "harvest", {"cv_min_score": 90})
    assert mb.snapshot()["exit"]["kind"] == mb.EXIT_DONE
    set_mode(mb._home(), "harvest", {"cv_min_score": 75})
    assert mb.snapshot()["exit"]["kind"] == mb.EXIT_PENDING


def test_harvest_senza_db_degrada_mai_un_falso_finito(mb):
    set_mode(mb._home(), "harvest")
    snap = mb.snapshot()
    assert snap["exit"]["kind"] == mb.EXIT_UNAVAILABLE
    text = mb.banner(snap=snap)
    assert "UNAVAILABLE" in text
    assert "WORK EXHAUSTED" not in text


def test_harvest_con_schema_rotto_degrada(mb):
    """Un DB che c'è ma senza le tabelle attese (installazione vecchia) non
    deve produrre né un crash né un «finito»."""
    conn = sqlite3.connect(mb._home() / "jobs.db")
    conn.execute("CREATE TABLE altro (id INTEGER)")
    conn.commit()
    conn.close()
    set_mode(mb._home(), "harvest")
    assert mb.snapshot()["exit"]["kind"] == mb.EXIT_UNAVAILABLE


# ── Condizione di uscita: care (valutabile, con policy) ───────────────────

def test_care_pending_con_lavoro_residuo_e_done_a_code_vuote(mb):
    conn = make_db(mb._home())
    # Una posizione viva score 80 mai ri-verificata → in coda recheck; le è
    # stato dato geocode e il logo non ha aziende → le altre code sono vuote.
    add_position(conn, 1, score=80, last_checked=None)
    conn.close()

    set_mode(mb._home(), "care")
    snap = mb.snapshot()
    assert snap["exit"]["kind"] == mb.EXIT_PENDING
    assert "recheck=1" in snap["exit"]["detail"]

    # La posizione viene ri-verificata ADESSO → esce dalla coda per 14gg.
    conn = sqlite3.connect(mb._home() / "jobs.db")
    conn.execute("UPDATE positions SET last_checked = datetime('now')")
    conn.commit()
    conn.close()
    snap = mb.snapshot()
    assert snap["exit"]["kind"] == mb.EXIT_DONE
    assert "CARE COMPLETE" in snap["exit"]["detail"]


def test_care_conta_le_scadute(mb):
    conn = make_db(mb._home())
    add_position(conn, 1, score=80, expires_at="2026-01-01 00:00:00")
    conn.close()
    set_mode(mb._home(), "care")
    snap = mb.snapshot()
    assert snap["exit"]["kind"] == mb.EXIT_PENDING
    assert "expired=1" in snap["exit"]["detail"]


def test_care_con_policy_economy_le_code_spente_sono_stato_voluto(mb):
    """`economy=true` spegne le code di enrichment A CODICE: per l'uscita
    contano come esaurite (OFF), non come lavoro residuo — e il banner lo
    dichiara invece di nasconderlo."""
    conn = make_db(mb._home())
    add_position(conn, 1, score=80, last_checked=None)   # sarebbe in coda
    conn.close()
    (mb._home() / "profile" / "enrichment-policy.json").write_text(
        json.dumps({"economy": True}), encoding="utf-8")
    set_mode(mb._home(), "care")
    snap = mb.snapshot()
    assert snap["exit"]["kind"] == mb.EXIT_DONE
    assert "OFF by policy" in snap["exit"]["detail"]


def test_care_senza_db_degrada(mb):
    set_mode(mb._home(), "care")
    snap = mb.snapshot()
    assert snap["exit"]["kind"] == mb.EXIT_UNAVAILABLE
    assert "DO NOT infer" in snap["exit"]["detail"]


# ── Condizione di uscita: calibration/search/saving ───────────────────────

def test_calibration_dichiara_il_limite_il_feedback_vive_sul_cloud(mb):
    """Il feedback (position_feedback) NON è su disco: la valutazione
    automatica sarebbe una bugia, quindi si degrada per disegno e la chiusura
    la dichiara il Capitano."""
    set_mode(mb._home(), "calibration")
    snap = mb.snapshot()
    assert snap["exit"]["kind"] == mb.EXIT_UNAVAILABLE
    assert "cloud" in snap["exit"]["detail"]
    assert "UNAVAILABLE" in mb.banner(snap=snap)


def test_search_e_saving_sono_continue_mai_finite(mb):
    for mode in (mb.MODE_SEARCH, mb.MODE_SAVING):
        set_mode(mb._home(), mode)
        snap = mb.snapshot()
        assert snap["exit"]["kind"] == mb.EXIT_CONTINUOUS, mode
        assert "WORK EXHAUSTED" not in mb.banner(snap=snap), mode


def test_saving_non_invita_a_spendere_il_surplus(mb):
    """In risparmio C-25 non sblocca il sourcing: il margine si riferisce.
    La specifica del banner deve dirlo, non lasciarlo dedurre."""
    set_mode(mb._home(), "saving")
    text = mb.banner()
    assert "does NOT unlock" in text


# ── Il manuale e il cablaggio (skills.list + identità) ────────────────────

def test_la_skill_team_modes_esiste_con_una_scheda_per_modalita(mb):
    src = TEAM_MODES_SKILL.read_text(encoding="utf-8")
    for mode in mb.MODES:
        assert f"`{mode}`" in src, f"manca la scheda {mode} nel manuale"
    # Le schede promettono le 4 dichiarazioni e la composizione con C-25.
    assert "Exit condition" in src and "C-25" in src


def test_team_modes_e_dichiarata_in_skills_list_del_capitano():
    sl = (AGENTS_DIR / "capitano" / "skills.list").read_text(encoding="utf-8")
    lines = [l.strip() for l in sl.splitlines()
             if l.strip() and not l.strip().startswith("#")]
    assert "team-modes" in lines


def test_il_file_identita_rimanda_al_manuale_in_7_lingue():
    """Il requisito dell'utente: il file identità dice QUANDO andare a leggere
    il manuale — non solo che esiste. Tutte e 7 le lingue."""
    files = [AGENTS_DIR / "capitano" / "capitano.md"]
    files += [AGENTS_DIR / "capitano" / f"capitano.{loc}.md"
              for loc in ("it", "es", "fr", "de", "pt", "hu")]
    for path in files:
        src = path.read_text(encoding="utf-8")
        assert src.count("team-modes") >= 2, (
            f"{path.name}: il rimando alla skill team-modes deve esserci sia "
            f"nell'indice skill sia nella regola delle modalità")
