"""Disco quasi pieno: avviso sotto il 10%, nessun NUOVO avvio sotto il 3%.

Il disco pieno non era sorvegliato: jobs.db smette di scrivere, la squadra si
pianta senza un errore chiaro, e un avvio che muore a meta' ha gia' speso token.
Questa suite tiene fermo, con `statvfs` FINTO (mai un disco vero):

- 15% libero: non succede niente (nessun avviso, nessun rifiuto);
- 8%: avviso all'utente, con la frase della tabella codice->frase, e si parte;
- 2%: spawn, `jht team start` e `jht upgrade` rifiutano con `disk_low`, e
  l'agente gia' in corso non viene toccato (la guardia sta DOPO la sonda di
  idempotenza);
- le soglie e i codici sono gli stessi in Python, JavaScript, bash e PowerShell;
- la frase non la scrive nessun agente: viene da shared/locales/*.json.

Il launcher gira per davvero (bash, tmux finto sul PATH); il wrapper gira con le
sue funzioni vere e un `df` finto. Il ramo PowerShell non si puo' eseguire su un
Mac (niente pwsh): lo tiene fermo il testo.

Run with: pytest tests/test_disk_guard.py -v
"""

import importlib.util
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
VITALS = ROOT / "shared" / "skills" / "host_vitals.py"
LAUNCHER = ROOT / ".launcher" / "start-agent.sh"
SPAWN_LIB = ROOT / ".launcher" / "spawn-lib.sh"
BRIDGE = ROOT / ".launcher" / "sentinel-bridge.py"
WRAPPER_SH = ROOT / "scripts" / "jht-wrapper.sh"
WRAPPER_PS1 = ROOT / "scripts" / "jht-wrapper.ps1"
GUARD_JS = ROOT / "cli" / "src" / "lib" / "disk-guard.js"
START_JS = ROOT / "cli" / "src" / "commands" / "team" / "start.js"
CATALOG_TS = ROOT / "desktop" / "src" / "lib" / "error-catalog.ts"
LOCALES_TS = ROOT / "desktop" / "src" / "lib" / "error-catalog.locales.ts"
LOCALES = ROOT / "shared" / "locales"
LANGS = ("en", "it", "de", "es", "fr", "hu", "pt")

# statvfs finto: caricato da `sitecustomize` (PYTHONPATH) nei sottoprocessi, cosi'
# il codice di produzione non ha nessun gancio di test.
SITECUSTOMIZE = '''
import json, os
_spec = json.loads(os.environ.get("FAKE_STATVFS", "{}"))
if _spec:
    def _fake(path):
        p = os.fspath(path)
        best, pct = "", _spec.get("default", 50)
        for prefix, value in _spec.get("paths", {}).items():
            inside = p == prefix or p.startswith(prefix.rstrip("/") + "/")
            if inside and len(prefix) >= len(best):
                best, pct = prefix, value
        total = 1_000_000
        free = int(total * pct / 100)
        return os.statvfs_result((4096, 4096, total, free, free, 100, 50, 50, 0, 255))
    os.statvfs = _fake
'''


def load_vitals():
    spec = importlib.util.spec_from_file_location("host_vitals_under_test", VITALS)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fake_statvfs(by_prefix, default=50):
    def _fake(path):
        p = os.fspath(path)
        best, pct = "", default
        for prefix, value in by_prefix.items():
            if (p == prefix or p.startswith(prefix.rstrip("/") + "/")) and len(prefix) >= len(best):
                best, pct = prefix, value
        total = 1_000_000
        free = int(total * pct / 100)
        return os.statvfs_result((4096, 4096, total, free, free, 100, 50, 50, 0, 255))
    return _fake


def phrase(lang, key, shown):
    table = json.loads((LOCALES / f"{lang}.json").read_text(encoding="utf-8"))
    return table[key] % shown


@pytest.fixture
def volumes(tmp_path):
    home, engine = tmp_path / "home", tmp_path / "engine"
    home.mkdir()
    engine.mkdir()
    return home, engine


@pytest.fixture
def fakedir(tmp_path):
    path = tmp_path / "fakevfs"
    path.mkdir()
    (path / "sitecustomize.py").write_text(SITECUSTOMIZE, encoding="utf-8")
    return path


def child_env(fakedir, home, engine, home_pct, engine_pct, **extra):
    spec = {"default": 50, "paths": {str(home): home_pct, str(engine): engine_pct}}
    return {
        **os.environ,
        "PYTHONPATH": str(fakedir),
        "FAKE_STATVFS": json.dumps(spec),
        "JHT_HOME": str(home),
        "JHT_ENGINE_DISK_PATH": str(engine),
        "JHT_LANG": "en",
        **extra,
    }


# ── (a) host_vitals: spazio libero di JHT_HOME e del motore ───────────────────


def disk_at(monkeypatch, volumes, home_pct, engine_pct):
    home, engine = volumes
    hv = load_vitals()
    monkeypatch.setattr(os, "statvfs", fake_statvfs({str(home): home_pct, str(engine): engine_pct}))
    return hv, hv.read_disk({"JHT_HOME": str(home), "JHT_ENGINE_DISK_PATH": str(engine)})


def test_read_disk_reports_free_space_and_percent_of_both_volumes(monkeypatch, volumes):
    _, disk = disk_at(monkeypatch, volumes, 15, 40)
    assert disk["jht_home"]["free_pct"] == 15.0
    assert disk["jht_home"]["free_bytes"] == 150_000 * 4096
    assert disk["jht_home"]["total_bytes"] == 1_000_000 * 4096
    assert disk["engine"]["free_pct"] == 40.0
    assert disk["level"] == "ok" and disk["code"] is None
    assert disk["min_free_pct"] == 15.0


def test_read_disk_takes_the_worst_of_the_two_volumes(monkeypatch, volumes):
    _, disk = disk_at(monkeypatch, volumes, 40, 8)
    assert (disk["level"], disk["code"], disk["min_free_pct"]) == ("warn", "disk_warning", 8.0)
    _, disk = disk_at(monkeypatch, volumes, 2, 40)
    assert (disk["level"], disk["code"]) == ("low", "disk_low")
    _, disk = disk_at(monkeypatch, volumes, 40, 2)
    assert (disk["level"], disk["code"]) == ("low", "disk_low")


def test_thresholds_are_strictly_below_ten_and_three_percent(monkeypatch, volumes):
    hv = load_vitals()
    assert (hv.DISK_WARN_FREE_PCT, hv.DISK_BLOCK_FREE_PCT) == (10.0, 3.0)
    assert disk_at(monkeypatch, volumes, 10, 50)[1]["level"] == "ok"
    assert disk_at(monkeypatch, volumes, 9.99, 50)[1]["level"] == "warn"
    assert disk_at(monkeypatch, volumes, 3, 50)[1]["level"] == "warn"
    assert disk_at(monkeypatch, volumes, 2.99, 50)[1]["level"] == "low"


def test_a_volume_that_does_not_resolve_is_unknown_never_an_error(monkeypatch, volumes):
    home, _ = volumes
    hv = load_vitals()

    def boom(path):
        raise OSError("no such device")

    monkeypatch.setattr(os, "statvfs", boom)
    disk = hv.read_disk({"JHT_HOME": str(home), "JHT_ENGINE_DISK_PATH": ""})
    assert disk["level"] == "unknown" and disk["code"] is None
    assert disk["jht_home"]["free_pct"] is None
    assert disk["engine"]["level"] == "unknown"


def test_the_engine_volume_alone_unresolved_leaves_the_home_volume_deciding(monkeypatch, volumes):
    home, _ = volumes
    hv = load_vitals()
    monkeypatch.setattr(os, "statvfs", fake_statvfs({str(home): 2}))
    disk = hv.read_disk({"JHT_HOME": str(home), "JHT_ENGINE_DISK_PATH": ""})
    assert disk["engine"]["level"] == "unknown"
    assert (disk["level"], disk["code"]) == ("low", "disk_low")


def test_a_missing_jht_home_is_measured_through_its_nearest_existing_parent(monkeypatch, tmp_path):
    hv = load_vitals()
    monkeypatch.setattr(os, "statvfs", fake_statvfs({str(tmp_path): 8}))
    disk = hv.read_disk({"JHT_HOME": str(tmp_path / "not" / "yet"), "JHT_ENGINE_DISK_PATH": ""})
    assert disk["jht_home"]["free_pct"] == 8.0


def test_the_engine_is_never_guessed_from_the_host_disk(monkeypatch, tmp_path):
    """macOS/Windows: il disco del motore e' in una VM. Sconosciuto, non il disco dell'host."""
    hv = load_vitals()
    monkeypatch.setattr(hv, "_in_container", lambda: False)
    monkeypatch.setattr(hv.sys, "platform", "darwin")
    assert hv.engine_disk_path({}) is None
    assert hv.engine_disk_path({"JHT_ENGINE_DISK_PATH": "/data"}) == "/data"
    monkeypatch.setattr(hv, "_in_container", lambda: True)
    assert hv.engine_disk_path({}) == "/"


def test_read_vitals_carries_the_disk_next_to_cpu_and_ram(monkeypatch, volumes):
    home, engine = volumes
    hv = load_vitals()
    monkeypatch.setattr(os, "statvfs", fake_statvfs({str(home): 15, str(engine): 15}))
    monkeypatch.setenv("JHT_HOME", str(home))
    monkeypatch.setenv("JHT_ENGINE_DISK_PATH", str(engine))
    monkeypatch.setattr(hv, "_cpu", lambda: {"pct": None})
    monkeypatch.setattr(hv, "_mem", lambda: {"pct": None})
    v = hv.read_vitals()
    assert set(v) == {"ts", "cpu", "mem", "disk"}
    assert v["disk"]["level"] == "ok"


# ── (b) 15% niente, 8% avviso, 2% disk_low ────────────────────────────────────


def test_phrases_come_from_the_table_in_every_language():
    for lang in LANGS:
        table = json.loads((LOCALES / f"{lang}.json").read_text(encoding="utf-8"))
        for key in ("disk.warning", "disk.low"):
            assert key in table, (lang, key)
            assert table[key].count("%s") == 1, (lang, key)
            assert len(table[key]) > 40


@pytest.mark.parametrize("lang", LANGS)
def test_the_user_phrase_is_the_table_entry_in_the_users_language(monkeypatch, volumes, lang):
    home, _ = volumes
    hv = load_vitals()
    monkeypatch.setenv("JHT_LANG", lang)
    monkeypatch.setenv("JHT_HOME", str(home))
    monkeypatch.syspath_prepend(str(ROOT / "shared"))
    import i18n
    i18n._resolve_lang.cache_clear()
    disk = {"code": "disk_warning", "min_free_pct": 8.0}
    assert hv.disk_phrase(disk) == phrase(lang, "disk.warning", "8%")
    assert hv.disk_phrase({"code": "disk_low", "min_free_pct": 2.5}) == phrase(lang, "disk.low", "2.5%")
    i18n._resolve_lang.cache_clear()


def test_no_code_no_phrase_and_an_unanswering_table_gives_no_improvised_text(monkeypatch):
    hv = load_vitals()
    assert hv.disk_phrase({"code": None, "min_free_pct": 50}) == ""
    monkeypatch.setitem(hv.DISK_PHRASE_KEYS, "disk_low", "disk.no_such_key")
    assert hv.disk_phrase({"code": "disk_low", "min_free_pct": 2}) == ""


class Notices:
    def __init__(self, ok=True):
        self.sent, self.ok = [], ok

    def __call__(self, code, text, bucket):
        self.sent.append((code, text, bucket))
        return self.ok


def test_at_15_percent_nothing_happens(monkeypatch, volumes, tmp_path):
    hv, disk = disk_at(monkeypatch, volumes, 15, 15)
    notices = Notices()
    assert hv.notify_disk(disk, state_path=tmp_path / "notice.json", notifier=notices) is False
    assert notices.sent == []
    assert not (tmp_path / "notice.json").exists()


def test_at_8_percent_the_user_is_warned_once_with_the_table_phrase(monkeypatch, volumes, tmp_path):
    monkeypatch.setenv("JHT_LANG", "en")
    hv, disk = disk_at(monkeypatch, volumes, 8, 50)
    state, notices = tmp_path / "notice.json", Notices()
    assert hv.notify_disk(disk, state_path=state, notifier=notices, now=1_000_000) is True
    assert [(code, text) for code, text, _ in notices.sent] == [
        ("disk_warning", phrase("en", "disk.warning", "8%"))
    ]
    # Stesso livello dentro il cooldown: niente secondo avviso.
    assert hv.notify_disk(disk, state_path=state, notifier=notices, now=1_000_000 + 3600) is False
    assert len(notices.sent) == 1
    # Passato il cooldown, si ripete.
    after = 1_000_000 + hv.DISK_NOTICE_COOLDOWN_S + 1
    assert hv.notify_disk(disk, state_path=state, notifier=notices, now=after) is True
    assert len(notices.sent) == 2


def test_getting_worse_warns_at_once_and_recovering_rearms_the_warning(monkeypatch, volumes, tmp_path):
    monkeypatch.setenv("JHT_LANG", "en")
    state, notices = tmp_path / "notice.json", Notices()
    hv, warn = disk_at(monkeypatch, volumes, 8, 50)
    hv.notify_disk(warn, state_path=state, notifier=notices, now=1000)
    _, low = disk_at(monkeypatch, volumes, 2, 50)
    assert hv.notify_disk(low, state_path=state, notifier=notices, now=1060) is True
    assert notices.sent[-1][0] == "disk_low"
    _, healthy = disk_at(monkeypatch, volumes, 30, 50)
    assert hv.notify_disk(healthy, state_path=state, notifier=notices, now=1120) is False
    assert not state.exists()
    assert hv.notify_disk(warn, state_path=state, notifier=notices, now=1180) is True


def test_a_failed_delivery_is_retried_on_the_next_tick(monkeypatch, volumes, tmp_path):
    monkeypatch.setenv("JHT_LANG", "en")
    hv, disk = disk_at(monkeypatch, volumes, 8, 50)
    state = tmp_path / "notice.json"
    assert hv.notify_disk(disk, state_path=state, notifier=Notices(ok=False), now=1000) is False
    assert not state.exists()
    retry = Notices()
    assert hv.notify_disk(disk, state_path=state, notifier=retry, now=1060) is True


def test_the_warning_goes_through_the_deterministic_notifier_with_a_closed_code(monkeypatch, tmp_path):
    """Il canale e' jht-notify-user (riga per la dashboard + Telegram), mai un agente."""
    hv = load_vitals()
    calls = []

    class Done:
        returncode = 0

    monkeypatch.setattr(hv.subprocess, "run", lambda argv, **kw: calls.append(argv) or Done())
    assert hv._send_user_notice("disk_warning", "frase della tabella", 7) is True
    argv = calls[0]
    assert argv[1].endswith("jht-notify-user")
    assert argv[argv.index("--source-id") + 1] == "disk_warning:7"
    assert argv[argv.index("--source-action") + 1] == "disk_guard"
    assert json.loads(argv[argv.index("--source-payload") + 1]) == {"code": "disk_warning"}
    assert argv[-1] == "frase della tabella"


def run_vitals(fakedir, home, engine, home_pct, engine_pct, *args):
    return subprocess.run(
        ["python3", str(VITALS), *args],
        env=child_env(fakedir, home, engine, home_pct, engine_pct),
        capture_output=True, text=True, timeout=30,
    )


@pytest.mark.parametrize("pct,rc", [(15, 0), (8, 0), (3, 0), (2, 3)])
def test_disk_guard_command_refuses_only_under_three_percent(fakedir, volumes, pct, rc):
    home, engine = volumes
    done = run_vitals(fakedir, home, engine, pct, 50, "disk-guard")
    assert done.returncode == rc, done.stderr
    if rc == 0:
        assert done.stderr == "" and done.stdout == ""
    else:
        assert done.stderr.strip() == f"disk_low: {phrase('en', 'disk.low', '2%')}"


def test_disk_guard_command_also_refuses_on_the_engine_volume(fakedir, volumes):
    home, engine = volumes
    assert run_vitals(fakedir, home, engine, 40, 2, "disk-guard").returncode == 3


def test_disk_guard_command_does_not_refuse_what_it_cannot_measure(fakedir, volumes):
    home, _ = volumes
    env = child_env(fakedir, home, home, 2, 2)
    env["FAKE_STATVFS"] = ""  # niente finto: statvfs vero su un disco vero
    env["JHT_HOME"] = str(home)
    env["JHT_ENGINE_DISK_PATH"] = ""
    broken = subprocess.run(
        ["python3", "-c",
         "import os,sys,runpy\n"
         "def boom(p): raise OSError('x')\n"
         "os.statvfs = boom\n"
         f"sys.argv = ['host_vitals.py', 'disk-guard']\n"
         f"runpy.run_path({str(VITALS)!r}, run_name='__main__')\n"],
        env=env, capture_output=True, text=True, timeout=30,
    )
    assert broken.returncode == 0, broken.stderr


def test_disk_command_prints_the_measure_as_json(fakedir, volumes):
    home, engine = volumes
    done = run_vitals(fakedir, home, engine, 8, 40, "disk")
    disk = json.loads(done.stdout)
    assert (disk["level"], disk["code"], disk["min_free_pct"]) == ("warn", "disk_warning", 8.0)


# ── (c) il launcher: spawn rifiutato, agente in corso intatto ─────────────────


def run_launcher(tmp_path, fakedir, volumes, home_pct, engine_pct, role="assistente", session_exists=False):
    home, engine = volumes
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    log = tmp_path / "tmux.log"
    tmux = bin_dir / "tmux"
    tmux.write_text(
        "#!/bin/sh\n"
        f'echo "$*" >> "{log}"\n'
        'if [ "$1" = has-session ]; then exit ' + ("0" if session_exists else "1") + "; fi\n"
        # Se il launcher supera la guardia arriva fin qui: la sessione NON nasce
        # (rc 1 subito), cosi' il test non lancia niente e non aspetta nessun REPL.
        'if [ "$1" = new-session ]; then echo "tmux: fake refusal" >&2; exit 1; fi\n'
        "exit 0\n",
        encoding="utf-8",
    )
    tmux.chmod(0o755)
    fake_home = tmp_path / "userhome"
    fake_home.mkdir(exist_ok=True)
    env = child_env(fakedir, home, engine, home_pct, engine_pct,
                    PATH=f"{bin_dir}{os.pathsep}{os.environ['PATH']}", JHT_SPAWN_SRC="disk-guard-test",
                    HOME=str(fake_home), JHT_USER_DIR=str(fake_home / "docs"))
    done = subprocess.run(["bash", str(LAUNCHER), role], cwd=ROOT, env=env,
                          capture_output=True, text=True, timeout=60)
    trace = home / "logs" / "spawn-attempts.jsonl"
    rows = [json.loads(line) for line in trace.read_text(encoding="utf-8").splitlines()] if trace.exists() else []
    calls = log.read_text(encoding="utf-8").splitlines() if log.exists() else []
    return done, rows, calls


@pytest.mark.parametrize("role,session", [("assistente", "ASSISTENTE"), ("scout", "SCOUT-1"), ("worker", "SENTINELLA-WORKER")])
def test_at_2_percent_a_new_spawn_is_refused_with_disk_low(tmp_path, fakedir, volumes, role, session):
    done, rows, calls = run_launcher(tmp_path, fakedir, volumes, 2, 50, role=role)
    assert done.returncode == 1, done.stdout + done.stderr
    assert f"disk_low: {phrase('en', 'disk.low', '2%')}" in done.stderr
    assert "disk_low" in done.stderr.strip().splitlines()[-1]
    assert rows[-1]["stage"] == "disk_low" and rows[-1]["rc"] == 1
    assert rows[-1]["session"] == session
    # Solo la sonda "esiste gia'?": nessuna sessione creata, nessun tasto inviato.
    assert calls and all(call.startswith("has-session") for call in calls), calls


def test_the_engine_volume_alone_below_three_percent_refuses_the_spawn(tmp_path, fakedir, volumes):
    done, rows, calls = run_launcher(tmp_path, fakedir, volumes, 40, 2)
    assert done.returncode == 1
    assert rows[-1]["stage"] == "disk_low"


@pytest.mark.parametrize("role", ["assistente", "worker"])
def test_at_2_percent_an_agent_already_running_is_left_alone(tmp_path, fakedir, volumes, role):
    done, rows, calls = run_launcher(tmp_path, fakedir, volumes, 2, 2, role=role, session_exists=True)
    assert done.returncode == 0, done.stderr
    assert "disk_low" not in done.stdout + done.stderr
    assert rows[-1]["stage"] == "already_active" and rows[-1]["rc"] == 0
    assert all(call.startswith("has-session") for call in calls), calls


@pytest.mark.parametrize("pct", [15, 8])
def test_at_15_and_8_percent_the_spawn_is_not_stopped_by_the_guard(tmp_path, fakedir, volumes, pct):
    done, rows, calls = run_launcher(tmp_path, fakedir, volumes, pct, pct)
    assert "disk_low" not in done.stdout + done.stderr
    # superata la guardia: il launcher e' andato avanti (preflight o oltre) e si e'
    # fermato per altro, nel tmux finto che non crea niente
    assert rows[-1]["stage"] not in ("disk_low", "disk_guard", "idempotence_probe", "lock_wait"), rows[-1]
    assert not any(call.startswith("send-keys") for call in calls), calls


def test_the_guard_function_alone_follows_the_same_thresholds(tmp_path, fakedir, volumes):
    home, engine = volumes
    results = {}
    for pct in (15, 8, 2):
        done = subprocess.run(
            ["bash", "-c", f'. "{SPAWN_LIB}"; jht_spawn_disk_guard; echo rc=$?'],
            env=child_env(fakedir, home, engine, pct, pct), capture_output=True, text=True, timeout=30)
        results[pct] = re.search(r"rc=(\d+)", done.stdout).group(1)
    assert results == {15: "0", 8: "0", 2: "1"}


def test_a_guard_that_crashes_does_not_block_the_spawn(tmp_path):
    """Solo rc 3 rifiuta: un modulo rotto (rc 1/2) o un tetto scaduto (124) lasciano partire."""
    for rc in (1, 2, 124, 127):
        lib = tmp_path / f"lib{rc}"
        (lib / "launcher").mkdir(parents=True)
        (lib / "shared" / "skills").mkdir(parents=True)
        (lib / "launcher" / "spawn-lib.sh").write_text(SPAWN_LIB.read_text(encoding="utf-8"), encoding="utf-8")
        (lib / "launcher" / "daemon-lib.sh").write_text(
            (ROOT / ".launcher" / "daemon-lib.sh").read_text(encoding="utf-8"), encoding="utf-8")
        (lib / "shared" / "skills" / "host_vitals.py").write_text(
            f"import sys\nsys.exit({rc})\n", encoding="utf-8")
        done = subprocess.run(
            ["bash", "-c", f'. "{lib}/launcher/spawn-lib.sh"; jht_spawn_disk_guard; echo rc=$?'],
            capture_output=True, text=True, timeout=30)
        assert "rc=0" in done.stdout, (rc, done.stdout, done.stderr)
    (lib / "shared" / "skills" / "host_vitals.py").write_text("import sys\nsys.exit(3)\n", encoding="utf-8")
    refused = subprocess.run(
        ["bash", "-c", f'. "{lib}/launcher/spawn-lib.sh"; jht_spawn_disk_guard; echo rc=$?'],
        capture_output=True, text=True, timeout=30)
    assert "rc=1" in refused.stdout


def test_a_guard_that_cannot_run_python_does_not_block_the_spawn(tmp_path):
    empty = tmp_path / "nopython"
    empty.mkdir()
    done = subprocess.run(
        ["/bin/bash", "-c", f'. "{SPAWN_LIB}"; jht_spawn_disk_guard; echo rc=$?'],
        env={"PATH": str(empty), "HOME": str(tmp_path)}, capture_output=True, text=True, timeout=30)
    assert "rc=0" in done.stdout


def test_launcher_guard_sits_after_the_idempotence_probe_and_before_any_work():
    text = LAUNCHER.read_text(encoding="utf-8")
    probe = text.index('jht_timeout "$JHT_SPAWN_TMUX_PROBE_SEC" tmux has-session')
    guard = text.index("if ! jht_spawn_disk_guard; then", probe)
    for later in ('_spawn_stage="preflight"', "mkdir -p \"$JHT_LOGS_DIR\"" if False else 'tmux new-session -d -x 220 -y 50 -s "$SESSION"'):
        assert guard < text.index(later, guard), later
    already_active = text.index('_spawn_stage="already_active"', probe)
    assert already_active < guard
    # il worker: dopo la sua sonda, prima della sua new-session
    worker_probe = text.index('tmux has-session -t "=$WORKER_SESSION"')
    worker_guard = text.index("jht_spawn_disk_guard", worker_probe)
    assert worker_guard < text.index('tmux new-session -d -x 220 -y 50 -s "$WORKER_SESSION"')


def test_only_the_agent_spawns_are_guarded_not_the_bridge_and_daemons():
    """Il bridge e' chi manda l'avviso: se il disco e' basso deve poter ripartire."""
    lines = LAUNCHER.read_text(encoding="utf-8").splitlines()
    guarded = [n for n, line in enumerate(lines) if line.strip() == "if ! jht_spawn_disk_guard; then"]
    assert len(guarded) == 2, guarded
    for n in guarded:
        head = "\n".join(lines[:n])
        # i rami dei daemon (bridge, tg-bridge, token-meter, agent-vitals) escono PRIMA
        assert head.count('[ "$ROLE" = "bridge" ]') + head.count('"$ROLE" = "tg-bridge"') >= 0
    daemons = [n for n, line in enumerate(lines) if re.match(r'if \[ "\$ROLE" = "(bridge|tg-bridge|token-meter|agent-vitals)" \]', line)]
    assert daemons, "i rami dei daemon non si trovano piu'"
    assert max(daemons) < guarded[-1] and all(n < guarded[-1] for n in daemons)
    # e nessuna guardia dentro un ramo daemon: tra l'inizio di un ramo e il suo `fi` finale
    for n in daemons:
        end = next(i for i in range(n + 1, len(lines)) if lines[i] == "fi")
        assert not any(n < g < end for g in guarded), (lines[n], guarded)


# ── il bridge manda l'avviso ──────────────────────────────────────────────────


def test_the_sentinel_bridge_asks_host_vitals_to_notify_at_every_tick():
    text = BRIDGE.read_text(encoding="utf-8")
    body = text[text.index("def _sample_vitals_and_maybe_alert"):]
    body = body[: body.index("\ndef ")]
    assert '"notify-disk"' in body
    # prima dell'uscita anticipata per RAM/CPU sotto soglia
    assert body.index('"notify-disk"') < body.index("if not over:")


# ── (c) jht team start (CLI) ──────────────────────────────────────────────────


def test_team_start_asks_the_guard_before_launching_anything():
    text = START_JS.read_text(encoding="utf-8")
    assert "import { diskLowRefusal } from '../../lib/disk-guard.js';" in text
    # container: dopo il "gia' attivo", prima delle sincronizzazioni cloud e dello spawn
    already = text.index("Team already running")
    bootstrap_guard = text.index("refuseIfDiskLow('team')")
    assert already < bootstrap_guard < text.index("pull-desired-state")
    # ogni singolo avvio: dopo "already active", prima di start-agent.sh
    launch = text[text.index("function launchInContainer"):]
    spawn = launch.index("execScriptInContainer('/app/.launcher/start-agent.sh'")
    assert launch.index("already active") < launch.index("refuseIfDiskLow(sName)") < spawn
    # host (tmux locale): dopo "already active", prima di mkdir/tmux
    host = text[text.index("for (const target of targets)"):]
    assert host.index("already active") < host.index("refuseIfDiskLow(sName)") < host.index("tmux new-session")


def test_the_cli_refusal_prints_the_closed_code_and_the_table_phrase():
    text = START_JS.read_text(encoding="utf-8")
    body = text[text.index("function refuseIfDiskLow"):]
    body = body[: body.index("\n}\n")]
    assert "refusal.code" in body and "refusal.message" in body
    guard = GUARD_JS.read_text(encoding="utf-8")
    assert "tf('disk.low'" in guard
    assert "wizard/i18n.js" in guard


# ── (c) jht upgrade (wrapper) ─────────────────────────────────────────────────


def wrapper_function(name: str) -> str:
    text = WRAPPER_SH.read_text(encoding="utf-8")
    match = re.search(rf"^{name}\(\) \{{\n.*?^\}}\n", text, re.S | re.M)
    assert match, name
    return match.group(0)


DISK_FUNCTIONS = ("disk_free_permille", "disk_engine_path", "disk_low")


def fake_df(bin_dir: Path, pct_by_path: dict, default=50):
    """`df -Pk <path>` in formato POSIX, con lo spazio libero che decide il test."""
    lines = ['#!/bin/sh', 'for last; do :; done', 'case "$last" in']
    for path, pct in pct_by_path.items():
        lines.append(f'  "{path}"|"{path}"/*) pct={pct} ;;')
    lines.append(f'  *) pct={default} ;;')
    lines += ['esac',
              'total=1000000',
              'avail=$(( total * pct / 100 ))',
              'printf "Filesystem 1024-blocks Used Available Capacity Mounted on\\n"',
              'printf "/dev/fake %s %s %s 1%% /\\n" "$total" "$(( total - avail ))" "$avail"']
    (bin_dir / "df").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (bin_dir / "df").chmod(0o755)


def run_wrapper_functions(tmp_path, snippet, pct_by_path, env_extra=None, default=50):
    bin_dir = tmp_path / "wbin"
    bin_dir.mkdir(exist_ok=True)
    fake_df(bin_dir, pct_by_path, default)
    script = (
        "DISK_WARN_FREE_PERMILLE=100\nDISK_BLOCK_FREE_PERMILLE=30\nDISK_LOW_PERMILLE=\n"
        + "\n".join(wrapper_function(n) for n in DISK_FUNCTIONS)
        + "\n" + snippet
    )
    env = {**os.environ, "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}", "HOME": str(tmp_path / "h"),
           **(env_extra or {})}
    (tmp_path / "h").mkdir(exist_ok=True)
    env.pop("JHT_HOME_HOST", None)
    return subprocess.run(["bash", "-c", "set -euo pipefail\n" + script], env=env,
                          capture_output=True, text=True, timeout=30)


@pytest.mark.parametrize("pct,low", [(15, False), (8, False), (3, False), (2, True)])
def test_wrapper_disk_low_flags_only_under_three_percent(tmp_path, pct, low):
    done = run_wrapper_functions(
        tmp_path, 'if disk_low; then echo "LOW=$DISK_LOW_PERMILLE"; else echo OK; fi',
        {str(tmp_path / "h" / ".jht"): pct, str(tmp_path / "h"): pct})
    assert done.returncode == 0, done.stderr
    assert (done.stdout.strip().startswith("LOW=")) is low, done.stdout


def test_wrapper_measures_the_engine_volume_when_it_can_see_it(tmp_path):
    engine = tmp_path / "engine"
    engine.mkdir()
    done = run_wrapper_functions(
        tmp_path, 'if disk_low; then echo "LOW=$DISK_LOW_PERMILLE"; else echo OK; fi',
        {str(engine): 2}, env_extra={"JHT_ENGINE_DISK_PATH": str(engine)})
    assert done.stdout.strip() == "LOW=20"


def test_wrapper_does_not_reach_for_the_host_disk_when_the_engine_is_in_a_vm(tmp_path):
    done = run_wrapper_functions(tmp_path, 'disk_engine_path; echo "[$(uname -s)]"', {},
                                 env_extra={"JHT_ENGINE_DISK_PATH": ""})
    assert done.stdout.strip() == f"[{os.uname().sysname}]"


def test_wrapper_unreadable_df_does_not_refuse(tmp_path):
    bin_dir = tmp_path / "wbin"
    bin_dir.mkdir()
    (bin_dir / "df").write_text("#!/bin/sh\nexit 1\n", encoding="utf-8")
    (bin_dir / "df").chmod(0o755)
    script = (
        "set -euo pipefail\nDISK_BLOCK_FREE_PERMILLE=30\nDISK_LOW_PERMILLE=\n"
        + "\n".join(wrapper_function(n) for n in DISK_FUNCTIONS)
        + '\nif disk_low; then echo LOW; else echo OK; fi\n')
    done = subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=30,
                          env={**os.environ, "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}", "HOME": str(tmp_path),
                               "JHT_ENGINE_DISK_PATH": ""})
    assert done.stdout.strip() == "OK"


UPGRADE_STUBS = r'''
CALLS="$STATE/calls.log"
RUNTIME_DIR="$STATE/runtime"; mkdir -p "$RUNTIME_DIR"
COMPOSE_FILE="$STATE/compose.yml"; WRAPPER_PATH="$STATE/wrapper.sh"; RUNTIME_MANIFEST="$STATE/manifest"
RUNTIME_IMAGE_PIN="$STATE/no-pin"; CONTAINER_SERVICE=jht; PODMAN_RUNTIME_MODE=native
info() { :; }; err() { echo "ERR: $*" >&2; }
runtime_path_allowed() { return 0; }
runtime_node_safe() { return 0; }
upgrade_acquire_lock() { return 0; }
upgrade_cleanup_ephemeral() { :; }
upgrade_recover_if_needed() { return 0; }
runtime_bundle_trusted() { return 0; }
upgrade_docker_ready() { return 0; }
upgrade_compose_ready() { return 0; }
container_up() { return 0; }
upgrade_image() { echo sha256:old; }
upgrade_version() { echo 1.0.0; }
ensure_bind_owner() { echo ensure_bind_owner >> "$CALLS"; }
attested_raw_base() { echo attested >> "$CALLS"; return 1; }
curl() { echo "curl $*" >> "$CALLS"; return 1; }
docker() { echo "docker $*" >> "$CALLS"; return 1; }
upgrade_compose() { echo "compose $*" >> "$CALLS"; return 1; }
touch "$WRAPPER_PATH" "$COMPOSE_FILE" "$RUNTIME_MANIFEST"
'''


def run_upgrade(tmp_path, pct, args="--json", engine_pct=50):
    bin_dir = tmp_path / "ubin"
    bin_dir.mkdir(exist_ok=True)
    state = tmp_path / "ustate"
    state.mkdir(exist_ok=True)
    engine = tmp_path / "uengine"
    engine.mkdir(exist_ok=True)
    home = tmp_path / "uh"
    (home / ".jht").mkdir(parents=True, exist_ok=True)
    fake_df(bin_dir, {str(home / ".jht"): pct, str(home): pct, str(engine): engine_pct})
    script = (
        "set -euo pipefail\n"
        'STATE="$1"\n'
        "DISK_WARN_FREE_PERMILLE=100\nDISK_BLOCK_FREE_PERMILLE=30\nDISK_LOW_PERMILLE=\n"
        "UPGRADE_JSON=0\nUPGRADE_STAGE=\nUPGRADE_LOCK=\nUPGRADE_JOURNAL=\nUPGRADE_ROLLBACK_DIR=\nUPGRADE_PRUNE_JSON=\n"
        + UPGRADE_STUBS
        + "\n".join(wrapper_function(n) for n in DISK_FUNCTIONS + ("upgrade_safe_field", "upgrade_result", "handle_runtime_upgrade"))
        + f'\nset +e\nhandle_runtime_upgrade {args}\necho "rc=$?"\n'
    )
    env = {**os.environ, "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}", "HOME": str(home),
           "JHT_ENGINE_DISK_PATH": str(engine)}
    env.pop("JHT_HOME_HOST", None)
    done = subprocess.run(["bash", "-c", script, "bash", str(state)], env=env,
                          capture_output=True, text=True, timeout=30)
    calls = (state / "calls.log").read_text().splitlines() if (state / "calls.log").exists() else []
    return done, calls


@pytest.mark.parametrize("args", ["--json", "--apply --json", "--check --json"])
def test_at_2_percent_upgrade_is_refused_with_disk_low_before_downloading_anything(tmp_path, args):
    done, calls = run_upgrade(tmp_path, 2, args)
    assert "rc=1" in done.stdout, done.stdout + done.stderr
    result = json.loads(done.stdout.splitlines()[0])
    assert result["ok"] is False and result["changed"] is False
    assert result["phase"] == "preflight" and result["message"] == "disk_low"
    assert result["rolledBack"] is False and result["restartRequired"] is False
    # niente directory create, niente download, niente pull, niente stage
    assert calls == [], calls
    assert not list((tmp_path / "ustate" / "runtime").glob(".upgrade-stage*"))


def test_at_2_percent_the_plain_upgrade_says_disk_low_on_stderr(tmp_path):
    done, calls = run_upgrade(tmp_path, 2, "")
    assert "rc=1" in done.stdout
    assert "disk_low" in done.stderr
    assert calls == []


def test_the_engine_volume_below_three_percent_also_refuses_the_upgrade(tmp_path):
    done, calls = run_upgrade(tmp_path, 40, engine_pct=2)
    assert json.loads(done.stdout.splitlines()[0])["message"] == "disk_low"
    assert calls == []


@pytest.mark.parametrize("pct", [15, 8])
def test_at_15_and_8_percent_the_upgrade_goes_on_past_the_guard(tmp_path, pct):
    done, calls = run_upgrade(tmp_path, pct)
    assert "ensure_bind_owner" in calls, (done.stdout, done.stderr, calls)
    assert "disk_low" not in done.stdout + done.stderr


def test_the_running_runtime_is_not_touched_by_a_refused_upgrade(tmp_path):
    """Nessuno stop/recreate: solo letture prima della guardia, nessuna chiamata dopo."""
    done, calls = run_upgrade(tmp_path, 2)
    assert not any(call.startswith(("docker", "compose", "curl")) for call in calls)


def test_wrapper_guard_sits_before_the_first_thing_the_upgrade_writes_or_downloads():
    text = wrapper_function("handle_runtime_upgrade")
    guard = text.index("if disk_low; then")
    for later in ("ensure_bind_owner\n", 'UPGRADE_STAGE="$(mktemp', "curl -fsSL", "pull", "attested_raw_base"):
        assert guard < text.index(later, guard), later
    # recovery di un upgrade interrotto resta prima: ripristina, non avvia
    assert text.index("upgrade_recover_if_needed") < guard


def test_powershell_wrapper_has_the_same_guard_in_the_same_place():
    text = WRAPPER_PS1.read_text(encoding="utf-8")
    upgrade = text[text.index("function Invoke-RuntimeUpgrade"):]
    guard = upgrade.index("Get-DiskLowPermille")
    block = upgrade[guard: guard + 900]
    assert "if ($null -ne $diskLow) {" in block, "la guardia deve scattare su una misura, non su un'assenza"
    assert "'disk_low'" in block and block.index("'disk_low'") < block.index("return 1")
    assert guard < upgrade.index("$script:UpgradeStage = Join-Path")
    assert guard < upgrade.index("Invoke-WebRequest")
    assert guard < upgrade.index("'pull'")
    assert upgrade.index("Restore-UpgradePrevious") < guard
    assert "DriveInfo" in text and "JHT_ENGINE_DISK_PATH" in text


# ── le stesse soglie e gli stessi codici in ogni linguaggio ───────────────────


def test_thresholds_and_codes_are_the_same_in_python_js_bash_and_powershell():
    hv = load_vitals()
    js = GUARD_JS.read_text(encoding="utf-8")
    sh = WRAPPER_SH.read_text(encoding="utf-8")
    ps1 = WRAPPER_PS1.read_text(encoding="utf-8")
    warn, block = hv.DISK_WARN_FREE_PCT, hv.DISK_BLOCK_FREE_PCT
    assert re.search(rf"DISK_WARN_FREE_PCT = {warn:g};", js)
    assert re.search(rf"DISK_BLOCK_FREE_PCT = {block:g};", js)
    assert f"DISK_WARN_FREE_PERMILLE={int(warn * 10)}\n" in sh
    assert f"DISK_BLOCK_FREE_PERMILLE={int(block * 10)}\n" in sh
    assert f"$DiskWarnFreePermille = {int(warn * 10)}\n" in ps1
    assert f"$DiskBlockFreePermille = {int(block * 10)}\n" in ps1
    for code in (hv.DISK_CODE_WARNING, hv.DISK_CODE_LOW):
        assert f"'{code}'" in js
    assert 'message "disk_low"' in sh or '"disk_low" false' in sh
    assert (hv.DISK_CODE_WARNING, hv.DISK_CODE_LOW) == ("disk_warning", "disk_low")


def test_the_closed_codes_are_in_the_desktop_catalog_with_every_translation():
    catalog = CATALOG_TS.read_text(encoding="utf-8")
    locales = LOCALES_TS.read_text(encoding="utf-8")
    for code in ("disk_warning", "disk_low"):
        assert re.search(rf"^  {code}: copy\(", catalog, re.M), code
        assert re.search(rf"^  {code}: translated\(", locales, re.M), code
    # nessun emettitore Rust/TS oggi: il catalogo lo dichiara, non lo finge
    assert '"disk_warning",\n  "disk_low",\n]);' in catalog
    for english in ("Disk space is running low.",
                    "The disk is almost full, so no new agent or update will start."):
        block = locales[locales.index(f'"{english}": {{'):]
        block = block[: block.index("\n  },")]
        for lang in ("de", "es", "fr", "hu", "pt"):
            assert re.search(rf"^    {lang}: \[", block, re.M), (english, lang)


# ── la fixture che toglie il disco VERO dai test esistenti ────────────────────


@pytest.mark.parametrize("pct,guard_rc", [(50, 0), (2, 3)])
def test_healthy_disk_fixture_pins_all_three_channels_to_the_fake_value(healthy_disk, tmp_path, pct, guard_rc):
    """launcher (statvfs), wrapper (df) e CLI Node (statfs) leggono il valore finto, non la macchina."""
    healthy_disk(pct)
    env = {**os.environ, "JHT_HOME": str(tmp_path), "JHT_ENGINE_DISK_PATH": "", "JHT_LANG": "en"}
    guard = subprocess.run(["python3", str(VITALS), "disk-guard"], env=env, capture_output=True, text=True, timeout=30)
    assert guard.returncode == guard_rc, guard.stderr

    df = subprocess.run(["df", "-Pk", str(tmp_path)], env=env, capture_output=True, text=True, timeout=30)
    total, avail = df.stdout.splitlines()[1].split()[1:4:2]
    assert int(avail) * 100 // int(total) == pct

    node = shutil.which("node")
    if node:
        probe = subprocess.run(
            [node, "-e",
             "const s=require('node:fs').statfsSync('/'); console.log(Math.floor(s.bavail*100/s.blocks))"],
            env=env, capture_output=True, text=True, timeout=30)
        assert probe.stdout.strip() == str(pct), probe.stderr
