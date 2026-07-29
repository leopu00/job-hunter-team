"""Test dello sfasamento iniziale dei worker (`spawn_stagger`).

Origine: `[SPAWN-STAGGER-BY-PERIOD]`. Lo stagger allo spawn c'era già ma era una
costante — ~10 minuti fra un worker e l'altro — scollegata dal periodo di
throttle su cui quei worker poi girano. Su un gradino da 5 minuti quella
costante è più GRANDE del periodo: il primo worker ha già ciclato due volte
prima che parta il secondo, quindi le fasi finiscono dove capita. E la trappola
complementare: aspettare esattamente il periodo mette i due in lockstep
permanente.

Cosa questa suite tiene fermo:

  1. l'offset viene dal periodo REALE e dal numero di worker, non da una
     costante — e la scala è quella coprima in minuti primi, non i vecchi
     multipli di 5;
  2. non è MAI il periodo né un suo multiplo (niente lockstep), per ogni
     gradino della scala e per ogni numero di worker;
  3. un worker solo non aspetta niente (percorso anti-idle);
  4. i limiti minimo e massimo esistono e non possono a loro volta creare
     lockstep;
  5. spawn consecutivi non si appaiano — è il difetto che la sola formula
     "T/N da adesso" ricrea;
  6. il pre-armo scrive uno state file che `jht-throttle-check` sa leggere
     (il contratto fra questa skill e il gate è un `grep`, non un parser JSON).

Eseguire:
    pytest tests/test_spawn_stagger.py -v
"""

import importlib.util
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = REPO_ROOT / "shared" / "skills"
LAUNCHER = REPO_ROOT / ".launcher" / "start-agent.sh"

sys.path.insert(0, str(SKILLS_DIR))
import spawn_stagger as ss_module  # noqa: E402


def _load(name: str, path: Path):
    """Import per path (i nomi con `-` non sono importabili normalmente)."""
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


T0 = 1_800_000_000  # un istante fisso qualunque, per test deterministici


@pytest.fixture
def ss(tmp_path, monkeypatch):
    """`spawn_stagger` puntato a una home usa-e-getta, con un throttle-config
    isolato al posto di quello della macchina."""
    tc = _load("throttle_config_for_stagger", SKILLS_DIR / "throttle-config.py")
    tc.CONFIG_DIR = tmp_path / "config"
    tc.CONFIG_FILE = tc.CONFIG_DIR / "throttle.json"
    tc._FLOOR_EXEMPT_FILE = tc.CONFIG_DIR / "throttle-floor-exempt.txt"

    ss_module._TC = tc
    ss_module.STATE_DIR = tmp_path / "state"
    ss_module.LEDGER_FILE = ss_module.STATE_DIR / "spawn-stagger.json"
    ss_module.LOG_FILE = tmp_path / "logs" / "spawn-stagger.jsonl"
    monkeypatch.delenv("JHT_SPAWN_STAGGER", raising=False)
    # Nessuna sessione tmux reale deve poter influenzare i test.
    monkeypatch.setattr(ss_module, "live_agents", lambda: [])
    return ss_module


def _set_throttle(ss, agent, seconds):
    ss._TC.set_agent(agent, seconds)


# ── 1. L'offset viene dal periodo, non da una costante ───────────────────

def test_offset_is_the_period_divided_by_the_workers(ss):
    """Tre worker sul gradino da 5 minuti si vogliono a 1m40s, non a 10 min."""
    assert ss.offset_for(300, 3) == 100
    assert ss.offset_for(300, 2) == 150
    # La costante che c'era prima (600s) non compare da nessuna parte.
    assert ss.offset_for(300, 3) != 600


def test_offset_follows_the_coprime_ladder_not_multiples_of_five(ss):
    """La scala è passata a minuti primi: l'offset deve seguirla, non i
    vecchi gradini a multipli di 5."""
    # 11 min = 660s, tre worker → 220s. Con la vecchia scala (600s) sarebbe 200.
    assert ss.offset_for(660, 3) == 220
    assert ss.offset_for(780, 2) == 300  # tagliato dal limite massimo


def test_offset_reads_the_real_period_of_the_agent(ss):
    """Non si indovina il periodo: si legge quello effettivo dell'agente,
    con floor e scala già applicati da throttle-config."""
    _set_throttle(ss, "scout-1", 660)
    _set_throttle(ss, "scout-2", 660)
    d = ss.plan("scout-2", now=T0, candidates=["scout-1"])
    assert d["period_sec"] == 660
    assert d["workers"] == 2
    assert d["offset_sec"] == 300  # 330 ideale, tagliato dal limite massimo


def test_only_workers_on_the_same_rung_are_counted(ss):
    """Worker su gradini DIVERSI non si contano fra loro: quella collisione la
    governa già la scala coprima, contarli restringerebbe le fette a vuoto."""
    _set_throttle(ss, "scout-1", 300)
    _set_throttle(ss, "analista-1", 660)   # altro gradino
    _set_throttle(ss, "scorer-1", 300)
    d = ss.plan("scorer-1", now=T0, candidates=["scout-1", "analista-1"])
    assert d["peers"] == ["scout-1"]
    assert d["workers"] == 2


# ── 2. Mai lockstep ──────────────────────────────────────────────────────

def test_never_the_period_nor_a_multiple_of_it(ss):
    """Su OGNI gradino della scala, per ogni numero di worker e per una fase
    precedente qualunque, l'offset resta strettamente dentro (0, T)."""
    ladder = ss._TC.THROTTLE_LADDER
    for period in ladder:
        for workers in range(2, 9):
            for delta in (0, 1, 7, 59, period // 3, period - 1, period,
                          3 * period + 11):
                off = ss.offset_for(period, workers,
                                    last_phase=T0 - delta, now=T0)
                assert 0 < off < period, (period, workers, delta, off)
                assert off % period != 0, (period, workers, delta, off)


def test_the_new_worker_never_lands_on_the_previous_ones_phase(ss):
    """La fetta j=0 — quella del worker precedente — è l'unica esclusa: è
    quella che darebbe due worker che ciclano nello stesso istante."""
    period, workers = 300, 3
    for delta in range(0, 300, 7):
        last_phase = T0 - delta
        off = ss.offset_for(period, workers, last_phase=last_phase, now=T0)
        gap = (T0 + off - last_phase) % period
        assert gap != 0, (delta, off)


# ── 3. Un worker solo non aspetta ────────────────────────────────────────

def test_a_lone_worker_does_not_wait(ss):
    """C-05: il primo Scout si spawna subito. Il percorso anti-idle non deve
    guadagnare attese inventate."""
    assert ss.offset_for(300, 1) == 0
    _set_throttle(ss, "scout-1", 300)
    d = ss.plan("scout-1", now=T0, candidates=[])
    assert d["offset_sec"] == 0
    assert d["reason"] == "alone-on-rung"


def test_a_lone_worker_is_not_armed_but_seeds_the_ledger(ss):
    """Niente state file (non deve fermarsi), ma la sua fase è il riferimento
    da cui si misura il prossimo worker del gradino."""
    _set_throttle(ss, "scout-1", 300)
    d = ss.plan("scout-1", now=T0, candidates=[])
    ss.arm("scout-1", d, now=T0)
    assert not (ss.STATE_DIR / "throttle-scout-1.json").exists()
    assert ss.last_phase_on_rung(300) == T0


def test_the_interactive_core_has_no_stagger(ss):
    """Capitano/Sentinella/Assistente/Mentor non hanno ladder e devono restare
    reattivi: farli aspettare allo spawn è solo latenza per l'utente."""
    for agent in ("capitano", "sentinella", "assistente", "mentor"):
        d = ss.plan(agent, now=T0, candidates=["scout-1"])
        assert d["offset_sec"] == 0
        assert d["reason"] == "not-a-worker"


def test_no_throttle_means_no_stagger(ss):
    """Senza periodo non c'è fase da distribuire."""
    _set_throttle(ss, "scout-1", 0)
    ss._TC._FLOOR_EXEMPT_FILE.parent.mkdir(parents=True, exist_ok=True)
    ss._TC._FLOOR_EXEMPT_FILE.write_text("scout-1\n", encoding="utf-8")
    d = ss.plan("scout-1", now=T0, candidates=[])
    assert d["offset_sec"] == 0
    assert d["reason"] == "no-throttle"


# ── 4. I limiti, e il fatto che non creino a loro volta lockstep ─────────

def test_lower_bound_is_the_cli_boot_time(ss):
    """Sotto il boot della TUI (8-15s misurati) lo sfasamento è finzione: i due
    agenti stanno ancora accendendosi."""
    assert ss.MIN_OFFSET_SEC == 12
    # Gradino da 1 minuto con 6 worker: la fetta ideale sarebbe 10s.
    assert ss.offset_for(60, 6) == ss.MIN_OFFSET_SEC


def test_upper_bound_keeps_the_worker_inside_the_liveness_window(ss):
    """Un worker muto per più di ~10 minuti è, per il Dottore, un candidato
    zombie: l'attesa non può trasformare un worker sano in un falso positivo."""
    assert ss.MAX_OFFSET_SEC == 300
    assert ss.offset_for(3600, 2) == 300     # ideale 1800s, tagliato
    assert ss.offset_for(3600, 12) == 300    # ideale 300s, già al limite


def test_the_upper_bound_only_bites_above_ten_minutes_of_period(ss):
    """Il taglio a 300s può avvicinarsi al periodo solo se il periodo è più
    lungo di 600s — sotto, la fetta è già più stretta del limite. È il motivo
    per cui il taglio non può produrre un offset pari a T."""
    for period in ss._TC.THROTTLE_LADDER:
        for workers in range(2, 9):
            ideal = period / workers
            if ideal > ss.MAX_OFFSET_SEC:
                assert period > 600, (period, workers)


def test_bounds_cannot_reach_the_period(ss):
    """Anche con un periodo più corto dei limiti — possibile solo in deroga,
    dove la scala non si applica — l'offset resta sotto il periodo."""
    for period in (5, 13, 20, 30, 45):
        for workers in (2, 3, 5):
            off = ss.offset_for(period, workers, last_phase=T0 - 1, now=T0)
            assert off < period, (period, workers, off)


# ── 5. Spawn consecutivi non si appaiano ─────────────────────────────────

def _simulate_burst(ss, period, roles, spacing=12):
    """Spawn uno dietro l'altro come nel burst di primo avvio, e ritorna le
    fasi risultanti (istante del primo ciclo di ciascun worker)."""
    phases = {}
    for i, role in enumerate(roles):
        now = T0 + i * spacing
        _set_throttle(ss, role, period)
        peers = list(phases.keys())
        d = ss.plan(role, now=now, candidates=peers)
        ss.arm(role, d, now=now)
        phases[role] = now + d["offset_sec"]
    return phases


def test_consecutive_spawns_do_not_bunch_up(ss):
    """Il difetto che la sola 'T/N da adesso' ricrea: quattro spawn a 12s
    l'uno dall'altro finirebbero tutti entro un minuto di distanza. Con la
    griglia ancorata alla fase precedente restano separati."""
    period = 300
    phases = _simulate_burst(
        ss, period, ["scout-1", "analista-1", "scorer-1", "scrittore-1"])
    ordered = sorted(p % period for p in phases.values())
    gaps = [(b - a) for a, b in zip(ordered, ordered[1:])]
    gaps.append(period - ordered[-1] + ordered[0])
    assert min(gaps) >= ss.MIN_OFFSET_SEC, (ordered, gaps)
    assert len(set(ordered)) == len(ordered)


def test_the_whole_rung_is_running_within_one_period(ss):
    """Nessun worker del gruppo resta fermo più di un periodo: lo sfasamento
    distribuisce le fasi, non rimanda il lavoro."""
    period = 300
    roles = ["scout-1", "analista-1", "scorer-1", "scrittore-1", "critico"]
    phases = _simulate_burst(ss, period, roles)
    assert max(phases.values()) - T0 < period


def test_five_workers_on_the_five_minute_rung_reproduce_the_burst_spacing(ss):
    """Verifica incrociata: il roster del primo avvio è scaglionato a mano di
    ~60s, e sul gradino da 5 minuti la formula ricava esattamente quel numero."""
    assert ss.offset_for(300, 5) == 60


def test_ten_workers_shrink_the_slot_instead_of_stretching_the_wait(ss):
    """Dieci worker sullo stesso gradino: la fetta si stringe, l'attesa non
    esplode — l'ultimo parte comunque entro un periodo."""
    period = 300
    roles = [f"scout-{i}" for i in range(1, 11)]
    phases = _simulate_burst(ss, period, roles)
    assert max(phases.values()) - T0 < period
    for role in roles:
        assert ss.offset_for(period, 10) < period


# ── 6. Il contratto col gate: lo state file ──────────────────────────────

def test_arming_writes_a_state_file_the_gate_can_read(ss):
    """`jht-throttle-check` legge lo state file con un `grep -o '"until":[0-9]*'`:
    il formato è parte del contratto, non un dettaglio del serializzatore."""
    _set_throttle(ss, "scout-1", 300)
    _set_throttle(ss, "scout-2", 300)
    d = ss.plan("scout-2", now=T0, candidates=["scout-1"])
    ss.arm("scout-2", d, now=T0)
    raw = (ss.STATE_DIR / "throttle-scout-2.json").read_text(encoding="utf-8")
    m = re.search(r'"until":([0-9]+)', raw)
    assert m, raw
    assert int(m.group(1)) == T0 + d["offset_sec"]
    assert json.loads(raw)["source"] == "spawn-stagger"


def test_the_decision_is_written_down(ss):
    """Ogni spawn lascia una riga: 'perché questi due girano appaiati' deve
    essere una domanda a cui si risponde guardando i dati."""
    _set_throttle(ss, "scout-1", 300)
    d = ss.plan("scout-1", now=T0, candidates=[])
    ss.arm("scout-1", d, now=T0)
    lines = ss.LOG_FILE.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 1
    rec = json.loads(lines[0])
    assert rec["agent"] == "scout-1"
    assert rec["event"] == "spawn-stagger"
    assert "period_sec" in rec and "workers" in rec


def test_the_switch_turns_it_off(ss, monkeypatch):
    """Serve ai percorsi in cui l'attesa è dannosa — per esempio il refresh di
    sessione, che ricrea un worker che era già in una fase buona."""
    monkeypatch.setenv("JHT_SPAWN_STAGGER", "0")
    _set_throttle(ss, "scout-1", 300)
    _set_throttle(ss, "scout-2", 300)
    d = ss.plan("scout-2", now=T0, candidates=["scout-1"])
    assert d["offset_sec"] == 0
    assert d["reason"] == "disabled"


# ── 7. Il launcher lo usa davvero ────────────────────────────────────────

def test_the_launcher_arms_the_stagger(ss):
    """Asserzione sul SORGENTE: il calcolo può essere giusto quanto vuole, se
    `start-agent.sh` non lo invoca non sfasa niente."""
    src = LAUNCHER.read_text(encoding="utf-8")
    assert "spawn_stagger.py" in src
    assert "--arm" in src


def test_the_launcher_does_not_block_on_the_wait(ss):
    """L'attesa non la fa il launcher: bloccarlo bloccherebbe il Capitano che
    lo ha invocato, e le tool call dei provider scadono in 30-120s."""
    src = LAUNCHER.read_text(encoding="utf-8")
    block = src.split("spawn_stagger.py", 1)[1][:600]
    assert not re.search(r"^\s*sleep\s+\$?\{?STAGGER", block, re.M)


def test_the_helper_runs_standalone(ss, tmp_path, monkeypatch):
    """Il launcher la invoca come processo: deve funzionare da riga di comando
    e stampare un intero, anche senza tmux."""
    home = tmp_path / "home"
    (home / "config").mkdir(parents=True)
    (home / "config" / "throttle.json").write_text('{"default":300}\n',
                                                   encoding="utf-8")
    env = dict(os.environ)
    env["JHT_HOME"] = str(home)
    out = subprocess.run(
        [sys.executable, str(SKILLS_DIR / "spawn_stagger.py"), "scout-2",
         "--peers", "scout-1"],
        capture_output=True, text=True, env=env, timeout=30)
    assert out.returncode == 0, out.stderr
    assert int(out.stdout.strip()) == 150
