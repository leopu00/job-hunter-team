"""Test del controllo manuale dell'usage (shared/skills/check_usage.py).

Perché conta: è la misura *indipendente dal bridge* su cui poggiano le
decisioni di pacing e di burn — quando il bridge è fermo o il campione è
vecchio, questo è il numero che l'orchestratore usa per decidere se
spawnare o freezare. Un errore qui non fa rumore: produce un `usage=` più
basso del vero, e il team continua a consumare.

Il file è quasi tutto parsing deterministico (nessun LLM nel loop), quindi
è verificabile senza tmux: i test coprono

  • `parse_claude_usage` sui due formati della modal `/usage`, sulla
    scrollback che contiene modali VECCHIE (deve vincere l'ultima) e sulla
    guard "Loading usage data" che impedisce di spacciare un dato cached
    per fresco;
  • l'aritmetica del reset (`hours_until_reset`, `remaining_str`);
  • `compute_verdict`, la soglia che l'orchestratore legge;
  • `detect_provider` e `check_via_bridge_fetcher` con un bridge finto,
    cioè la parte di dispatch che decide quale strategia si applica;
  • `check_claude`, guidato da tmux finto, incluso il retry dopo lo spawn.

Eseguire:
    pytest tests/test_check_usage.py -v
"""

import importlib.util
from datetime import datetime, timedelta, timezone

import pytest

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def _load_check_usage():
    path = REPO_ROOT / "shared" / "skills" / "check_usage.py"
    spec = importlib.util.spec_from_file_location("check_usage", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def cu():
    return _load_check_usage()


# ── parse_claude_usage — formato v2.1+ ──────────────────────────────────

MODAL_V2 = """\
 Current session
 ██████████████████                  36% used
 Resets 4:40am (UTC)

 Current week (all models)
 ████████████▌                       25% used
 Resets Apr 27, 5am (UTC)
"""


def test_parse_v2_estrae_usage_reset_e_weekly(cu):
    out = cu.parse_claude_usage(MODAL_V2)
    assert out == {"usage": 36, "reset_hhmm_utc": "04:40", "weekly": 25}


def test_parse_v2_senza_minuti_normalizza_a_zero(cu):
    text = "Current session\n 12% used\n Resets 7pm (UTC)\n"
    out = cu.parse_claude_usage(text)
    assert out["usage"] == 12
    assert out["reset_hhmm_utc"] == "19:00"


@pytest.mark.parametrize(
    "resets, atteso",
    [
        ("Resets 12am (UTC)", "00:00"),   # mezzanotte
        ("Resets 12:30pm (UTC)", "12:30"),  # mezzogiorno resta 12
        ("Resets 1am (UTC)", "01:00"),
        ("Resets 11:59pm (UTC)", "23:59"),
    ],
)
def test_parse_converte_am_pm_in_24h(cu, resets, atteso):
    text = f"Current session\n 5% used\n {resets}\n"
    assert cu.parse_claude_usage(text)["reset_hhmm_utc"] == atteso


def test_parse_v2_prende_l_ultima_modal_della_scrollback(cu):
    """La scrollback contiene la modal del boot e quella appena aperta:
    vince la seconda, altrimenti si legge un dato stale."""
    vecchia = "Current session\n 90% used\n Resets 1:00am (UTC)\n"
    nuova = "Current session\n 36% used\n Resets 4:40am (UTC)\n"
    out = cu.parse_claude_usage(vecchia + "\n...\n" + nuova)
    assert out["usage"] == 36
    assert out["reset_hhmm_utc"] == "04:40"


def test_parse_weekly_solo_dal_blocco_corrente(cu):
    """Il weekly appartiene al blocco della sessione corrente: quello di una
    modal precedente non deve filtrare nel risultato."""
    vecchia = (
        "Current session\n 90% used\n Resets 1:00am (UTC)\n"
        "Current week (all models)\n 99% used\n"
    )
    nuova = (
        "Current session\n 36% used\n Resets 4:40am (UTC)\n"
        "Current week (all models)\n 25% used\n"
    )
    assert cu.parse_claude_usage(vecchia + nuova)["weekly"] == 25


def test_parse_weekly_assente_resta_none(cu):
    text = "Current session\n 36% used\n Resets 4:40am (UTC)\n"
    assert cu.parse_claude_usage(text)["weekly"] is None


# ── parse_claude_usage — guard "Loading usage data" ─────────────────────

def test_parse_rifiuta_modal_ancora_in_caricamento(cu):
    """Se l'ultimo stato del pane è 'Loading usage data', il dato buono a
    schermo è quello di una modal precedente: meglio nessun numero che uno
    vecchio spacciato per fresco."""
    text = MODAL_V2 + "\nCurrent session\n Loading usage data…\n"
    assert cu.parse_claude_usage(text) is None


def test_parse_accetta_loading_precedente_alla_modal_buona(cu):
    text = "Loading usage data…\n" + MODAL_V2
    assert cu.parse_claude_usage(text)["usage"] == 36


def test_parse_su_pane_vuoto_o_senza_modal(cu):
    assert cu.parse_claude_usage("") is None
    assert cu.parse_claude_usage(None) is None
    assert cu.parse_claude_usage("$ ls\nREADME.md\n") is None


# ── parse_claude_usage — formato vecchio (pre-v2.1) ─────────────────────

def test_parse_formato_vecchio_salta_le_righe_taggate(cu):
    """Nel formato vecchio la riga della sessione è quella SENZA tag: le
    righe '(all models)' e 'only' sono altri contatori."""
    text = (
        "Resets 7pm (UTC) (all models)       12% used\n"
        "Resets 3pm (UTC) (Opus only)        80% used\n"
        "Resets 6:10pm (UTC)                 42% used\n"
    )
    out = cu.parse_claude_usage(text)
    assert out["usage"] == 42
    assert out["reset_hhmm_utc"] == "18:10"


def test_parse_formato_vecchio_non_sconfina_nella_riga_successiva(cu):
    """Senza '% used' nella finestra della sessione il parse fallisce invece
    di prendere il numero del contatore successivo."""
    text = (
        "Resets 6:10pm (UTC)\n"
        "Resets 7pm (UTC) (all models)       12% used\n"
    )
    assert cu.parse_claude_usage(text) is None


def test_parse_formato_vecchio_con_solo_righe_taggate(cu):
    text = "Resets 7pm (UTC) (all models)       12% used\n"
    assert cu.parse_claude_usage(text) is None


# ── Aritmetica del reset ────────────────────────────────────────────────

def _hhmm(delta_hours):
    t = datetime.now(timezone.utc) + timedelta(hours=delta_hours)
    return t.strftime("%H:%M")


def test_hours_until_reset_orario_futuro(cu):
    assert cu.hours_until_reset(_hhmm(2)) == pytest.approx(2, abs=0.05)


def test_hours_until_reset_scavalca_la_mezzanotte(cu):
    """Un orario già passato oggi è il reset di domani, non un negativo."""
    h = cu.hours_until_reset(_hhmm(-1))
    assert h == pytest.approx(23, abs=0.05)
    assert h > 0


def test_hours_until_reset_input_non_valido(cu):
    assert cu.hours_until_reset(None) is None
    assert cu.hours_until_reset("") is None
    assert cu.hours_until_reset("mai") is None
    assert cu.hours_until_reset("2026-07-30T05:00:00Z") is None


@pytest.mark.parametrize("fuori_range", ["24:00", "25:00", "12:60", "99:99", "-1:30"])
def test_hours_until_reset_fuori_range_degrada_invece_di_sollevare(cu, fuori_range):
    """Sintatticamente hh:mm ma impossibile come orario: lo rifiuta
    `replace()`, non lo split. Il parser Claude non ci arriva mai (limita a
    23), ma i rami kimi/openai passano il `reset_at` del bridge senza
    validarlo — e main() cattura solo KeyboardInterrupt, quindi una
    ValueError qui abbatterebbe il comando perdendo anche l'usage."""
    assert cu.hours_until_reset(fuori_range) is None
    assert cu.remaining_str(fuori_range) == "?"


@pytest.mark.parametrize("non_stringa", [1943, 19.43, ["19", "43"], {"h": 19}])
def test_hours_until_reset_su_valore_non_stringa_degrada(cu, non_stringa):
    """`sample.get("reset_at")` non è garantito stringa: nessun tipo deve
    propagare un'eccezione al chiamante."""
    assert cu.hours_until_reset(non_stringa) is None
    assert cu.remaining_str(non_stringa) == "?"


def test_remaining_str_formatta_ore_e_minuti(cu):
    assert cu.remaining_str(_hhmm(2.5)).endswith("m")
    assert cu.remaining_str(_hhmm(2.5)).startswith("2h ")
    # Sotto l'ora resta solo la parte in minuti.
    solo_minuti = cu.remaining_str(_hhmm(0.5))
    assert "h" not in solo_minuti and solo_minuti.endswith("m")


def test_remaining_str_senza_reset(cu):
    assert cu.remaining_str(None) == "?"
    assert cu.remaining_str("mai") == "?"


# ── Verdict ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize("usage", [0, 10, 74, 74.9])
def test_verdict_sotto_75_e_ok(cu, usage):
    assert cu.compute_verdict(usage).startswith("🟢")


@pytest.mark.parametrize("usage", [75, 80, 87])
def test_verdict_fra_75_e_87_e_attenzione(cu, usage):
    v = cu.compute_verdict(usage)
    assert v.startswith("🟠")
    assert "niente spawn extra" in v


@pytest.mark.parametrize("usage", [88, 95, 100, 140])
def test_verdict_da_88_in_su_e_critico(cu, usage):
    v = cu.compute_verdict(usage)
    assert v.startswith("🔴")
    assert "freeza" in v


@pytest.mark.parametrize("usage", [None, "42", [], {}])
def test_verdict_su_valore_non_numerico_e_sconosciuto(cu, usage):
    assert cu.compute_verdict(usage).startswith("⚪")


def test_verdict_e_monotono(cu):
    """Salendo l'usage la severità non deve mai diminuire."""
    ordine = {"🟢": 0, "🟡": 1, "🟠": 2, "🔴": 3}
    livelli = [ordine[cu.compute_verdict(u)[0]] for u in range(0, 101)]
    assert livelli == sorted(livelli)


def test_verdict_ha_esattamente_tre_livelli_raggiungibili(cu):
    """Non esiste una banda 🟡. C'era il ramo — `usage >= SAFE_CEILING (95)`
    messo DOPO `>= 88` — ma era irraggiungibile per costruzione, quindi il
    verdict non l'ha mai emesso da quando il file esiste.

    Che vada rimosso e non riordinato lo decide questo stesso file: le
    soglie sono già pinnate senza buchi (<75 🟢, 75-87 🟠, ≥88 🔴), e
    l'invariante di monotonia sopra ordina 🟡 *sotto* 🟠 — quindi qualunque
    banda 🟡 la si voglia infilare, sopra o sotto 88, romperebbe l'uno o
    l'altra. La costante è sparita con il ramo: nessuno la leggeva."""
    assert {cu.compute_verdict(u)[0] for u in range(0, 201)} == {"🟢", "🟠", "🔴"}
    assert not hasattr(cu, "SAFE_CEILING")


# ── detect_provider ─────────────────────────────────────────────────────

class _FakeBridge:
    def __init__(self, raw, boom=False):
        self._raw = raw
        self._boom = boom

    def read_config(self):
        if self._boom:
            raise RuntimeError("config illeggibile")
        return 60, self._raw


@pytest.mark.parametrize(
    "raw, atteso",
    [
        ("claude", "claude"),
        ("anthropic", "claude"),
        ("  Claude  ", "claude"),
        ("kimi", "kimi"),
        ("MOONSHOT", "kimi"),
        ("openai", "openai"),
        ("Codex", "openai"),
        ("gemini", "gemini"),   # sconosciuto: passa attraverso, normalizzato
        ("", None),
        (None, None),
    ],
)
def test_detect_provider_normalizza(cu, monkeypatch, raw, atteso):
    monkeypatch.setattr(cu, "_import_bridge", lambda: _FakeBridge(raw))
    assert cu.detect_provider() == atteso


def test_detect_provider_senza_bridge(cu, monkeypatch):
    monkeypatch.setattr(cu, "_import_bridge", lambda: None)
    assert cu.detect_provider() is None


def test_detect_provider_con_config_illeggibile(cu, monkeypatch):
    monkeypatch.setattr(cu, "_import_bridge", lambda: _FakeBridge("claude", boom=True))
    assert cu.detect_provider() is None


# ── check_via_bridge_fetcher (kimi / openai) ────────────────────────────

class _Bridge:
    """Bridge finto: espone solo i fetcher che gli si passano."""

    def __init__(self, **fetchers):
        for name, fn in fetchers.items():
            setattr(self, name, fn)


def test_fetcher_mappa_i_campi_del_campione(cu):
    sample = {"usage": 41, "reset_at": "19:43", "weekly_usage": 63, "extra": "ignorato"}
    res, err = cu.check_via_bridge_fetcher(
        _Bridge(fetch_kimi_api=lambda: sample), "fetch_kimi_api", "http:/usages",
    )
    assert err is None
    assert res == {
        "usage": 41,
        "reset_hhmm_utc": "19:43",
        "weekly": 63,
        "source": "http:/usages",
    }


def test_fetcher_assente_nel_bridge(cu):
    res, err = cu.check_via_bridge_fetcher(_Bridge(), "fetch_kimi_api", "x")
    assert res is None
    assert err == "missing_fetcher:fetch_kimi_api"


def test_fetcher_che_solleva_non_propaga(cu):
    def boom():
        raise RuntimeError("timeout API")

    res, err = cu.check_via_bridge_fetcher(_Bridge(fetch_kimi_api=boom), "fetch_kimi_api", "x")
    assert res is None
    assert err.startswith("fetch_error:")
    assert "timeout API" in err


@pytest.mark.parametrize("vuoto", [None, {}, []])
def test_fetcher_senza_dato_e_fetch_empty(cu, vuoto):
    res, err = cu.check_via_bridge_fetcher(
        _Bridge(fetch_kimi_api=lambda: vuoto), "fetch_kimi_api", "x",
    )
    assert res is None
    assert err == "fetch_empty"


# ── check_claude (strategia TUI) ────────────────────────────────────────

@pytest.fixture
def tmux_finto(cu, monkeypatch):
    """Sostituisce i tre seam verso tmux e azzera le attese."""
    state = {"pane": "", "sessione": True, "spawn_ok": True, "spawnata": False,
             "keys": []}

    monkeypatch.setattr(cu.time, "sleep", lambda _s: None)
    monkeypatch.setattr(cu, "tmux_has_session", lambda name: state["sessione"])
    monkeypatch.setattr(cu, "capture_pane", lambda name, lines=None: state["pane"])
    monkeypatch.setattr(cu, "send_keys", lambda name, *keys: state["keys"].append(keys))

    def _spawn():
        state["spawnata"] = True
        state["sessione"] = state["spawn_ok"]
        return state["spawn_ok"]

    monkeypatch.setattr(cu, "spawn_worker", _spawn)
    return state


def test_check_claude_su_sessione_viva(cu, tmux_finto):
    tmux_finto["pane"] = MODAL_V2
    res, err = cu.check_claude()
    assert err is None
    assert res["usage"] == 36
    assert res["reset_hhmm_utc"] == "04:40"
    assert res["source"] == "tui:/usage"
    assert tmux_finto["spawnata"] is False


def test_check_claude_manda_esc_prima_del_comando(cu, tmux_finto):
    """Senza Esc iniziale '/usage' finisce dentro la modal già aperta e il
    dato non si aggiorna mai."""
    tmux_finto["pane"] = MODAL_V2
    cu.check_claude()
    assert tmux_finto["keys"][0] == ("Escape",)
    assert ("/usage", "Enter") in tmux_finto["keys"]
    assert tmux_finto["keys"][-1] == ("Escape",)


def test_check_claude_spawna_il_worker_se_manca(cu, tmux_finto):
    tmux_finto["sessione"] = False
    tmux_finto["pane"] = MODAL_V2
    res, err = cu.check_claude()
    assert tmux_finto["spawnata"] is True
    assert err is None
    assert res["usage"] == 36


def test_check_claude_spawn_fallito(cu, tmux_finto):
    tmux_finto["sessione"] = False
    tmux_finto["spawn_ok"] = False
    res, err = cu.check_claude()
    assert res is None
    assert err == "spawn_failed"


def test_check_claude_riprova_una_volta_dopo_lo_spawn(cu, tmux_finto, monkeypatch):
    """Al primo giro dopo lo spawn il CLI può non aver ancora renderizzato:
    è previsto un secondo tentativo prima di dichiarare il fallimento."""
    tmux_finto["sessione"] = False
    tentativi = {"n": 0}

    def _capture(name, lines=None):
        tentativi["n"] += 1
        return "" if tentativi["n"] == 1 else MODAL_V2

    monkeypatch.setattr(cu, "capture_pane", _capture)
    res, err = cu.check_claude()
    assert tentativi["n"] == 2
    assert err is None
    assert res["usage"] == 36


def test_check_claude_parse_fallito_senza_spawn_non_riprova(cu, tmux_finto):
    tmux_finto["pane"] = "$ prompt vuoto\n"
    res, err = cu.check_claude()
    assert res is None
    assert err == "parse_failed"


def test_check_claude_non_propaga_il_weekly_della_modal(cu, tmux_finto):
    """Contratto verso il chiamante: la strategia TUI dichiara weekly=None
    (il weekly affidabile arriva dal bridge), quindi main() non stampa un
    `weekly=` derivato da qui."""
    tmux_finto["pane"] = MODAL_V2
    res, _err = cu.check_claude()
    assert res["weekly"] is None
