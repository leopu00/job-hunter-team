"""Contratto di ``shared/skills/feedback_record.py``: registrato o dichiarato no.

Il patto è rimasto: non si dice "fatto" senza aver scritto. È cambiato DOVE si
scrive. Fino a O-15 `position_feedback` viveva solo su Supabase, quindi un
cloud rotto voleva dire davvero "registrato da nessuna parte" e il comando
doveva fallire. Ora il giudizio nasce in SQLite e il cloud è un riflesso: il
comando fallisce se fallisce la scrittura LOCALE, e un cloud irraggiungibile è
`cloud_synced: false` — un fatto sulla propagazione, non sulla registrazione.

Quello che questo file continua a impedire è che la tolleranza della lettura
(`feedback_query.py` degrada in silenzio apposta) si propaghi alla scrittura
per somiglianza: se il locale non prende, il comando lo dice.
"""

import importlib
import importlib.util
import json
import sqlite3
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "shared" / "skills" / "feedback_record.py"
sys.path.insert(0, str(ROOT / "shared" / "skills"))


def load():
    spec = importlib.util.spec_from_file_location("jht_feedback_record", SKILL)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


record = load()


@pytest.fixture(autouse=True)
def local_box(tmp_path, monkeypatch):
    """Un jobs.db vero con la posizione 12345 e la 1.

    Serve a TUTTI i test di questo file: da O-15 la scrittura passa prima di
    qui, quindi senza un locale vero si proverebbe solo il ramo d'errore.
    """
    monkeypatch.setenv("JHT_DB_PATH", str(tmp_path / "jobs.db"))
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    import _db
    importlib.reload(_db)
    conn = _db.get_db()
    conn.row_factory = sqlite3.Row
    _db.ensure_schema(conn)
    for pid in (1, 12345):
        conn.execute(
            "INSERT INTO positions (id, company, title, url) VALUES (?, 'L', 'T', ?)",
            (pid, f"https://example.invalid/{pid}"),
        )
    conn.commit()
    conn.close()
    return tmp_path


@pytest.fixture()
def calls(monkeypatch):
    """Sostituisce la corsia cloud: nessuna rete, e si può leggere cosa è
    stato spedito. La risposta di default è quella della route vera."""
    seen = []

    def fake(method, path, body=None, timeout=10.0):
        seen.append({"method": method, "path": path, "body": body})
        return True, {"feedback": {
            "action": (body or {}).get("action"),
            "score": (body or {}).get("score"),
            "direction": (body or {}).get("direction"),
            "created_at": "2026-08-10T12:00:00Z",
        }}

    monkeypatch.setattr(record, "api_request", fake)
    return seen


# ── il caso autorizzato ────────────────────────────────────────────────────

def test_registra_un_like(calls):
    out = record.record("12345", "like")
    assert out["ok"] and out["action"] == "like"
    assert out["recorded_at"] == "2026-08-10T12:00:00Z"
    assert calls[0]["method"] == "POST"
    assert calls[0]["path"] == "/api/positions/12345/feedback"


def test_manda_solo_i_campi_valorizzati(calls):
    """Un `null` esplicito sovrascriverebbe con NULL una colonna che l'utente
    non ha toccato: la storia di quella posizione perderebbe un dato che
    nessuno ha chiesto di cancellare."""
    record.record("12345", "star", score=5)
    assert calls[0]["body"] == {"action": "star", "score": 5}


def test_un_id_non_numerico_non_arriva_nemmeno_alla_rete(calls):
    """`legacy_id` arriva da fuori e in locale è un INTEGER.

    Da O-15 la scrittura parte dal locale, quindi un id che non può essere una
    posizione locale viene fermato PRIMA della rete: più stretto di prima,
    quando finiva nell'URL e la difesa era solo la codifica.
    """
    out = record.record("a/b?c", "like")
    assert out["ok"] is False
    assert calls == [], "una richiesta partita è una richiesta da difendere"


def test_l_id_finisce_comunque_codificato_nel_path(calls):
    """La codifica resta: sul cloud `legacy_id` è TEXT, e uno slash grezzo
    trasformerebbe la POST in un altro endpoint. Il caso locale la ferma
    prima, ma la difesa non si toglie perché oggi non serve."""
    source = SKILL.read_text(encoding="utf-8")
    assert "urllib.parse.quote(str(legacy_id), safe=\"\")" in source
    record.record("12345", "like")
    assert calls[0]["path"] == "/api/positions/12345/feedback"


@pytest.mark.parametrize("action", ["like", "dislike", "hide", "star", "clear"])
def test_accetta_le_cinque_azioni_della_route(calls, action):
    assert record.record("1", action)["ok"]


def test_clear_e_un_evento_come_gli_altri(calls):
    """`clear` non cancella righe: registra il ritiro del voto, e l'ultimo
    evento prevale (mig 059). Se diventasse una DELETE, la storia di quella
    posizione perderebbe il fatto che un giudizio c'era stato."""
    record.record("1", "clear")
    assert calls[0]["method"] == "POST" and calls[0]["body"] == {"action": "clear"}


# ── la validazione, prima della rete ───────────────────────────────────────

@pytest.mark.parametrize("kwargs,atteso", [
    ({"score": 0}, "score"),
    ({"score": 6}, "score"),
    ({"direction": "sideways"}, "direction"),
    ({"reason": "x" * 501}, "reason"),
    ({"comment": "x" * 2001}, "comment"),
])
def test_rifiuta_in_locale_cio_che_la_route_rifiuterebbe(calls, kwargs, atteso):
    """Il server validerebbe comunque, ma risponderebbe `http-400: {...}`: un
    agente dovrebbe interpretare un errore HTTP per scoprire che 7 non è un
    punteggio da 1 a 5. E una chiamata di rete per saperlo è una di troppo."""
    out = record.record("1", "star", **kwargs)
    assert not out["ok"] and atteso in out["error"]
    assert calls == [], "rifiutato in locale ma la rete è stata chiamata lo stesso"


def test_rifiuta_un_azione_sconosciuta(calls):
    out = record.record("1", "boh")
    assert not out["ok"] and calls == []


# ── il fallimento non è mai silenzioso ─────────────────────────────────────

@pytest.mark.parametrize("motivo", [
    "cloud-disabled",
    "missing-credentials",
    "http-403: {\"error\":\"Solo il browser registra feedback\"}",
    "http-500: {}",
    "network: [Errno 8] nodename nor servname provided",
])
def test_una_corsia_cloud_rotta_non_perde_il_giudizio(monkeypatch, motivo):
    """O-15 ha ribaltato questo caso, di proposito.

    Prima il comando falliva, perché senza cloud il giudizio non esisteva da
    nessuna parte. Ora esiste in locale prima che il cloud venga interpellato:
    far fallire il comando nasconderebbe all'utente un giudizio già registrato.
    Il motivo vero resta leggibile, spostato in `cloud_error`.
    """
    monkeypatch.setattr(record, "api_request",
                        lambda *a, **k: (False, motivo))
    out = record.record("1", "like")
    assert out["ok"] is True
    assert out["source"] == "local"
    assert out["cloud_synced"] is False
    assert motivo in str(out["cloud_error"]), "il motivo vero deve arrivare a chi legge"


def test_se_il_locale_non_prende_il_comando_fallisce(monkeypatch):
    """L'unico fallimento rimasto — ed è il patto che non è cambiato."""
    monkeypatch.setattr(record, "api_request", lambda *a, **k: (True, {}))
    out = record.record("999999", "like")
    assert out["ok"] is False
    assert out["recorded"] is False, "un fallimento non può somigliare a un successo"
    assert "not found" in out["error"]


def test_il_403_della_route_resta_leggibile(monkeypatch):
    """Se un giorno il 403 tornasse — per un rollback, o perché la decisione
    viene ripensata — il comando deve dirlo con le parole del server, non con
    un «errore generico» che manda a cercare nel posto sbagliato."""
    monkeypatch.setattr(record, "api_request",
                        lambda *a, **k: (False, 'http-403: {"error":"Solo il browser registra feedback"}'))
    out = record.record("1", "like")
    # Il giudizio è comunque registrato in locale; il 403 è sulla propagazione.
    assert out["ok"] is True and out["cloud_synced"] is False
    assert "403" in out["cloud_error"] and "browser" in out["cloud_error"]


def test_exit_code_uno_quando_non_registrato(monkeypatch, capsys):
    # Non registrato = il LOCALE non ha preso. Un cloud spento non basta più.
    monkeypatch.setattr(record, "api_request", lambda *a, **k: (False, "cloud-disabled"))
    monkeypatch.setattr("sys.argv", ["feedback_record.py", "set", "999999", "like"])
    assert record.main() == 1
    assert json.loads(capsys.readouterr().out.strip())["ok"] is False


def test_exit_code_zero_quando_registrato(monkeypatch, capsys):
    monkeypatch.setattr(record, "api_request",
                        lambda *a, **k: (True, {"feedback": {"action": "like"}}))
    monkeypatch.setattr("sys.argv", ["feedback_record.py", "set", "1", "like"])
    assert record.main() == 0
    assert json.loads(capsys.readouterr().out.strip())["ok"] is True
