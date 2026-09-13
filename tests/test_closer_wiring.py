"""
Il CLOSER come agente del prodotto: i cablaggi senza i quali nasce orfano.
[JHT-CLOSER fase D]

Un ruolo nuovo non esiste perché ha un prompt. Esiste quando il launcher lo
riconosce, il watchdog lo cura quando si pianta, il roster lo conta, il
throttle lo frena, il Capitano sa quando spawnarlo — e ognuno di questi posti
è scritto in un linguaggio diverso, quindi nessun test di uno vede l'altro.

Il vincolo che conta di più qui è quello sulla NASCITA: coda vuota o consenso
spento = zero istanze. Un CLOSER che gira a vuoto non è solo uno spreco: è un
agente con un browser e il nome dell'utente che aspetta qualcosa da fare.

Eseguire con: pytest tests/test_closer_wiring.py -v
"""

import importlib.util
import json
import os
import re
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
SKILLS_DIR = REPO_ROOT / "shared" / "skills"
AGENTS_DIR = REPO_ROOT / "agents"
START_AGENT = REPO_ROOT / ".launcher" / "start-agent.sh"
WATCHDOG = REPO_ROOT / ".launcher" / "agent-watchdog.sh"
LOCALES = ("it", "es", "fr", "de", "pt", "hu")

sys.path.insert(0, str(SKILLS_DIR))

import apply_gate  # noqa: E402
import team_roster  # noqa: E402


def _load(name, filename):
    spec = importlib.util.spec_from_file_location(name, SKILLS_DIR / filename)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


# ── Roster e sessione ────────────────────────────────────────────────────────


def test_closer_e_un_worker_del_roster():
    assert "closer" in team_roster.WORKER_ROLES
    assert "closer" in team_roster.ALL_ROLES


def test_la_sessione_del_closer_si_chiama_closer_1():
    assert team_roster.session_name("closer", 1) == "CLOSER-1"


def test_la_produzione_del_closer_e_visibile_al_cancello_di_attivita(tmp_path):
    """`applied_via` contiene il canale, non la sessione: il LIKE per prefisso
    non troverebbe mai una riga, e un CLOSER morto a meta' coda sembrerebbe
    uno fermo da sempre."""
    assert team_roster.PRODUCTION["closer"] == ("applications", "applied_via", "applied_at")
    db = tmp_path / "jobs.db"
    conn = sqlite3.connect(db)
    conn.execute(
        "CREATE TABLE applications (position_id INTEGER, applied_via TEXT, applied_at TEXT)"
    )
    conn.execute(
        "INSERT INTO applications VALUES (1, 'agent_closer', '2026-09-13T09:00:00Z')"
    )
    conn.commit()
    conn.close()
    seen = team_roster.last_activity("CLOSER-1", home=tmp_path)
    assert seen is not None, "la produzione del CLOSER non e' visibile al roster"
    assert seen.isoformat().startswith("2026-09-13T09:00:00")


def test_il_throttle_tratta_il_closer_da_worker():
    mod = _load("throttle_config", "throttle-config.py")
    assert mod._is_worker("closer-1")


@pytest.mark.parametrize(
    "filename,const",
    [
        ("token_metrics_lib.py", "VALID_AGENT_ROLES"),
        ("agent_vitals.py", "VALID_ROLES"),
    ],
)
def test_il_consumo_del_closer_non_diventa_un_agente_fantasma(filename, const):
    src = (SKILLS_DIR / filename).read_text()
    block = src[src.index(const) :]
    block = block[: block.index(")") + 1]
    assert '"closer"' in block


# ── Launcher ─────────────────────────────────────────────────────────────────


def _bash(script, **env):
    return subprocess.run(
        ["bash", "-c", script],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        env={**os.environ, **env},
        timeout=30,
    )


def _function(path: Path, name: str) -> str:
    src = path.read_text()
    m = re.search(rf"^{name}\(\) \{{\n.*?^\}}\n", src, re.M | re.S)
    assert m, f"{name} non trovato in {path.name}"
    return m.group(0)


def test_il_launcher_riconosce_il_ruolo_col_modello_leggero():
    r = _bash(_function(START_AGENT, "get_agent_info") + "get_agent_info closer")
    assert r.stdout.strip() == "CLOSER|high|sonnet"


def test_il_launcher_rifiuta_una_seconda_istanza_anche_col_consenso(tmp_path):
    (tmp_path / "jht.config.json").write_text(
        json.dumps({"applications": {"auto_apply": {"enabled": True}}})
    )
    r = _bash(f'bash "{START_AGENT}" closer 2 </dev/null', JHT_HOME=str(tmp_path))
    assert r.returncode == 1
    assert "single instance" in r.stderr


def test_il_launcher_rifiuta_senza_consenso_prima_di_tutto(tmp_path):
    r = _bash(f'bash "{START_AGENT}" closer 1 </dev/null', JHT_HOME=str(tmp_path))
    assert r.returncode == 1
    assert "has not consented" in r.stderr


# ── Watchdog ─────────────────────────────────────────────────────────────────


def test_il_watchdog_riconosce_la_sessione_del_closer():
    fns = _function(WATCHDOG, "is_agent_session") + _function(WATCHDOG, "session_role")
    r = _bash(fns + 'is_agent_session CLOSER-1 && echo AGENT; session_role CLOSER-1')
    assert r.stdout.split("\n")[0] == "AGENT", "il glob del watchdog non cura il CLOSER"
    assert r.stdout.split("\n")[1].strip() == "closer 1"


def test_il_kickoff_del_watchdog_rimanda_il_closer_alla_coda():
    """Il messaggio parte in background con lo stdout chiuso: si asserisce sul
    ramo del `case`, che e' cio' che decide il testo."""
    fn = _function(WATCHDOG, "worker_kickoff")
    branch = re.search(r"^\s*closer\)\s*body=\"([^\"]*)\"", fn, re.M)
    assert branch, "il watchdog ricrea CLOSER-1 senza dirgli da dove ripartire"
    assert "apply_gate.py queue" in branch.group(1)


# ── Prompt e skill ───────────────────────────────────────────────────────────


def _skills_list(role):
    return [
        ln.split("#", 1)[0].strip()
        for ln in (AGENTS_DIR / role / "skills.list").read_text().splitlines()
        if ln.split("#", 1)[0].strip()
    ]


def test_skills_list_del_closer_risolve_su_skill_esistenti():
    names = _skills_list("closer")
    assert {"apply-authorization", "apply-flow"} <= set(names)
    missing = [n for n in names if not (AGENTS_DIR / "_skills" / n / "SKILL.md").is_file()]
    assert not missing, f"skills.list del CLOSER nomina skill inesistenti: {missing}"


@pytest.mark.parametrize("lang", ("en",) + LOCALES)
def test_prompt_del_closer_intestazione_e_invarianti(lang):
    path = AGENTS_DIR / "closer" / ("closer.md" if lang == "en" else f"closer.{lang}.md")
    text = path.read_text()
    assert "# 📮 CLOSER — Application Assistant (user-authorised)" in text.splitlines()[:3]
    # I tre invarianti in cima, prima del loop: sono le regole che valgono anche
    # quando il resto del prompt non è stato letto.
    for rule in ("CL-01", "CL-02", "CL-03"):
        assert text.index(f"**{rule}") < text.index("apply_gate.py queue"), (lang, rule)
    assert "applied_via = agent_closer" in text
    assert "apply_gate.py queue" in text and "apply_flow.py" in text


def test_la_coda_e_il_flusso_usano_lo_stesso_checkpoint(tmp_path, monkeypatch):
    """La coda trattiene una posizione leggendo il checkpoint del flusso: se i
    due percorsi divergono, un `blocked_human` torna in coda e il CLOSER lo
    rilancia — il tentativo cieco che la spec vieta."""
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    flow_mod = _load("apply_flow_for_wiring", "apply_flow.py")
    flow = flow_mod.ApplicationFlow(
        position_id=7, url="https://jobs.ashbyhq.com/x/1", profile={}, cv_path=tmp_path / "cv.pdf"
    )
    assert flow.checkpoint_path == apply_gate.checkpoint_path(7)
    assert set(apply_gate.HELD_CHECKPOINT_STATES) <= {"blocked_human", "dry_run", "denied", "complete"} | set(
        flow_mod.STEP_ORDER
    )


# ── Chi lo spawna: il Capitano, e solo con qualcosa da inviare ───────────────


def _c27(path: Path) -> str:
    text = path.read_text()
    start = text.index("**C-27")
    nxt = re.search(r"^(\*\*C-\d+|---$|## )", text[start + 5 :], re.M)
    return text[start : start + 5 + nxt.start()] if nxt else text[start:]


@pytest.mark.parametrize("lang", ("en",) + LOCALES)
def test_il_capitano_spawna_il_closer_solo_se_la_coda_e_aperta(lang):
    path = AGENTS_DIR / "capitano" / ("capitano.md" if lang == "en" else f"capitano.{lang}.md")
    rule = _c27(path)
    assert "python3 /app/shared/skills/apply_gate.py queue" in rule, (
        f"{path.name}: la regola di spawn non legge piu' la coda del gate"
    )
    assert "start-agent.sh closer 1" in rule
    assert "closer 2" in rule, f"{path.name}: l'istanza unica non e' piu' dichiarata"
    assert "roll_worker_number.py" in rule
    # Lo spawn e' condizionato all'exit 0: la regola deve nominare anche il ramo
    # in cui NON si spawna, altrimenti «coda vuota» si legge come «idle da
    # correggere» (C-05) e il Capitano rispawna a ogni tick.
    assert rule.count("`0`") >= 2
    assert "C-05" in rule


def test_la_coda_che_il_capitano_legge_resta_chiusa_senza_niente_da_inviare(tmp_path):
    """Il predicato della regola, eseguito: consenso acceso ma coda vuota →
    exit diverso da zero → zero istanze."""
    cfg = tmp_path / "jht.config.json"
    cfg.write_text(json.dumps({"applications": {"auto_apply": {"enabled": True}}}))
    db = tmp_path / "jobs.db"
    conn = sqlite3.connect(db)
    conn.execute(
        "CREATE TABLE positions (id INTEGER PRIMARY KEY, status TEXT, url TEXT, "
        "apply_requested INTEGER, apply_requested_at TEXT, apply_requested_by TEXT)"
    )
    conn.execute(
        "CREATE TABLE applications (position_id INTEGER, cv_pdf_path TEXT, applied INTEGER, "
        "applied_via TEXT, applied_at TEXT)"
    )
    conn.execute("INSERT INTO positions VALUES (1, 'ready', 'https://x', 0, NULL, NULL)")
    conn.commit()
    conn.close()
    r = subprocess.run(
        [sys.executable, str(SKILLS_DIR / "apply_gate.py"), "queue", "--config", str(cfg), "--db", str(db)],
        capture_output=True,
        text=True,
        env={**os.environ, "JHT_HOME": str(tmp_path)},
    )
    assert r.returncode != 0


# ── La skill apply-flow dice al CLOSER TUTTI i motivi per cui il flusso si ferma ─


def _flow_block_reasons() -> set[str]:
    """Ogni `reason` che `apply_flow.py` può restituire con `blocked_human`.

    Letto dal sorgente, non da una lista: la ricetta Greenhouse ha aggiunto
    otto motivi in un colpo, e una skill che non li nomina lascia il CLOSER a
    interpretare un token che non ha mai visto — cioè a improvvisare proprio
    dove la spec vuole che si fermi.
    """
    src = (SKILLS_DIR / "apply_flow.py").read_text()
    reasons = set(re.findall(r'BlockedHuman\(\s*"([a-z_]+)"', src))
    flow = _load("apply_flow_for_reasons", "apply_flow.py")
    if "{detection.platform}_dom_unrecognised" in src:
        reasons |= {f"{p}_dom_unrecognised" for p in flow.SUPPORTED_PLATFORMS}
    # I due motivi di sfida arrivano come variabile (`challenge`), non letterali.
    reasons |= {"captcha", "two_factor", "ats_conflict"}
    return reasons


@pytest.mark.parametrize("lang", ("en",) + LOCALES)
def test_la_skill_apply_flow_nomina_ogni_motivo_di_blocco(lang):
    path = AGENTS_DIR / "_skills" / "apply-flow" / ("SKILL.md" if lang == "en" else f"SKILL.{lang}.md")
    text = path.read_text()
    missing = sorted(r for r in _flow_block_reasons() if f"`{r}`" not in text)
    assert not missing, f"{path.name}: motivi di blocco del flusso non spiegati al CLOSER: {missing}"
