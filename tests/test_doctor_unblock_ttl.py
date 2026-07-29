"""Il Dottore deve sbloccare, e le sessioni devono avere un TTL ([DOCTOR-UNBLOCK-AND-TTL]).

Origine: incidente 2026-07-28/29. Un team con weekly al 19% (SOTTO-PACE) e load
0,12 è rimasto fermo **undici ore**: nel pane del Capitano c'era una riga
digitata e mai inviata, quel pane risultava occupato a tutti, nessuno assegnava
lavoro, ogni agente finiva il turno e parcheggiava al prompt vuoto. Uno Scorer
ritentava da ore. Il Dottore ha ispezionato nove sessioni in 416s, ha scritto una
diagnosi ineccepibile — ed è rimasto in standby altre sei ore.

Mappa sugli **undici test di accettazione** del ticket
`docs/internal/roadmap/2026-07-29-ticket-doctor-unblock-and-session-ttl.md`. Il
comportamento completo richiederebbe container + provider + tmux veri; qui si
verifica la logica dietro i seam, con un **tmux finto** che rende osservabili i
due stati che il ticket distingue (testo pendente vs TUI congelata) — stesso
approccio di tests/test_team_standby.py e tests/test_stepcap_watchdog.py.

  1.  TTL rispettato        → maybe_ttl_refresh killa una sessione oltre soglia
                              anche col Dottore spento (percorso watchdog).
  2.  Nessuna scappatoia    → contesto/PARKED/skip-fresh non compaiono nel
                              percorso TTL, né nel watchdog né nelle skill.
  3.  Input pendente        → relay al Capitano + domanda all'Assistente, e il
                              testo dell'utente resta nel pane INTATTO.
  4.  Retry-loop            → rilevato da messages.jsonl e il mittente riceve
                              l'ordine di smettere.
  5.  Prompt vuoti + quota  → blocco all_operatives_idle.
  6.  Round fallito         → blocks_cleared < blocks_found ⇒ round_failed.
  7.  Scaglionamento        → cinque sessioni scadute, UN solo refresh per tick.
  8.  working_hours: null   → nessuna restrizione oraria (giro e TTL girano).
  9.  Space+Enter           → sblocca al primo tentativo; TUI congelata NON
                              dichiarata sbloccata ma escalata a recreate.
  10. Worker morto          → respawn entro un tick, col Dottore spento.
  11. Worker fuori finestra → nessun respawn.

Più la correzione al ticket del 2026-07-29 ([TMUX-SEND-LOST-ENTER-ON-CLAUDE]): il
MITTENTE dichiarava successo senza rileggere il pane, e il rinforzo al submit era
dietro `if provider = kimi` mentre il guasto è stato riprodotto su Claude. I test
`test_sender_*` coprono il caso "il testo è rimasto nel prompt" con un pane finto
e verificano che su TUI congelata i ritentativi restino BOUNDED.

Eseguire:
    pytest tests/test_doctor_unblock_ttl.py -v
"""

import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = REPO_ROOT / "shared" / "skills"
LAUNCHER = REPO_ROOT / ".launcher" / "agent-watchdog.sh"
START_AGENT = REPO_ROOT / ".launcher" / "start-agent.sh"
SENDER = REPO_ROOT / "agents" / "_skills" / "tmux-send" / "jht-tmux-send"
REFRESH_SKILL = REPO_ROOT / "agents" / "_skills" / "session-refresh"
UNBLOCK_SKILL = REPO_ROOT / "agents" / "_skills" / "agent-unblock" / "SKILL.md"
DOTTORE = REPO_ROOT / "agents" / "dottore"
LOCALES = ("", ".it", ".es", ".fr", ".de", ".pt", ".hu")

sys.path.insert(0, str(SKILLS_DIR))
import agent_unblock as au        # noqa: E402
import team_roster as tr          # noqa: E402
import working_hours as wh        # noqa: E402


def _now():
    return datetime.now(timezone.utc)


def _iso(dt):
    return dt.isoformat(timespec="seconds").replace("+00:00", "Z")


# ── tmux finto ───────────────────────────────────────────────────────────────
#
# Rende osservabili i due stati che il ticket dichiara indistinguibili a occhio:
#   submit="ok"          la TUI processa l'Enter normalmente
#   submit="needs_space" l'Enter "a freddo" viene ignorato, Space+Enter funziona
#                        (= TESTO PENDENTE)
#   submit="frozen"      non accetta nulla (= TUI CONGELATA)

FAKE_TMUX = r'''#!/usr/bin/env python3
import json, os, sys

STATE = os.path.join(os.environ["FAKE_TMUX_STATE"], "state.json")


def load():
    with open(STATE) as f:
        return json.load(f)


def save(s):
    with open(STATE, "w") as f:
        json.dump(s, f)


def target(a):
    return a[a.index("-t") + 1] if "-t" in a else ""


def render(sess):
    if sess.get("busy"):
        return "Working… (esc to interrupt)\n" + "\n".join(sess.get("transcript", []))
    lines = list(sess.get("transcript", []))
    lines += ["╭" + "─" * 40 + "╮", "│ > " + sess.get("draft", ""), "╰" + "─" * 40 + "╯"]
    return "\n".join(lines)


args = sys.argv[1:]
s = load()
s.setdefault("calls", []).append(args)
cmd = args[0] if args else ""
t = target(args)
sess = s["sessions"].get(t)

if cmd == "has-session":
    save(s); sys.exit(0 if sess is not None else 1)

if cmd == "list-sessions":
    fmt = args[args.index("-F") + 1] if "-F" in args else "#{session_name}"
    out = []
    for name, v in s["sessions"].items():
        out.append(fmt.replace("#{session_name}", name)
                      .replace("#{session_created}", str(v.get("created", 0)))
                      .replace("#{pane_current_command}", v.get("cmd", "claude")))
    save(s); print("\n".join(out)); sys.exit(0)

if cmd == "list-panes":
    if sess is None:
        save(s); sys.exit(1)
    fmt = args[args.index("-F") + 1] if "-F" in args else ""
    save(s); print(fmt.replace("#{pane_current_command}", sess.get("cmd", "claude"))); sys.exit(0)

if cmd == "display-message":
    if sess is None:
        save(s); sys.exit(1)
    fmt = args[-1]
    save(s)
    print(fmt.replace("#{session_created}", str(sess.get("created", 0)))
             .replace("#{pane_current_command}", sess.get("cmd", "claude")))
    sys.exit(0)

if cmd == "capture-pane":
    if sess is None:
        save(s); sys.exit(1)
    save(s); print(render(sess)); sys.exit(0)

if cmd == "kill-session":
    s["sessions"].pop(t, None); save(s); sys.exit(0)

if cmd == "send-keys":
    if sess is None:
        save(s); sys.exit(1)
    if sess.get("submit") == "frozen" and sess.get("draft"):
        # Congelata: non registra nulla — ne' Enter, ne' Space, ne' testo.
        # (Il typing iniziale resta possibile: e' cosi' che il testo ci finisce.)
        if "-l" not in args:
            save(s); sys.exit(0)
    if "-l" in args:
        sess["draft"] = sess.get("draft", "") + args[args.index("-l") + 1]
        sess["last_key"] = "literal"
    else:
        key = args[-1]
        if key == "Space":
            sess["draft"] = sess.get("draft", "") + " "
            sess["last_key"] = "Space"
        elif key == "Enter":
            mode = sess.get("submit", "ok")
            ok = mode == "ok" or (mode == "needs_space" and sess.get("last_key") == "Space")
            if ok and sess.get("draft"):
                sess.setdefault("transcript", []).append("> " + sess["draft"])
                sess["draft"] = ""
            sess["last_key"] = "Enter"
        elif key == "C-u":
            sess["draft"] = ""
            sess["last_key"] = "C-u"
        else:
            sess["last_key"] = key
    s["sessions"][t] = sess
    save(s); sys.exit(0)

save(s); sys.exit(0)
'''


class Tmux:
    """Handle sul tmux finto: sessioni, chiamate registrate, pane."""

    def __init__(self, root: Path, sessions: dict):
        self.root = root
        self.bin = root / "bin"
        self.bin.mkdir(parents=True, exist_ok=True)
        self.state_dir = root / "tmuxstate"
        self.state_dir.mkdir(parents=True, exist_ok=True)
        exe = self.bin / "tmux"
        exe.write_text(FAKE_TMUX)
        exe.chmod(0o755)
        self.write({"sessions": sessions, "calls": []})

    @property
    def state_file(self):
        return self.state_dir / "state.json"

    def write(self, s):
        self.state_file.write_text(json.dumps(s))

    def read(self):
        return json.loads(self.state_file.read_text())

    def sessions(self):
        return self.read()["sessions"]

    def draft(self, name):
        return self.read()["sessions"][name].get("draft", "")

    def calls(self, cmd=None, session=None):
        out = []
        for c in self.read()["calls"]:
            if cmd and (not c or c[0] != cmd):
                continue
            if session and (("-t" not in c) or c[c.index("-t") + 1] != session):
                continue
            out.append(c)
        return out

    def env(self, home: Path, **extra):
        e = os.environ.copy()
        e["PATH"] = f"{self.bin}:{e['PATH']}"
        e["FAKE_TMUX_STATE"] = str(self.state_dir)
        e["JHT_HOME"] = str(home)
        e.update({k: str(v) for k, v in extra.items()})
        return e


def _hours_ago(h):
    return int((_now() - timedelta(hours=h)).timestamp())


@pytest.fixture
def tmux_factory(tmp_path):
    """Costruisce un tmux finto con le sessioni date."""
    made = {}

    def build(sessions):
        t = Tmux(tmp_path / "fake", sessions)
        made["t"] = t
        return t

    yield build


@pytest.fixture
def home(tmp_path):
    h = tmp_path / "jht_home"
    (h / "logs").mkdir(parents=True)
    return h


# ── esecuzione delle funzioni del watchdog (shell vero, tmux finto) ──────────

def _watchdog_prelude() -> str:
    """Tutto il file fino al primo comando eseguibile: solo var e funzioni."""
    src = LAUNCHER.read_text()
    marker = 'log "watchdog start'
    assert marker in src, "il preludio del watchdog è cambiato"
    return src[: src.index(marker)]


def run_watchdog(func: str, tmux: Tmux, home: Path, **env):
    script = _watchdog_prelude() + "\n" + func + "\n"
    return subprocess.run(
        ["bash", "-c", script], text=True, capture_output=True,
        env=tmux.env(home, **env),
    )


# ═══════════════════════════════════════════════════════════════════════════
# 1. TTL rispettato — anche col Dottore spento (percorso watchdog)
# ═══════════════════════════════════════════════════════════════════════════

def test_01_ttl_recreates_an_over_age_session_without_the_doctor(tmux_factory, home):
    """12h+1min → ricreata entro un tick, con contesto al 4% e agente attivo.

    Il Dottore non entra in scena: questo è lo script, ed è la ragione per cui il
    TTL vive in due posti. Quella notte il Dottore era fermo.
    """
    tmux = tmux_factory({
        # 12h e 1 minuto, contesto al 4%, sta pure lavorando (busy)
        "SCOUT-1": {"created": int((_now() - timedelta(hours=12, minutes=1)).timestamp()),
                    "busy": True, "transcript": ["24.9k/1m tokens (4%)"]},
        "CAPITANO": {"created": _hours_ago(2)},
    })
    fake_start = tmux.bin / "start-agent.sh"
    fake_start.write_text("#!/bin/sh\necho started \"$@\"\n")
    fake_start.chmod(0o755)

    r = run_watchdog("maybe_ttl_refresh", tmux, home, JHT_START_AGENT=fake_start)
    assert r.returncode == 0, r.stderr

    assert "SCOUT-1" not in tmux.sessions(), "sessione oltre TTL non ricreata"
    assert "CAPITANO" in tmux.sessions(), "sessione sotto TTL toccata a torto"
    assert "ttl: SCOUT-1" in r.stdout


def test_01b_ttl_default_is_twelve_hours_and_env_overridable():
    src = LAUNCHER.read_text()
    assert 'AGENT_MAX_SESSION_AGE_H="${JHT_AGENT_MAX_SESSION_AGE_H:-12}"' in src
    for suffix in LOCALES:
        text = (DOTTORE / f"dottore{suffix}.md").read_text()
        assert "JHT_AGENT_MAX_SESSION_AGE_H" in text, suffix


# ═══════════════════════════════════════════════════════════════════════════
# 2. Nessuna scappatoia: PARKED / skip-fresh / contesto non annullano il TTL
# ═══════════════════════════════════════════════════════════════════════════

def test_02_ttl_ignores_context_parked_and_freshness(tmux_factory, home):
    """Una sessione al 4% di contesto, PARKED e occupata viene ricreata comunque."""
    tmux = tmux_factory({
        "ANALISTA-2": {"created": _hours_ago(30), "busy": True,
                       "transcript": ["1.2k/1m tokens (4%)", "PARKED — nessun ordine dal Capitano"]},
    })
    r = run_watchdog("maybe_ttl_refresh", tmux, home,
                     JHT_START_AGENT=str(tmux.bin / "missing.sh"))
    assert r.returncode == 0, r.stderr
    assert "ANALISTA-2" not in tmux.sessions()


def test_02b_the_ttl_path_in_the_watchdog_consults_nothing_but_age():
    """Asserzione sul SORGENTE: dentro maybe_ttl_refresh non c'è nessun gate."""
    src = LAUNCHER.read_text()
    body = src[src.index("maybe_ttl_refresh() {"):src.index("maybe_respawn_workers() {")]
    # solo il CODICE ESEGUITO: commenti e riga di log citano quei gate proprio
    # per dire che NON valgono, e li conterebbero come violazioni.
    body = "\n".join(ln for ln in body.splitlines()
                     if not ln.lstrip().startswith(("#", "log \"")))
    for forbidden in ("working_hours", "is_within_working_hours", "PARKED",
                      "/context", "skipped_fresh", "config_ready"):
        assert forbidden not in body, (
            f"maybe_ttl_refresh consulta '{forbidden}': il TTL avrebbe una scappatoia"
        )
    assert '"$age" -ge "$AGENT_MAX_SESSION_AGE_H"' in body, (
        "il confronto del TTL non e' piu' sull'eta'")


def test_02c_every_skip_in_session_refresh_is_explicitly_overridden_by_the_ttl():
    """Le sette lingue devono avere lo Step 1.4 PRIMA dello Step 1.5."""
    for suffix in LOCALES:
        name = "SKILL.md" if suffix == "" else f"SKILL{suffix}.md"
        text = (REFRESH_SKILL / name).read_text()
        assert "1.4" in text, name
        assert "JHT_AGENT_MAX_SESSION_AGE_H" in text, name
        # il TTL precede il controllo del contesto
        assert text.index("1.4") < text.index("1.5"), name
        # e nomina esplicitamente ciò che annulla
        for skip in ("skipped_fresh", "skipped_lowctx", "skipped_parked"):
            assert skip in text, (name, skip)


def test_02d_the_doctor_prompt_says_the_ttl_bypasses_the_skips():
    text = (DOTTORE / "dottore.md").read_text()
    assert "a0. TTL" in text
    assert "bypasses skip-fresh, PARKED and the context" in text


# ═══════════════════════════════════════════════════════════════════════════
# 3. Sblocco da input pendente — il testo dell'utente resta INTATTO
# ═══════════════════════════════════════════════════════════════════════════

def test_03_pending_user_input_is_routed_around_never_through(tmux_factory, home, monkeypatch):
    """Un giro di sblocco su un Capitano ostaggio di una riga dell'utente.

    Deve produrre: il messaggio all'Assistente, il messaggio al Capitano
    («procedi intanto») — e lasciare la riga dell'utente dov'era, byte per byte.
    """
    user_line = "Europe/Rome, ma il venerdì stacco alle 15"
    tmux = tmux_factory({
        "CAPITANO": {"created": _hours_ago(3), "draft": user_line, "submit": "frozen"},
        "ASSISTENTE": {"created": _hours_ago(3)},
    })
    env = tmux.env(home)
    for k, v in env.items():
        monkeypatch.setenv(k, v)

    # scan: il blocco è visto e classificato come "non toccare"
    state = au.classify_pane(au.capture("CAPITANO"))
    assert state["state"] == "draft_user"
    assert state["draft"] == user_line

    # (a) la sonda RIFIUTA di submittare testo non attribuibile a un agente
    verdict = au.probe("CAPITANO")
    assert verdict["verdict"] == "refused"
    assert verdict["reason"] == "user-text"

    # (b) il coordinatore riceve comunque «procedi intanto», senza toccare il pane
    au.relay("CAPITANO", "[@dottore -> @capitano] [UNBLOCK] domanda inoltrata, procedi intanto")
    # (c) l'Assistente riceve la domanda per l'utente (canale normale, pane sano)
    r = subprocess.run(
        [str(SENDER), "ASSISTENTE",
         "[@dottore -> @assistente] [UNBLOCK] Il CAPITANO ha una domanda in sospeso"],
        text=True, capture_output=True, env=env,
    )
    assert r.returncode == 0, r.stderr

    msgs = [json.loads(l) for l in
            (home / "logs" / "messages.jsonl").read_text().splitlines() if l.strip()]
    to_capitano = [m for m in msgs if m["to"] == "capitano" and "procedi intanto" in m.get("body", "")]
    to_assistente = [m for m in msgs if m["to"] == "assistente"]
    assert to_capitano, "manca il messaggio «procedi intanto» al coordinatore"
    assert to_assistente, "manca la domanda all'Assistente"

    # IL PUNTO DEL TEST: la riga dell'utente è ancora lì, intatta.
    assert tmux.draft("CAPITANO") == user_line
    # e nessun tasto è mai stato mandato al pane del Capitano
    assert tmux.calls("send-keys", session="CAPITANO") == []

    # messa in salvo (non cancellata, non inviata: copiata)
    pending = [json.loads(l) for l in
               (home / "logs" / "pending-input.jsonl").read_text().splitlines() if l.strip()]
    assert any(p["draft"] == user_line for p in pending)


def test_03b_relay_reaches_the_captain_through_the_mailbox_he_drains():
    """La consegna senza pane deve finire dove il Capitano guarda a ogni turno."""
    assert "bridge-mailbox.jsonl" in au.relay.__doc__ or True
    src = (SKILLS_DIR / "agent_unblock.py").read_text()
    assert "bridge-mailbox.jsonl" in src


# ═══════════════════════════════════════════════════════════════════════════
# 4. Sblocco da retry-loop
# ═══════════════════════════════════════════════════════════════════════════

def test_04_retry_loop_is_detected_from_the_attempts_not_the_deliveries():
    now = _now()
    entries = [{"ts": _iso(now - timedelta(minutes=m)), "from": "scorer-5", "to": "capitano"}
               for m in (5, 12, 20, 31, 44)]
    entries.append({"ts": _iso(now - timedelta(minutes=9)), "from": "capitano", "to": "scout-1"})
    loops = au.detect_retry_loops(entries, now=now)
    assert [(l["from"], l["to"]) for l in loops] == [("scorer-5", "capitano")]
    assert loops[0]["attempts"] == 5


def test_04b_an_answered_peer_is_not_a_retry_loop():
    now = _now()
    entries = [{"ts": _iso(now - timedelta(minutes=m)), "from": "scorer-5", "to": "capitano"}
               for m in (5, 12, 20)]
    entries.append({"ts": _iso(now - timedelta(minutes=8)), "from": "capitano", "to": "scorer-5"})
    assert au.detect_retry_loops(entries, now=now) == []


def test_04c_the_skill_releases_the_sender_when_the_target_cannot_be_cleared():
    text = UNBLOCK_SKILL.read_text()
    assert "retry_loop" in text
    assert "SMETTI di ritentare" in text
    assert "counts as cleared only when the sender has been told to stop" in text


# ═══════════════════════════════════════════════════════════════════════════
# 5. Prompt vuoti con quota disponibile
# ═══════════════════════════════════════════════════════════════════════════

def test_05_all_operatives_idle_is_a_block(tmux_factory, home):
    panes = {s: {"state": "idle"} for s in ("SCOUT-1", "ANALISTA-1", "SCORER-2")}
    panes["CAPITANO"] = {"state": "idle"}
    out = au.build_scan(panes, messages=[], now=_now())
    kinds = {b["kind"] for b in out["blocks"]}
    assert "all_operatives_idle" in kinds
    assert "mute_coordinator" in kinds
    assert out["blocks_found"] == len(out["blocks"]) >= 2


def test_05b_one_working_operative_is_not_a_team_wide_stall():
    panes = {"SCOUT-1": {"state": "busy"}, "ANALISTA-1": {"state": "idle"},
             "CAPITANO": {"state": "idle"}}
    out = au.build_scan(panes, messages=[{"ts": _iso(_now()), "from": "capitano", "to": "scout-1"}])
    assert "all_operatives_idle" not in {b["kind"] for b in out["blocks"]}


def test_05c_the_kickoff_does_not_wait_for_the_coordinator():
    text = UNBLOCK_SKILL.read_text()
    assert "without waiting for the coordinator" in text.lower() \
        or "WITHOUT waiting for the coordinator" in text


# ═══════════════════════════════════════════════════════════════════════════
# 6. Un giro che lascia vivo un blocco è un giro FALLITO
# ═══════════════════════════════════════════════════════════════════════════

def test_06_a_surviving_block_makes_the_round_failed(home, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(home))
    assert au.round_event(3, 3) == "round_complete"
    assert au.round_event(3, 2) == "round_failed"
    assert au.round_event(0, 0) == "round_complete"

    au.record_round("R1", found=3, cleared=2, home=home)
    au.record_round("R2", found=2, cleared=2, home=home)
    rows = [json.loads(l) for l in
            (home / "logs" / "dottore-actions.jsonl").read_text().splitlines() if l.strip()]
    assert rows[0]["event"] == "round_failed"
    assert rows[0]["blocks_found"] == 3 and rows[0]["blocks_cleared"] == 2
    assert rows[0]["blocks_open"] == 1
    assert rows[1]["event"] == "round_complete"


def test_06b_the_cli_exit_code_makes_a_failed_round_impossible_to_ignore(home):
    env = os.environ.copy()
    env["JHT_HOME"] = str(home)
    r = subprocess.run([sys.executable, str(SKILLS_DIR / "agent_unblock.py"), "record-round",
                        "--round-id", "R", "--found", "2", "--cleared", "1"],
                       text=True, capture_output=True, env=env)
    assert r.returncode == 1
    assert json.loads(r.stdout)["event"] == "round_failed"


def test_06c_the_doctor_prompt_forbids_round_complete_with_a_live_block():
    for suffix in LOCALES:
        text = (DOTTORE / f"dottore{suffix}.md").read_text()
        assert "blocks_found" in text and "blocks_cleared" in text, suffix
        assert "round_failed" in text, suffix


# ═══════════════════════════════════════════════════════════════════════════
# 7. Scaglionamento: cinque sessioni scadute, un refresh per tick
# ═══════════════════════════════════════════════════════════════════════════

def test_07_five_expired_sessions_are_not_refreshed_in_the_same_tick(tmux_factory, home):
    ages = {"SCOUT-1": 13, "SCOUT-2": 40, "ANALISTA-1": 14, "SCORER-1": 22, "CAPITANO": 18}
    tmux = tmux_factory({s: {"created": _hours_ago(h)} for s, h in ages.items()})
    fake_start = tmux.bin / "start-agent.sh"
    fake_start.write_text("#!/bin/sh\nexit 0\n")
    fake_start.chmod(0o755)

    r = run_watchdog("maybe_ttl_refresh", tmux, home, JHT_START_AGENT=fake_start)
    assert r.returncode == 0, r.stderr

    killed = [c[c.index("-t") + 1] for c in tmux.calls("kill-session")]
    assert len(killed) == 1, f"più di un refresh nello stesso tick: {killed}"
    # ordinate per età DECRESCENTE: la più vecchia per prima
    assert killed == ["SCOUT-2"], killed
    assert len(tmux.sessions()) == 4


# ═══════════════════════════════════════════════════════════════════════════
# 8. working_hours: null = nessuna restrizione oraria
# ═══════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("cfg", [
    {"team": {"working_hours": None}},
    {"team": {}},
    {},
    {"team": {"working_hours": {"timezone": "Europe/Rome", "windows": []}}},
])
def test_08_null_working_hours_means_no_restriction(cfg):
    assert wh.is_within_working_hours(config=cfg) is True


def test_08b_the_roster_gate_is_fail_open_on_a_null_config(home, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(home))
    (home / "jht.config.json").write_text(json.dumps({"team": {"working_hours": None}}))
    assert tr._within_working_hours() is True


def test_08c_the_skills_state_the_null_behaviour_explicitly():
    for suffix in LOCALES:
        name = "SKILL.md" if suffix == "" else f"SKILL{suffix}.md"
        assert "working_hours: null" in (REFRESH_SKILL / name).read_text(), name
        assert "working_hours: null" in (DOTTORE / f"dottore{suffix}.md").read_text(), suffix


# ═══════════════════════════════════════════════════════════════════════════
# 9. Space+Enter: testo pendente vs TUI congelata
# ═══════════════════════════════════════════════════════════════════════════

def test_09_pending_text_is_cleared_at_the_first_probe(tmux_factory, home, monkeypatch):
    """Un Enter a freddo non basta; Space POI Enter sì. Una sola sonda."""
    stuck = "[@capitano -> @scout-1] [MSG] riprendi la coda"
    tmux = tmux_factory({"SCOUT-1": {"created": _hours_ago(2), "draft": stuck,
                                     "submit": "needs_space"}})
    for k, v in tmux.env(home).items():
        monkeypatch.setenv(k, v)

    out = au.probe("SCOUT-1", settle_sec=0.05)
    assert out["verdict"] == "unblocked", out
    assert tmux.draft("SCOUT-1") == "", "il testo doveva partire"
    keys = [c[-1] for c in tmux.calls("send-keys", session="SCOUT-1")]
    assert keys == ["Space", "Enter"], keys


def test_09b_a_frozen_tui_is_not_declared_unblocked(tmux_factory, home, monkeypatch):
    stuck = "[@capitano -> @scorer-3] [MSG] procedi"
    tmux = tmux_factory({"SCORER-3": {"created": _hours_ago(15), "draft": stuck,
                                      "submit": "frozen"}})
    for k, v in tmux.env(home).items():
        monkeypatch.setenv(k, v)

    out = au.probe("SCORER-3", settle_sec=0.05)
    assert out["verdict"] == "frozen", out
    # UNA sola sonda: mai un ciclo su una TUI che non risponde
    assert [c[-1] for c in tmux.calls("send-keys", session="SCORER-3")] == ["Space", "Enter"]


def test_09c_the_skill_escalates_a_frozen_tui_to_recreate_not_to_a_retry():
    text = UNBLOCK_SKILL.read_text()
    assert "frozen" in text and "kill + recreate" in text
    assert "do not retry the probe" in text.lower()
    assert "One probe per pane, ever" in text


def test_09d_the_probe_refuses_user_text_and_the_prompt_says_so(tmux_factory, home, monkeypatch):
    tmux = tmux_factory({"CAPITANO": {"created": _hours_ago(4), "draft": "sì, lavoraci sul watchdog"}})
    for k, v in tmux.env(home).items():
        monkeypatch.setenv(k, v)
    r = subprocess.run([sys.executable, str(SKILLS_DIR / "agent_unblock.py"), "probe", "CAPITANO"],
                       text=True, capture_output=True, env=tmux.env(home))
    assert r.returncode == 3
    assert json.loads(r.stdout)["verdict"] == "refused"
    assert tmux.calls("send-keys", session="CAPITANO") == []
    for suffix in LOCALES:
        assert "D-04" in (DOTTORE / f"dottore{suffix}.md").read_text(), suffix


# ═══════════════════════════════════════════════════════════════════════════
# 10. Worker morto respawnato entro un tick, col Dottore spento
# ═══════════════════════════════════════════════════════════════════════════

def _roster(home, entries):
    (home / "logs").mkdir(parents=True, exist_ok=True)
    (home / "logs" / "team-roster.json").write_text(
        json.dumps({"version": 1, "agents": entries}))


def test_10_a_dead_worker_comes_back_within_one_watchdog_tick(tmux_factory, home):
    """SCORER-3 sparito mentre lavorava, dentro la finestra: torna."""
    (home / "jht.config.json").write_text(json.dumps({"team": {"working_hours": None}}))
    _roster(home, {
        "SCORER-3": {"session": "SCORER-3", "role": "scorer", "instance": 3,
                     "status": "active", "first_seen": _iso(_now() - timedelta(hours=5)),
                     "last_spawn": _iso(_now() - timedelta(hours=5)), "respawns": []},
    })
    (home / "logs" / "messages.jsonl").write_text(json.dumps(
        {"ts": _iso(_now() - timedelta(minutes=3)), "from": "scorer-3", "to": "capitano",
         "type": "MSG", "preview": "decimo tentativo"}) + "\n")

    tmux = tmux_factory({"CAPITANO": {"created": _hours_ago(1)}})   # SCORER-3 NON c'è
    marker = home / "started.txt"
    fake_start = tmux.bin / "start-agent.sh"
    fake_start.write_text(f'#!/bin/sh\necho "$@" >> "{marker}"\n')
    fake_start.chmod(0o755)

    r = run_watchdog("maybe_respawn_workers", tmux, home,
                     JHT_START_AGENT=fake_start,
                     JHT_ROSTER_TOOL=str(SKILLS_DIR / "team_roster.py"))
    assert r.returncode == 0, r.stderr
    assert marker.exists(), f"nessun respawn: {r.stdout}\n{r.stderr}"
    assert marker.read_text().split() == ["scorer", "3"]
    assert "roster: SCORER-3" in r.stdout
    # la sonda è stata registrata: non se ne spende una seconda subito
    roster = json.loads((home / "logs" / "team-roster.json").read_text())
    assert roster["agents"]["SCORER-3"]["respawns"]


def test_10b_the_watchdog_watches_the_numbered_workers_not_just_the_core():
    src = LAUNCHER.read_text()
    assert "maybe_respawn_workers" in src
    assert src.index("maybe_respawn_workers\n") > src.index('for role in "${AGENTS[@]}"')
    # e il roster viene scritto dall'unico percorso per cui un agente esiste
    assert "team_roster.py" in START_AGENT.read_text()
    assert "record" in START_AGENT.read_text()


def test_10c_a_worker_that_was_already_idle_is_not_respawned():
    """Chi il Capitano ha tolto era fermo: nessuna attività ⇒ non si ricrea.

    È la guardia che impedisce al watchdog di combattere col coordinatore.
    """
    now = _now()
    state = {"agents": {"SCOUT-4": {"session": "SCOUT-4", "role": "scout", "instance": 4,
                                    "status": "active", "respawns": []}}}
    entry, reason, _ = tr.decide_respawn(state, alive=set(), now=now,
                                         activity={"SCOUT-4": None},
                                         in_window=True, halted="")
    assert entry is None and reason == "no-candidate"

    stale = {"SCOUT-4": now - timedelta(hours=4)}
    entry, reason, _ = tr.decide_respawn(state, alive=set(), now=now, activity=stale,
                                         in_window=True, halted="")
    assert entry is None and reason == "no-candidate"


def test_10d_a_second_disappearance_retires_the_entry_instead_of_looping():
    """Sonda a colpo singolo: il conflitto col coordinatore dura un kick-off."""
    now = _now()
    state = {"agents": {"SCOUT-4": {"session": "SCOUT-4", "role": "scout", "instance": 4,
                                    "status": "active",
                                    "respawns": [_iso(now - timedelta(minutes=20))]}}}
    entry, reason, retire = tr.decide_respawn(
        state, alive=set(), now=now, activity={"SCOUT-4": now}, in_window=True, halted="")[:3]
    assert entry is None
    assert retire == ["SCOUT-4"]


def test_10e_a_halt_or_standby_flag_stops_every_respawn():
    now = _now()
    state = {"agents": {"SCOUT-1": {"session": "SCOUT-1", "role": "scout", "instance": 1,
                                    "status": "active", "respawns": []}}}
    entry, reason, _ = tr.decide_respawn(state, alive=set(), now=now,
                                         activity={"SCOUT-1": now}, in_window=True,
                                         halted="standby")
    assert entry is None and reason == "halt:standby"


def test_10f_the_global_cap_stops_rebuilding_a_team_someone_just_dismantled():
    now = _now()
    agents = {}
    for i in range(1, 6):
        agents[f"SCOUT-{i}"] = {"session": f"SCOUT-{i}", "role": "scout", "instance": i,
                                "status": "active",
                                "respawns": [_iso(now - timedelta(minutes=5))] if i <= 3 else []}
    entry, reason, _ = tr.decide_respawn({"agents": agents}, alive=set(), now=now,
                                         activity={f"SCOUT-{i}": now for i in range(1, 6)},
                                         in_window=True, halted="")
    assert entry is None
    assert reason.startswith("respawn-cap")


# ═══════════════════════════════════════════════════════════════════════════
# 11. Worker assente fuori finestra: nessun respawn
# ═══════════════════════════════════════════════════════════════════════════

def test_11_no_respawn_outside_the_working_window():
    now = _now()
    state = {"agents": {"SCORER-3": {"session": "SCORER-3", "role": "scorer", "instance": 3,
                                     "status": "active", "respawns": []}}}
    entry, reason, _ = tr.decide_respawn(state, alive=set(), now=now,
                                         activity={"SCORER-3": now},
                                         in_window=False, halted="")
    assert entry is None
    assert reason == "outside-working-hours"


def test_11b_the_same_worker_outside_hours_stays_down_end_to_end(tmux_factory, home):
    start, end = ((_now() - timedelta(hours=4)).hour, (_now() - timedelta(hours=2)).hour)
    (home / "jht.config.json").write_text(json.dumps({"team": {"working_hours": {
        "timezone": "UTC",
        "windows": [{"days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
                     "start": f"{start:02d}:00", "end": f"{end:02d}:00"}]}}}))
    _roster(home, {"SCORER-3": {"session": "SCORER-3", "role": "scorer", "instance": 3,
                                "status": "active", "respawns": []}})
    (home / "logs" / "messages.jsonl").write_text(json.dumps(
        {"ts": _iso(_now()), "from": "scorer-3", "to": "capitano"}) + "\n")

    tmux = tmux_factory({"CAPITANO": {"created": _hours_ago(1)}})
    marker = home / "started.txt"
    fake_start = tmux.bin / "start-agent.sh"
    fake_start.write_text(f'#!/bin/sh\necho "$@" >> "{marker}"\n')
    fake_start.chmod(0o755)

    r = run_watchdog("maybe_respawn_workers", tmux, home,
                     JHT_START_AGENT=fake_start,
                     JHT_ROSTER_TOOL=str(SKILLS_DIR / "team_roster.py"))
    assert r.returncode == 0, r.stderr
    assert not marker.exists(), "worker ricreato fuori dalla finestra di lavoro"


def test_11c_but_the_ttl_is_never_suspended_by_the_hour_gate(tmux_factory, home):
    """Il contrappunto all'11: il TTL non conosce la finestra di lavoro."""
    start, end = ((_now() - timedelta(hours=4)).hour, (_now() - timedelta(hours=2)).hour)
    (home / "jht.config.json").write_text(json.dumps({"team": {"working_hours": {
        "timezone": "UTC",
        "windows": [{"days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
                     "start": f"{start:02d}:00", "end": f"{end:02d}:00"}]}}}))
    tmux = tmux_factory({"SCOUT-1": {"created": _hours_ago(30)}})
    fake_start = tmux.bin / "start-agent.sh"
    fake_start.write_text("#!/bin/sh\nexit 0\n")
    fake_start.chmod(0o755)
    r = run_watchdog("maybe_ttl_refresh", tmux, home, JHT_START_AGENT=fake_start)
    assert r.returncode == 0, r.stderr
    assert "SCOUT-1" not in tmux.sessions(), "il gate orario ha sospeso il TTL"


# ═══════════════════════════════════════════════════════════════════════════
# Correzione 2026-07-29 — [TMUX-SEND-LOST-ENTER-ON-CLAUDE]
# Il mittente dichiarava successo senza rileggere il pane, e il rinforzo al
# submit era gated su kimi mentre il guasto è stato riprodotto su Claude.
# ═══════════════════════════════════════════════════════════════════════════

def _send(tmux: Tmux, home: Path, session: str, msg: str, **env):
    return subprocess.run([str(SENDER), session, msg], text=True, capture_output=True,
                          env=tmux.env(home, **env))


def test_sender_normal_delivery_still_exits_zero(tmux_factory, home):
    """Nessuna regressione sul caso sano: un Enter, exit 0."""
    tmux = tmux_factory({"SCOUT-1": {"created": _hours_ago(1), "submit": "ok"}})
    r = _send(tmux, home, "SCOUT-1", "[@capitano -> @scout-1] [MSG] riprendi la coda")
    assert r.returncode == 0, (r.stdout, r.stderr)
    assert tmux.draft("SCOUT-1") == ""
    keys = [c[-1] for c in tmux.calls("send-keys", session="SCOUT-1") if "-l" not in c]
    assert keys == ["Enter"], keys


def test_sender_recovers_a_lost_enter_on_a_claude_pane(tmux_factory, home):
    """Il pane ignora l'Enter a freddo: Space+Enter recupera, e vale su Claude.

    Nessuna jht.config.json → provider vuoto (NON kimi): se il rinforzo fosse
    ancora dietro `if provider = kimi`, questo test fallirebbe.
    """
    tmux = tmux_factory({"SCOUT-1": {"created": _hours_ago(1), "submit": "needs_space"}})
    assert not (home / "jht.config.json").exists()
    r = _send(tmux, home, "SCOUT-1", "[@capitano -> @scout-1] [MSG] riprendi la coda")
    assert r.returncode == 0, (r.stdout, r.stderr)
    assert "Space+Enter" in r.stdout
    assert tmux.draft("SCOUT-1") == "", "il messaggio è rimasto nel prompt"


def test_sender_does_not_claim_success_when_the_text_stayed_in_the_prompt(tmux_factory, home):
    """Il cuore della correzione: TUI congelata ⇒ exit 5, non exit 0.

    Un pane con testo non inviato risulta OCCUPATO a chiunque altro: dichiararlo
    consegnato è ciò che trasforma un Enter perso in un deadlock permanente.
    """
    tmux = tmux_factory({"SCOUT-1": {"created": _hours_ago(1), "submit": "frozen"}})
    msg = "[@capitano -> @scout-1] [MSG] riprendi la coda"
    r = _send(tmux, home, "SCOUT-1", msg)
    assert r.returncode == 5, (r.returncode, r.stdout, r.stderr)
    assert "submit NON e' confermato" in r.stderr
    assert msg in tmux.draft("SCOUT-1")
    # e il Dottore lo trova dove lo cerca
    pending = [json.loads(l) for l in
               (home / "logs" / "pending-input.jsonl").read_text().splitlines() if l.strip()]
    assert pending and pending[-1]["session"] == "SCOUT-1"
    assert pending[-1]["reason"] == "submit_unconfirmed"


def test_sender_retries_are_bounded_on_a_frozen_tui(tmux_factory, home):
    """Mai un ciclo infinito: al massimo tre submit, poi si smette."""
    tmux = tmux_factory({"SCOUT-1": {"created": _hours_ago(1), "submit": "frozen"}})
    r = _send(tmux, home, "SCOUT-1", "[@capitano -> @scout-1] [MSG] x")
    assert r.returncode == 5
    keys = [c[-1] for c in tmux.calls("send-keys", session="SCOUT-1") if "-l" not in c]
    assert keys.count("Enter") == 3, keys
    assert keys.count("Space") == 2, keys


def test_sender_still_reports_a_dead_pane_as_three(tmux_factory, home):
    """Un pane che non eco-a nemmeno il testo resta exit 3 (possibile morto)."""
    tmux = tmux_factory({"SCOUT-1": {"created": _hours_ago(1), "submit": "ok"}})
    # pane che scarta il typing: simulato togliendo la sessione dopo il primo giro
    exe = tmux.bin / "tmux"
    exe.write_text(FAKE_TMUX.replace(
        'sess["draft"] = sess.get("draft", "") + args[args.index("-l") + 1]',
        'sess["draft"] = sess.get("draft", "")'))
    exe.chmod(0o755)
    r = _send(tmux, home, "SCOUT-1", "[@capitano -> @scout-1] [MSG] x")
    assert r.returncode == 3, (r.returncode, r.stderr)


def test_sender_exit_codes_are_documented():
    src = SENDER.read_text()
    assert "#   5 → testo DIGITATO ma submit NON confermato" in src
    assert "_submit_confirmed" in src
    assert "_composer_holds" in src
