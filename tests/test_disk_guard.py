"""Disco quasi pieno: avviso sotto il 10% E 20 GiB, nessun NUOVO avvio sotto il 3% E 8 GiB.

Il disco pieno non era sorvegliato: jobs.db smette di scrivere, la squadra si
pianta senza un errore chiaro, e un avvio che muore a meta' ha gia' speso token.
Questa suite tiene fermo, con `statvfs` FINTO (mai un disco vero):

- 15% libero: non succede niente (nessun avviso, nessun rifiuto);
- 8%: avviso all'utente, con la frase della tabella codice->frase, e si parte;
- 2%: spawn, `jht team start` e `jht upgrade` rifiutano con `disk_low`, e
  l'agente gia' in corso non viene toccato (la guardia sta DOPO la sonda di
  idempotenza);
- la soglia e' combinata (percentuale E byte): un disco da 500 GiB con 14 GiB liberi
  (2,8%) non rifiuta piu' (prima si), e gli stessi casi limite danno lo stesso livello in Python, JS e bash;
- soglie e codici sono gli stessi in Python, JavaScript e bash; PowerShell non
  ha ancora i byte (vedi il test che lo dichiara);
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
        best, value = "", _spec.get("default", 50)
        for prefix, v in _spec.get("paths", {}).items():
            inside = p == prefix or p.startswith(prefix.rstrip("/") + "/")
            if inside and len(prefix) >= len(best):
                best, value = prefix, v
        if isinstance(value, dict):  # disco di capienza decisa: {"total_kib": n, "free_kib": n}
            total, free = value["total_kib"] // 4, value["free_kib"] // 4
        else:
            total = 1_000_000
            free = int(total * value / 100)
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
        best, value = "", default
        for prefix, v in by_prefix.items():
            if (p == prefix or p.startswith(prefix.rstrip("/") + "/")) and len(prefix) >= len(best):
                best, value = prefix, v
        if isinstance(value, dict):
            total, free = value["total_kib"] // 4, value["free_kib"] // 4
        else:
            total = 1_000_000
            free = int(total * value / 100)
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


GIB_KIB = 1024 * 1024  # una GiB, in KiB: l'unita' di `df -Pk` e dei dischi finti
MIB_KIB = 1024


def disk(total_gib, free_kib):
    """Un disco finto di capienza decisa: `total_gib` GiB con `free_kib` KiB liberi."""
    return {"total_kib": total_gib * GIB_KIB, "free_kib": free_kib}


# (nome, totale GiB, libero KiB, livello DOPO). La stessa tabella gira su Python, JS e bash.
# Soglie: rifiuto se libero < 3% E < 8 GiB; avviso se libero < 10% E < 20 GiB.
# Entrambi i confronti sono STRETTI (<): esattamente il 3% o esattamente 8 GiB
# NON rifiutano. Prima del T19 contava la sola percentuale: i casi marcati
# «PRIMA rifiutava» (o avvisava) sono quelli che cambiano, e sul codice di prima
# questi test sono rossi.
LEVEL_CASES = [
    # 14 GiB su 500 GiB = 2,8%: PRIMA rifiutava, DOPO no
    ("500G-14G-free-2.8pct-was-refused-now-warns", 500, 14 * GIB_KIB, "warn"),
    # bordo del 3%: 15 GiB su 500 GiB e' esattamente il 3% (< stretto: non rifiuta)
    ("500G-15G-free-exactly-3pct-not-refused", 500, 15 * GIB_KIB, "warn"),
    ("500G-15G-less-1KiB-just-under-3pct-8G-or-more-not-refused", 500, 15 * GIB_KIB - 1, "warn"),
    # bordo degli 8 GiB: esattamente 8 GiB (1,6%) non rifiuta, un KiB in meno si
    ("500G-exactly-8G-free-not-refused", 500, 8 * GIB_KIB, "warn"),
    ("500G-8G-less-1KiB-free-refused", 500, 8 * GIB_KIB - 1, "low"),
    ("500G-7G-free-refused", 500, 7 * GIB_KIB, "low"),
    # 4 GiB su 200 GiB = 2%: rifiuta, prima e dopo
    ("200G-4G-free-2pct-refused-before-and-after", 200, 4 * GIB_KIB, "low"),
    # 3% esatto di un disco piccolo: 6 GiB su 200 GiB (6 GiB < 8 GiB ma il 3% non e' < 3%)
    ("200G-6G-free-exactly-3pct-not-refused", 200, 6 * GIB_KIB, "warn"),
    ("200G-6G-less-1KiB-free-refused", 200, 6 * GIB_KIB - 1, "low"),
    # soglia di avviso: 20 GiB e 10%
    ("500G-20G-free-4pct-was-warned-now-fine", 500, 20 * GIB_KIB, "ok"),
    ("500G-20G-less-1KiB-free-warns", 500, 20 * GIB_KIB - 1, "warn"),
    ("500G-49G-free-9.8pct-was-warned-now-fine", 500, 49 * GIB_KIB, "ok"),
    ("100G-exactly-10pct-fine", 100, 10 * GIB_KIB, "ok"),
    ("100G-10pct-less-1KiB-warns", 100, 10 * GIB_KIB - 1, "warn"),
    ("100G-30G-free-fine", 100, 30 * GIB_KIB, "ok"),
    # dischi piccoli: sotto 8 GiB / 20 GiB conta la sola percentuale, come prima
    ("small-4G-disk-at-2pct-refused", 4, 82 * MIB_KIB, "low"),
    ("small-4G-disk-at-8pct-warns", 4, 328 * MIB_KIB, "warn"),
    ("small-4G-disk-at-15pct-fine", 4, 614 * MIB_KIB, "ok"),
]
LEVEL_IDS = [c[0] for c in LEVEL_CASES]


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


def test_combined_threshold_numbers():
    hv = load_vitals()
    assert (hv.DISK_WARN_FREE_PCT, hv.DISK_WARN_FREE_BYTES) == (10.0, 20 * 1024**3)
    assert (hv.DISK_BLOCK_FREE_PCT, hv.DISK_BLOCK_FREE_BYTES) == (3.0, 8 * 1024**3)


@pytest.mark.parametrize("name,total_gib,free_kib,level", LEVEL_CASES, ids=LEVEL_IDS)
def test_level_needs_both_the_percent_and_the_bytes(monkeypatch, volumes, name, total_gib, free_kib, level):
    _, result = disk_at(monkeypatch, volumes, disk(total_gib, free_kib), 50)
    assert result["level"] == level, (name, result)
    assert result["code"] == {"low": "disk_low", "warn": "disk_warning", "ok": None}[level]


def test_a_big_volume_below_three_percent_does_not_hide_a_warning_on_the_other(monkeypatch, volumes):
    """Il peggiore e' per gravita': 2% di un disco enorme (ok) non copre un `warn` accanto."""
    _, result = disk_at(monkeypatch, volumes, disk(10000, 200 * GIB_KIB), disk(100, 5 * GIB_KIB))
    assert result["jht_home"]["level"] == "ok" and result["engine"]["level"] == "warn"
    assert (result["level"], result["code"]) == ("warn", "disk_warning")
    assert result["min_free_pct"] == result["engine"]["free_pct"] == 5.0


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
        assert "Docker/Podman" in table["disk.low"], lang  # come liberare spazio, in ogni lingua


@pytest.mark.parametrize("lang", LANGS)
def test_only_the_cli_phrase_names_the_terminal_command(lang):
    # L'app e il launcher usano `disk.low`: l'utente dell'app non usa il terminale.
    # La CLI e il wrapper (`disk.low.cli`) dicono anche `jht clean-images`.
    table = json.loads((LOCALES / f"{lang}.json").read_text(encoding="utf-8"))
    assert table["disk.low.cli"].count("%s") == 1 and len(table["disk.low.cli"]) > 40
    assert "`jht clean-images`" in table["disk.low.cli"]
    assert "jht " not in table["disk.low"] and "clean-images" not in table["disk.low"]


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


@pytest.mark.parametrize("name,total_gib,free_kib,level", LEVEL_CASES, ids=LEVEL_IDS)
def test_disk_guard_command_refuses_only_when_percent_and_bytes_are_both_low(
        fakedir, volumes, name, total_gib, free_kib, level):
    home, engine = volumes
    done = run_vitals(fakedir, home, engine, disk(total_gib, free_kib), 50, "disk-guard")
    assert done.returncode == (3 if level == "low" else 0), (name, done.stderr)
    if level == "low":
        # la riga che il launcher mostra: codice chiuso + la frase della tabella, con l'indicazione
        assert done.stderr.startswith("disk_low: ")
        assert "Trash" in done.stderr and "Docker/Podman" in done.stderr, done.stderr
    else:
        assert done.stderr == ""


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
    assert "tf('disk.low.cli'" in guard
    assert "wizard/i18n.js" in guard


# ── (c) jht upgrade (wrapper) ─────────────────────────────────────────────────


def wrapper_function(name: str) -> str:
    text = WRAPPER_SH.read_text(encoding="utf-8")
    match = re.search(rf"^{name}\(\) \{{\n.*?^\}}\n", text, re.S | re.M)
    assert match, name
    return match.group(0)


def _disk_functions():
    """Le funzioni disco che il wrapper ha: la misura (si chiamava disk_free_permille
    prima del T19) e `disk_level_of`, che prima non c'era."""
    text = WRAPPER_SH.read_text(encoding="utf-8")
    names = ("disk_free_permille", "disk_free_measure", "disk_engine_path", "disk_level_of", "disk_low")
    return tuple(n for n in names if re.search(rf"^{n}\(\) \{{", text, re.M))


DISK_FUNCTIONS = _disk_functions()


def wrapper_disk_constants() -> str:
    """Le assegnazioni DISK_* del wrapper vero: un numero cambiato la' cambia anche qui."""
    text = WRAPPER_SH.read_text(encoding="utf-8")
    lines = re.findall(r"^DISK_[A-Z_]+=.*$", text, re.M)
    assert len(lines) >= 3, lines
    return "\n".join(lines) + "\n"


def fake_df(bin_dir: Path, pct_by_path: dict, default=50):
    """`df -Pk <path>` in formato POSIX, con lo spazio libero che decide il test.

    Il valore e' una percentuale (disco da 1.000.000 KiB) oppure `disk(...)`:
    capienza e KiB liberi decisi dal test.
    """
    def spec(value):
        if isinstance(value, dict):
            return f'total={value["total_kib"]}; avail={value["free_kib"]}'
        return f'total=1000000; avail=$(( total * {value} / 100 ))'

    lines = ['#!/bin/sh', 'for last; do :; done', 'case "$last" in']
    for path, value in pct_by_path.items():
        lines.append(f'  "{path}"|"{path}"/*) {spec(value)} ;;')
    lines.append(f'  *) {spec(default)} ;;')
    lines += ['esac',
              'printf "Filesystem 1024-blocks Used Available Capacity Mounted on\\n"',
              'printf "/dev/fake %s %s %s 1%% /\\n" "$total" "$(( total - avail ))" "$avail"']
    (bin_dir / "df").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (bin_dir / "df").chmod(0o755)


def run_wrapper_functions(tmp_path, snippet, pct_by_path, env_extra=None, default=50):
    bin_dir = tmp_path / "wbin"
    bin_dir.mkdir(exist_ok=True)
    fake_df(bin_dir, pct_by_path, default)
    script = (
        wrapper_disk_constants()
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
def test_wrapper_disk_low_flags_only_under_three_percent_on_a_small_disk(tmp_path, pct, low):
    done = run_wrapper_functions(
        tmp_path, 'if disk_low; then echo "LOW=$DISK_LOW_PERMILLE"; else echo OK; fi',
        {str(tmp_path / "h" / ".jht"): pct, str(tmp_path / "h"): pct})
    assert done.returncode == 0, done.stderr
    assert (done.stdout.strip().startswith("LOW=")) is low, done.stdout


@pytest.mark.parametrize("name,total_gib,free_kib,level", LEVEL_CASES, ids=LEVEL_IDS)
def test_wrapper_level_needs_both_the_percent_and_the_bytes(tmp_path, name, total_gib, free_kib, level):
    home = tmp_path / "h" / ".jht"
    done = run_wrapper_functions(
        tmp_path,
        'if disk_low; then echo LOW; else echo OK; fi',
        {str(home): disk(total_gib, free_kib), str(tmp_path / "h"): disk(total_gib, free_kib)})
    assert done.returncode == 0, done.stderr
    assert done.stdout.split() == ["LOW" if level == "low" else "OK"], (name, done.stdout)


@pytest.mark.parametrize("name,total_gib,free_kib,level", LEVEL_CASES, ids=LEVEL_IDS)
def test_wrapper_disk_level_of_gives_the_three_levels(tmp_path, name, total_gib, free_kib, level):
    home = tmp_path / "h" / ".jht"
    spec = disk(total_gib, free_kib)
    done = run_wrapper_functions(
        tmp_path, 'read -r pm kib <<<"$(disk_free_measure "$HOME/.jht")"; disk_level_of "$pm" "$kib"',
        {str(home): spec, str(tmp_path / "h"): spec})
    assert done.returncode == 0, done.stderr
    assert done.stdout.strip() == level, (name, done.stdout)


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
        "set -euo pipefail\n" + wrapper_disk_constants()
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
        + wrapper_disk_constants()
        + "UPGRADE_JSON=0\nUPGRADE_STAGE=\nUPGRADE_LOCK=\nUPGRADE_JOURNAL=\nUPGRADE_ROLLBACK_DIR=\nUPGRADE_PRUNE_JSON=\n"
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
    # l'upgrade resta rifiutato e la pulizia che gira a upgrade riuscito non parte:
    # il rifiuto indica la via per liberare spazio, `jht clean-images` (comando separato)
    assert "jht clean-images" in done.stderr and "Cestino" in done.stderr, done.stderr
    assert "8 GiB" in done.stderr
    assert calls == []


def test_the_refused_upgrade_never_prunes_images(tmp_path):
    done, calls = run_upgrade(tmp_path, 2)
    assert calls == []  # nessun `docker image rm`, nessuna `docker` di alcun tipo
    assert "imagePrune" not in done.stdout


@pytest.mark.parametrize("name,total_gib,free_kib,level", LEVEL_CASES, ids=LEVEL_IDS)
def test_upgrade_is_refused_only_when_percent_and_bytes_are_both_low(tmp_path, name, total_gib, free_kib, level):
    """500 GiB con 14 GiB liberi (2,8%) passa la guardia; 200 GiB con 4 GiB liberi (2%) no."""
    done, calls = run_upgrade(tmp_path, disk(total_gib, free_kib))
    if level == "low":
        assert json.loads(done.stdout.splitlines()[0])["message"] == "disk_low", (name, done.stdout)
        assert calls == []
    else:
        assert "ensure_bind_owner" in calls, (name, done.stdout, done.stderr, calls)
        assert "disk_low" not in done.stdout + done.stderr


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


# ── la pulizia delle immagini non cambia: stesse protezioni, solo un motore FINTO ─
#
# Il T19 non tocca `upgrade_prune_old_images`: sotto la soglia non gira (il
# rifiuto ha la sua frase) e sopra resta quella di prima. Qui si fa girare la
# funzione VERA contro un `docker` finto (una funzione di shell che registra le
# chiamate): nessun motore reale, nessun volume.

PRUNE_FUNCTIONS = ("upgrade_image_plain", "upgrade_repo_is_jht", "upgrade_foreign_image_ids",
                   "upgrade_prune_result", "upgrade_prune_old_images")

FAKE_ENGINE = r'''
CALLS="$STATE/engine.log"
upgrade_image() { echo "sha256:cur"; }
upgrade_note() { echo "NOTE $*" >> "$STATE/notes.log"; }
docker() {
  echo "$*" >> "$CALLS"
  case "$1 $2" in
    "container ls") [ "${ENGINE_UNREADABLE:-0}" = 1 ] && return 1; printf 'c1\nc2\n' ;;
    "image ls") cat <<LIST
sha256:cur ghcr.io/leopu00/jht
sha256:prev ghcr.io/leopu00/jht
sha256:busy jht
sha256:old1 ghcr.io/leopu00/jht
sha256:old2 localhost/jht
sha256:alien ghcr.io/leopu00/jht-altro
sha256:pg postgres
LIST
      ;;
    "image inspect") echo 1048576 ;;
    "image rm") return 0 ;;
    *) if [ "$1" = inspect ]; then printf 'sha256:cur\nsha256:busy\n'; fi ;;
  esac
}
'''


def run_prune(tmp_path, env_extra=None, current="sha256:cur", previous="sha256:prev"):
    state = tmp_path / "pstate"
    state.mkdir(exist_ok=True)
    text = WRAPPER_SH.read_text(encoding="utf-8")
    repos = re.search(r"^JHT_IMAGE_REPOSITORIES=.*$", text, re.M).group(0)
    script = (
        'STATE="$1"\n' + repos + "\nUPGRADE_PRUNE_JSON=\n" + FAKE_ENGINE
        + "\n".join(wrapper_function(n) for n in PRUNE_FUNCTIONS)
        + f'\nupgrade_prune_old_images "{current}" "{previous}"\n'
    )
    done = subprocess.run(["bash", "-c", script, "bash", str(state)], capture_output=True, text=True,
                          env={**os.environ, **(env_extra or {})}, timeout=30)
    log = state / "engine.log"
    return done, (log.read_text().splitlines() if log.exists() else [])


def test_prune_still_removes_only_old_exact_jht_images_by_id(tmp_path):
    done, calls = run_prune(tmp_path)
    assert done.returncode == 0, done.stderr
    removed = [c.split()[-1] for c in calls if c.startswith("image rm")]
    # solo le due vecchie, ognuna per ID: la corrente, la precedente, quella di un
    # container (anche fermo), un altro repository e un'immagine estranea restano
    assert removed == ["sha256:old1", "sha256:old2"], calls
    assert all(c == f"image rm {i}" for c, i in zip([c for c in calls if c.startswith("image rm")], removed)), calls


def test_prune_never_touches_volumes_and_never_forces_or_prunes(tmp_path):
    _, calls = run_prune(tmp_path)
    joined = "\n".join(calls)
    for forbidden in ("volume", "prune", " -f", "--force", "system", "container rm", "container stop", "kill", "rmi"):
        assert forbidden not in joined, (forbidden, calls)
    assert {c.split()[0] + " " + c.split()[1] for c in calls} <= {
        "container ls", "inspect --format", "image ls", "image inspect", "image rm"}, calls


def test_prune_removes_nothing_when_the_containers_cannot_be_read(tmp_path):
    _, calls = run_prune(tmp_path, {"ENGINE_UNREADABLE": "1"})
    assert not any(c.startswith("image rm") for c in calls), calls


def test_prune_removes_nothing_when_the_current_image_is_not_the_running_one(tmp_path):
    _, calls = run_prune(tmp_path, current="sha256:someone-else")
    assert not any(c.startswith("image rm") for c in calls), calls


def test_prune_opt_out_keeps_every_image(tmp_path):
    _, calls = run_prune(tmp_path, {"JHT_KEEP_OLD_IMAGES": "1"})
    assert calls == []


def test_prune_runs_only_after_a_successful_upgrade_never_in_the_refused_path():
    text = wrapper_function("handle_runtime_upgrade")
    assert text.count("upgrade_prune_old_images") == 1
    assert text.index("if disk_low; then") < text.index("upgrade_prune_old_images")
    refusal = text[text.index("if disk_low; then"):]
    refusal = refusal[: refusal.index("\n  fi\n")]
    assert "upgrade_prune_old_images" not in refusal and "docker" not in refusal


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


def test_thresholds_and_codes_are_the_same_in_python_js_and_bash():
    hv = load_vitals()
    js = GUARD_JS.read_text(encoding="utf-8")
    sh = WRAPPER_SH.read_text(encoding="utf-8")
    warn, block = hv.DISK_WARN_FREE_PCT, hv.DISK_BLOCK_FREE_PCT
    warn_gib, block_gib = hv.DISK_WARN_FREE_BYTES // 1024**3, hv.DISK_BLOCK_FREE_BYTES // 1024**3
    assert (warn, warn_gib, block, block_gib) == (10.0, 20, 3.0, 8)
    assert hv.DISK_WARN_FREE_BYTES == warn_gib * 1024**3 and hv.DISK_BLOCK_FREE_BYTES == block_gib * 1024**3
    assert re.search(rf"DISK_WARN_FREE_PCT = {warn:g};", js)
    assert re.search(rf"DISK_BLOCK_FREE_PCT = {block:g};", js)
    assert re.search(rf"DISK_WARN_FREE_BYTES = {warn_gib} \* GIB;", js)
    assert re.search(rf"DISK_BLOCK_FREE_BYTES = {block_gib} \* GIB;", js)
    assert "const GIB = 1024 ** 3;" in js
    assert f"DISK_WARN_FREE_PERMILLE={int(warn * 10)}\n" in sh
    assert f"DISK_BLOCK_FREE_PERMILLE={int(block * 10)}\n" in sh
    assert f"DISK_WARN_FREE_KIB={warn_gib * 1024 * 1024}\n" in sh
    assert f"DISK_BLOCK_FREE_KIB={block_gib * 1024 * 1024}\n" in sh
    for code in (hv.DISK_CODE_WARNING, hv.DISK_CODE_LOW):
        assert f"'{code}'" in js
    assert 'message "disk_low"' in sh or '"disk_low" false' in sh
    assert (hv.DISK_CODE_WARNING, hv.DISK_CODE_LOW) == ("disk_warning", "disk_low")


def ps1_constants() -> dict:
    ps1 = WRAPPER_PS1.read_text(encoding="utf-8")
    values = dict(re.findall(r"^\$(Disk(?:Warn|Block)Free(?:Permille|Kib)) = (\d+)$", ps1, re.M))
    assert set(values) == {"DiskWarnFreePermille", "DiskWarnFreeKib", "DiskBlockFreePermille", "DiskBlockFreeKib"}, values
    return {k: int(v) for k, v in values.items()}


def ps1_level(free_bytes: int, total_bytes: int) -> str:
    """Esegue in Python le DUE condizioni di `Get-DiskLevelOf` del ps1, lette come testo.

    Il ps1 non si puo' eseguire qui (niente pwsh): si traducono gli operatori
    (-lt -> <, -and -> and, [long] tolto) e si valuta la stessa riga sugli
    stessi casi di Python, JS e bash. Un confronto cambiato nel ps1 cambia
    l'esito qui.
    """
    ps1 = WRAPPER_PS1.read_text(encoding="utf-8")
    body = ps1[ps1.index("function Get-DiskLevelOf"):]
    body = body[: body.index("\n}\n")]
    names = {**ps1_constants(), "Free": free_bytes, "Total": total_bytes}
    for condition, level in re.findall(r"if \((.*)\) \{ return '(\w+)' \}", body):
        expr = condition.replace("[long]", "").replace("-lt", "<").replace("-and", " and ")
        expr = re.sub(r"\$(\w+)", lambda m: f"names[{m.group(1)!r}]", expr)
        assert re.fullmatch(r"[\w\s\[\]'()*<>]+", expr), expr
        if eval(expr, {"__builtins__": {}}, {"names": names}):  # noqa: S307 - testo del nostro file
            return level
    return "ok"


def test_powershell_wrapper_has_the_same_combined_thresholds_as_the_other_three():
    """Il ps1 qui non gira: il confronto e' sul TESTO (costanti uguali, stesse condizioni).
    Niente parita' Windows dichiarata: il bundle NSIS verde non prova questo."""
    hv = load_vitals()
    values = ps1_constants()
    assert values["DiskWarnFreePermille"] == int(hv.DISK_WARN_FREE_PCT * 10)
    assert values["DiskBlockFreePermille"] == int(hv.DISK_BLOCK_FREE_PCT * 10)
    assert values["DiskWarnFreeKib"] == hv.DISK_WARN_FREE_BYTES // 1024
    assert values["DiskBlockFreeKib"] == hv.DISK_BLOCK_FREE_BYTES // 1024
    sh = WRAPPER_SH.read_text(encoding="utf-8")
    assert f"DISK_WARN_FREE_KIB={values['DiskWarnFreeKib']}\n" in sh
    assert f"DISK_BLOCK_FREE_KIB={values['DiskBlockFreeKib']}\n" in sh
    ps1 = WRAPPER_PS1.read_text(encoding="utf-8")
    level = ps1[ps1.index("function Get-DiskLevelOf"):]
    level = level[: level.index("\n}\n")]
    assert "-le" not in level and "-ge" not in level and "-or" not in level, "confronti stretti, e percentuale E byte"
    assert level.count("-and") == 2 and level.count("-lt") == 4
    assert "[Math]::Floor" not in level, "la decisione e' in interi, senza virgola mobile"


@pytest.mark.parametrize("name,total_gib,free_kib,expected", LEVEL_CASES, ids=LEVEL_IDS)
def test_powershell_conditions_give_the_same_level_on_the_same_cases(name, total_gib, free_kib, expected):
    assert ps1_level(free_kib * 1024, total_gib * GIB_KIB * 1024) == expected


def test_powershell_refuses_only_on_a_measure_that_says_low_and_says_so_in_the_message():
    ps1 = WRAPPER_PS1.read_text(encoding="utf-8")
    low = ps1[ps1.index("function Get-DiskLowPermille"):]
    low = low[: low.index("\n}\n")]
    assert "Get-DiskLevelOf" in low and "-eq 'low'" in low and "return $null" in low
    assert "meno di 8 GiB" in ps1[ps1.index("disk_low: meno del 3%"):][:200]
    # il commento che diceva «stesse soglie» quando non lo erano non c'e' piu'
    assert "NON E' MAI STATO ESEGUITO" in ps1


@pytest.mark.skipif(not shutil.which("node"), reason="node non c'e'")
@pytest.mark.parametrize("name,total_gib,free_kib,level", LEVEL_CASES, ids=LEVEL_IDS)
def test_js_gives_the_same_level_on_the_same_cases(name, total_gib, free_kib, level):
    script = (
        f"import {{ volumeState }} from {GUARD_JS.as_uri()!r};\n"
        f"const st = {{ bsize: 1024, blocks: {total_gib * GIB_KIB}, bavail: {free_kib} }};\n"
        "console.log(volumeState('/x', { statfs: () => st, exists: () => true }).level);\n"
    )
    env = {**os.environ, "JHT_LANG": "en"}
    env.pop("NODE_OPTIONS", None)
    done = subprocess.run([shutil.which("node"), "--input-type=module", "-e", script],
                          env=env, capture_output=True, text=True, timeout=30)
    assert done.stdout.strip() == level, (name, done.stdout, done.stderr)


def test_the_closed_codes_are_in_the_desktop_catalog_with_every_translation():
    catalog = CATALOG_TS.read_text(encoding="utf-8")
    locales = LOCALES_TS.read_text(encoding="utf-8")
    for code in ("disk_warning", "disk_low"):
        assert re.search(rf"^  {code}: copy\(", catalog, re.M), code
        assert re.search(rf"^  {code}: translated\(", locales, re.M), code
    # `disk_low` dice come liberare spazio, in tutte e sette le lingue
    low = catalog[catalog.index("  disk_low: copy("):]
    low = low[: low.index("\n  ),")]
    assert "Cestino" in low and "Docker/Podman" in low and "Trash" in low
    english = "The disk is almost full, so no new agent or update will start."
    block = locales[locales.index(f'"{english}": {{'):]
    block = block[: block.index("\n  },")]
    for lang, word in (("de", "Papierkorb"), ("es", "papelera"), ("fr", "corbeille"), ("hu", "Kuká"), ("pt", "Lixo")):
        row = next(line for line in block.splitlines() if line.strip().startswith(f"{lang}:"))
        assert word in row and "Docker/Podman" in row, (lang, row)
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
