"""Contratto di ``shared/skills/feedback_record.py``: registrato o dichiarato no.

Questa skill scrive il giudizio dell'utente su `position_feedback`, che vive
solo su Supabase: non c'è un ripiego locale, quindi ogni fallimento della
corsia cloud è un giudizio NON registrato e va detto.

È la differenza con `feedback_query.py`, che degrada in silenzio apposta. Metà
di questo file esiste per impedire che quella tolleranza si propaghi qui per
somiglianza: la lettura può rispondere "non lo so", la scrittura no.
"""

import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "shared" / "skills" / "feedback_record.py"


def load():
    spec = importlib.util.spec_from_file_location("jht_feedback_record", SKILL)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


record = load()


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


def test_l_id_finisce_nel_path_codificato(calls):
    """`legacy_id` è TEXT e arriva da fuori: se finisse grezzo nell'URL,
    uno slash lo trasformerebbe in un altro endpoint."""
    record.record("a/b?c", "like")
    assert calls[0]["path"] == "/api/positions/a%2Fb%3Fc/feedback"


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
def test_una_corsia_cloud_rotta_e_un_giudizio_non_registrato(monkeypatch, motivo):
    monkeypatch.setattr(record, "api_request",
                        lambda *a, **k: (False, motivo))
    out = record.record("1", "like")
    assert out["ok"] is False
    assert out["recorded"] is False, "un fallimento non può somigliare a un successo"
    assert motivo in out["error"], "il motivo vero deve arrivare a chi legge"


def test_il_403_della_route_resta_leggibile(monkeypatch):
    """Se un giorno il 403 tornasse — per un rollback, o perché la decisione
    viene ripensata — il comando deve dirlo con le parole del server, non con
    un «errore generico» che manda a cercare nel posto sbagliato."""
    monkeypatch.setattr(record, "api_request",
                        lambda *a, **k: (False, 'http-403: {"error":"Solo il browser registra feedback"}'))
    out = record.record("1", "like")
    assert "403" in out["error"] and "browser" in out["error"]


def test_exit_code_uno_quando_non_registrato(monkeypatch, capsys):
    monkeypatch.setattr(record, "api_request", lambda *a, **k: (False, "cloud-disabled"))
    monkeypatch.setattr("sys.argv", ["feedback_record.py", "set", "1", "like"])
    assert record.main() == 1
    assert json.loads(capsys.readouterr().out.strip())["ok"] is False


def test_exit_code_zero_quando_registrato(monkeypatch, capsys):
    monkeypatch.setattr(record, "api_request",
                        lambda *a, **k: (True, {"feedback": {"action": "like"}}))
    monkeypatch.setattr("sys.argv", ["feedback_record.py", "set", "1", "like"])
    assert record.main() == 0
    assert json.loads(capsys.readouterr().out.strip())["ok"] is True
