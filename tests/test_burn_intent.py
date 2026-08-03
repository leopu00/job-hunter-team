"""Test della deroga a termine agli automatismi di spesa (`burn_intent`).

Origine: notte del 2026-07-27. L'utente aveva ordinato *"il budget non è un
vincolo, spremete"* e sono servite **cinque deroghe successive smontate a
mano**, una delle quali **annullata da un agente** che seguiva correttamente il
proprio prompt. Il problema non era quanto si riuscisse a bruciare: era che il
sistema non aveva un modo di sapere che l'utente aveva deciso diversamente.

Cosa questa suite tiene fermo:

  1. i produttori di halt leggono l'intento **prima** di scrivere (asserzioni
     sul SORGENTE dei tre bridge: fra scrittura e rimozione dell'halt il team
     è già andato in ESC, quindi "rimuovere dopo" non è un fix);
  2. la deroga **scade da sola** e non può essere permanente;
  3. i **quattro freni di sicurezza** non cedono nemmeno in deroga;
  4. la deroga **arriva agli agenti**, in tutte e 7 le lingue;
  5. ogni transizione lascia una traccia scritta.

Eseguire:
    pytest tests/test_burn_intent.py -v
"""

import ast
import importlib.util
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = REPO_ROOT / "shared" / "skills"
LAUNCHER_DIR = REPO_ROOT / ".launcher"

sys.path.insert(0, str(SKILLS_DIR))
import burn_intent as bi_module  # noqa: E402


def _load(name: str, path: Path):
    """Import per path (i nomi con `-` non sono importabili normalmente)."""
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


T0 = datetime(2026, 7, 27, 22, 0, tzinfo=timezone.utc)


@pytest.fixture
def bi(tmp_path):
    """`burn_intent` puntato a una home usa-e-getta.

    I path sono costanti di modulo risolte all'import: si riassegnano qui,
    invece di ri-importare il modulo, così ogni test parte da un flag assente.
    """
    bi_module.INTENT_FLAG = tmp_path / ".burn-intent.flag"
    bi_module.AUDIT_LOG = tmp_path / "logs" / "burn-intent.jsonl"
    return bi_module


@pytest.fixture
def throttle(bi, tmp_path):
    """`throttle-config` isolato e agganciato allo STESSO flag di intento."""
    tc = _load("throttle_config_under_test", SKILLS_DIR / "throttle-config.py")
    tc.CONFIG_DIR = tmp_path / "config"
    tc.CONFIG_FILE = tc.CONFIG_DIR / "throttle.json"
    tc._FLOOR_EXEMPT_FILE = tc.CONFIG_DIR / "throttle-floor-exempt.txt"
    tc._BURN_INTENT_MOD = bi
    return tc


# ── 3. Scade da sola ─────────────────────────────────────────────────────

def test_grant_is_active_then_expires_on_its_own(bi):
    bi.grant(hours=5, reason="notte di burst", now=T0)
    assert bi.is_active(now=T0 + timedelta(hours=4)) is True
    # Nessuno la cancella: scade e basta. È il requisito #3 — ogni file creato
    # a mano quella notte restava acceso finché qualcuno se ne ricordava.
    assert bi.is_active(now=T0 + timedelta(hours=5, minutes=1)) is False


def test_duration_cannot_be_made_permanent(bi):
    payload = bi.grant(hours=10_000, now=T0)
    assert payload["hours"] == bi.MAX_HOURS
    assert bi.is_active(now=T0 + timedelta(hours=bi.MAX_HOURS + 0.1)) is False


def test_default_duration_is_one_window(bi):
    payload = bi.grant(now=T0)
    assert payload["hours"] == bi.DEFAULT_HOURS == 5.0


def test_sweep_removes_only_an_expired_flag(bi):
    bi.grant(hours=1, now=T0)
    assert bi.sweep(now=T0 + timedelta(minutes=30)) is None
    assert bi.INTENT_FLAG.exists()
    assert bi.sweep(now=T0 + timedelta(hours=2)) is not None
    assert not bi.INTENT_FLAG.exists()


def test_revoke_is_immediate(bi):
    bi.grant(hours=12, now=T0)
    assert bi.revoke(reason="basta così") is not None
    assert bi.is_active(now=T0) is False
    assert bi.revoke() is None          # idempotente


# ── Fail-closed: nel dubbio il freno resta ───────────────────────────────

def test_absent_flag_means_brakes_on(bi):
    assert bi.is_active(now=T0) is False
    assert bi.banner(now=T0) == ""


def test_corrupt_flag_means_brakes_on(bi):
    bi.INTENT_FLAG.write_text("questo non è JSON", encoding="utf-8")
    assert bi.is_active(now=T0) is False


def test_flag_without_expiry_means_brakes_on(bi):
    """Un flag senza scadenza è esattamente il file dimenticato-acceso che
    questo modulo esiste per non riprodurre: non vale come deroga."""
    bi.INTENT_FLAG.write_text(json.dumps({"granted_at": T0.isoformat()}),
                              encoding="utf-8")
    assert bi.is_active(now=T0) is False


# ── 5. Esplicito nei log ─────────────────────────────────────────────────

def test_every_transition_is_written_down(bi):
    bi.grant(hours=2, reason="spremere", now=T0)
    bi.revoke(reason="fatto")
    rows = [json.loads(l) for l in
            bi.AUDIT_LOG.read_text(encoding="utf-8").splitlines() if l.strip()]
    assert [r["event"] for r in rows] == ["granted", "revoked"]
    assert rows[0]["reason"] == "spremere"


def test_banner_names_the_brakes_that_stay_on(bi):
    bi.grant(hours=3, reason="burst", now=T0)
    text = bi.banner(now=T0)
    assert "BURN-INTENT ATTIVO" in text
    for brake in bi.NEVER_YIELDS:
        assert brake in text


# ── 1. I produttori di halt leggono PRIMA di scrivere ────────────────────
#
# Asserzioni sul SORGENTE: il comportamento vero richiederebbe un provider, tre
# daemon e un tmux. Ciò che va garantito qui è strutturale — che il controllo
# stia *prima* del ramo che scrive l'halt, non dopo.

def _src(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_sentinel_bridge_consults_intent_before_writing_daily_halt():
    src = _src(LAUNCHER_DIR / "sentinel-bridge.py")
    assert "if _daily_hardstop_disabled() or _bi_on:" in src, (
        "il ramo che NON scrive l'halt deve considerare l'intento utente")
    consult = src.index("_bi = _burn_intent_status()")
    write = src.index("_activate_daily_halt(_hc, _hcap, _hb)")
    assert consult < write, (
        "l'intento va letto PRIMA della scrittura del flag: fra scrittura e "
        "rimozione il team è già stato messo in ESC")


def test_sentinel_bridge_lets_the_working_hours_gate_yield():
    src = _src(LAUNCHER_DIR / "sentinel-bridge.py")
    assert "if _bi_on and not within_hours:" in src


def test_pacing_bridge_consults_intent_before_going_silent():
    src = _src(LAUNCHER_DIR / "pacing-bridge.py")
    assert "if _daily_halt_active() and not burn_intent_on:" in src
    assert "not wh.is_within_working_hours(now) and not burn_intent_on" in src


def test_heartbeat_bridge_consults_intent_before_suppressing_the_beat():
    src = _src(LAUNCHER_DIR / "heartbeat-bridge.py")
    assert "if DAILY_HALT_FLAG.exists() and not burn_intent_on:" in src
    assert 'if _work_phase() == "OFF" and not burn_intent_on:' in src


def test_all_three_producers_fail_closed():
    """Modulo mancante o flag illeggibile → freno attivo, in tutti e tre."""
    for name in ("sentinel-bridge.py", "pacing-bridge.py", "heartbeat-bridge.py"):
        src = _src(LAUNCHER_DIR / name)
        assert "burn_intent" in src, f"{name} non consulta l'intento utente"
        assert "return False" in src or '"active": False' in src


# ── 2. WORKER_FLOOR e ladder cedono (erano il livello che riscriveva) ────

def test_worker_floor_holds_when_there_is_no_intent(throttle):
    throttle.set_agent("scout-1", 0)
    assert throttle.get_agent("scout-1") == throttle.WORKER_FLOOR


def test_worker_floor_yields_while_the_intent_is_live(throttle, bi):
    bi.grant(hours=5, reason="spremete", now=datetime.now(timezone.utc))
    throttle.set_agent("scout-1", 0)
    assert throttle.get_agent("scout-1") == 0, (
        "in deroga un worker può stare a 0: il floor si applica IN LETTURA, "
        "quindi senza deroga in lettura ogni override tornava a 300s")
    throttle.set_agent("analista-2", 45)
    assert throttle.get_agent("analista-2") == 45, "in deroga niente ladder"


def test_the_floor_comes_back_by_itself_when_the_intent_expires(throttle, bi):
    """Il punto dolente: la deroga non va tolta a mano, torna da sola."""
    past = datetime.now(timezone.utc) - timedelta(hours=6)
    bi.grant(hours=5, now=past)
    assert throttle.get_agent("scout-1") == throttle.WORKER_FLOOR


def test_interactive_core_is_untouched_either_way(throttle, bi):
    throttle.set_agent("capitano", 0)
    assert throttle.get_agent("capitano") == 0
    bi.grant(hours=1, now=datetime.now(timezone.utc))
    assert throttle.get_agent("capitano") == 0


# ── 4. I quattro freni di sicurezza NON cedono ───────────────────────────

def test_never_yields_is_exactly_the_documented_list(bi):
    assert set(bi.NEVER_YIELDS) == {
        "weekly-halt", "host_agent_cap", "SC-09", "freeze_team"}


def test_weekly_halt_never_consults_the_intent():
    """Oltre il weekly il provider non risponde: non è una scelta economica."""
    for rel in ("cli/src/lib/team-state-reconciler.js",
                "cli/src/lib/user-messages-poller.js",
                "cli/src/commands/cloud.js"):
        src = _src(REPO_ROOT / rel)
        assert "WEEKLY_HALT_FLAG" in src, f"{rel}: atteso il gate weekly"
        assert "burn" not in src.lower().replace("burnout", ""), (
            f"{rel}: il weekly-halt non deve poter cedere all'intento utente")


def test_host_agent_cap_never_consults_the_intent():
    """Tetto derivato dalla RAM: superarlo manda la macchina in thrash e
    RIDUCE la produzione (19 sessioni → load 24 su 6 core → SSH giù)."""
    src = _src(SKILLS_DIR / "plan_registry.py")
    assert "host_agent_cap" in src
    assert "burn_intent" not in src


def test_freeze_team_never_consults_the_intent():
    """Ultima rete prima del lockout del provider."""
    assert "burn_intent" not in _src(SKILLS_DIR / "freeze_team.py")


def test_soft_pause_is_classified_and_does_not_yield():
    """La pausa gentile della Sentinella scatta quando L1+L2+L3 di lettura
    dell'usage sono falliti TUTTI: senza numeri non c'è una decisione
    economica da derogare, solo cecità. Non è in `NEVER_YIELDS` (quei nomi
    sono copiati nell'avviso del gioco e nei prompt in 7 lingue), quindi la
    classificazione deve stare SCRITTA nel modulo — altrimenti torna a essere
    l'unico automatismo che ferma il team senza una famiglia."""
    src = _src(SKILLS_DIR / "soft_pause_team.py")
    for call in ("import burn_intent", "burn_intent.is_active",
                 "burn_intent.status", ".burn-intent.flag\")"):
        assert call not in src, f"soft_pause_team cede alla deroga: {call}"
    doc = ast.get_docstring(ast.parse(src)) or ""
    assert "burn_intent" in doc, (
        "la scelta va scritta nel docstring, non lasciata dedurre")


def test_sc09_never_learns_about_the_derogation():
    """SC-09 (una posizione per iterazione) nasce da un marathon che produsse
    ~308kT per 3 posizioni con dati sporchi: volume a monte = throughput
    negativo a valle. La deroga non deve arrivare agli Scout."""
    for prompt in sorted((REPO_ROOT / "agents" / "scout").glob("scout*.md")):
        text = _src(prompt)
        assert "SC-09" in text
        assert "burn-intent" not in text.lower()
        assert "burn_intent" not in text


def test_sentinel_bridge_does_not_gate_the_weekly_lock_on_the_intent():
    """Il ramo `weekly_locked` del bridge resta cieco alla deroga."""
    for line in _src(LAUNCHER_DIR / "sentinel-bridge.py").splitlines():
        if "weekly_locked" in line:
            assert "_bi" not in line, f"weekly lock derogato: {line.strip()}"


# ── 2 bis. Arriva agli agenti, in 7 lingue ───────────────────────────────

CAPITANO_DIR = REPO_ROOT / "agents" / "capitano"
LANGS = ("", ".it", ".es", ".fr", ".de", ".pt", ".hu")


@pytest.mark.parametrize("lang", LANGS)
def test_captain_prompt_carries_the_derogation(lang):
    """C-02 vive in un prompt: se il coordinatore non sa della deroga la
    annulla in buona fede — è già successo il 2026-07-27."""
    text = _src(CAPITANO_DIR / f"capitano{lang}.md")
    assert "C-23" in text, "regola della deroga assente"
    assert "burn_intent.py status --json" in text, "manca come si legge l'intento"
    assert ".burn-intent.flag" in text


@pytest.mark.parametrize("lang", LANGS)
def test_captain_prompt_lists_the_brakes_that_never_yield(lang):
    text = _src(CAPITANO_DIR / f"capitano{lang}.md")
    for brake in bi_module.NEVER_YIELDS:
        assert brake in text, f"capitano{lang}.md non cita {brake}"


@pytest.mark.parametrize("lang", LANGS)
def test_the_throttle_zero_ban_points_at_its_own_exception(lang):
    """«non esiste porta il throttle a 0» è l'istruzione che ha annullato la
    deroga: ovunque compaia deve portare con sé il rimando a C-23."""
    text = _src(CAPITANO_DIR / f"capitano{lang}.md")
    rule = [l for l in text.splitlines() if l.startswith("**C-07")]
    assert rule, f"capitano{lang}.md: regola C-07 non trovata"
    assert "C-23" in rule[0], (
        f"capitano{lang}.md: C-07 vieta di azzerare il throttle senza dire "
        f"che C-23 è la sua eccezione")
