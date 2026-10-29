"""The seven callers of `jht-tmux-send` carry ONE bootstrap and each its own wait; nothing else changed.

The callers are stand-alone scripts, so the finding of `tmux_send_run.py` (and the fallback to the old call) is a text
that every one of them carries: `shared/skills/tmux_send_run_bootstrap.txt`, kept in the callers by
`scripts/sync_tmux_send_bootstrap.py`. These tests keep the three things a refactor of that kind could change:
the text is the same everywhere, each caller has the ceiling it had, and each caller still asks for the output
(text or bytes) it asked for. The deadline behaviour itself is `tests/test_transport_callers_not_killed.py`.
"""
import importlib.util
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import sync_tmux_send_bootstrap as sync  # noqa: E402

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="the bridges run in the Linux container")

# (name, file, own variable, ceiling it had before the variables were named, text it asks the transport for)
CALLERS = [
    ("pacing", ".launcher/pacing-bridge.py", "JHT_TMUX_SEND_WAIT_PACING_S", 30.0, True),
    ("heartbeat", ".launcher/heartbeat-bridge.py", "JHT_TMUX_SEND_WAIT_HEARTBEAT_S", 90.0, True),
    ("stepcap", ".launcher/stepcap-watchdog.py", "JHT_TMUX_SEND_WAIT_STEPCAP_S", 120.0, True),
    ("throttle", "shared/skills/throttle_engine.py", "JHT_TMUX_SEND_WAIT_THROTTLE_S", 120.0, True),
    ("standby", "shared/skills/standby.py", "JHT_TMUX_SEND_WAIT_STANDBY_S", 15.0, False),
    ("soft-pause", "shared/skills/soft_pause_team.py", "JHT_TMUX_SEND_WAIT_SOFT_PAUSE_S", 15.0, False),
    ("application-answers", "shared/skills/application_answers.py", "JHT_TMUX_SEND_WAIT_APPLICATION_ANSWERS_S", 20.0, True),
]
IDS = [c[0] for c in CALLERS]
SENTINEL = (".launcher/sentinel-bridge.py", "JHT_TMUX_SEND_WAIT_SENTINEL_S", 15.0)
ALL_VARIABLES = [c[2] for c in CALLERS] + [SENTINEL[1], "JHT_TMUX_SEND_WAIT_S"]

SEND = {
    "pacing": lambda m: m.send_to_capitano("avviso"),
    "heartbeat": lambda m: m._send("avviso"),
    "stepcap": lambda m: m.notify_captain("avviso"),
    "throttle": lambda m: m.notify_captain("avviso"),
    "standby": lambda m: m._send("CAPITANO", "avviso"),
    "soft-pause": lambda m: m.send_message("CAPITANO", "avviso"),
    "application-answers": lambda m: m._tmux_send("CAPITANO", "avviso"),
}


def _load(relative, home):
    path = ROOT / relative
    spec = importlib.util.spec_from_file_location("bootstrap_parity_" + path.stem.replace("-", "_"), path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture()
def clean_env(tmp_path, monkeypatch):
    for name in ALL_VARIABLES:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("JHT_HOME", str(tmp_path / "home"))
    (tmp_path / "home" / "logs").mkdir(parents=True)
    monkeypatch.setenv("PYTHONDONTWRITEBYTECODE", "1")
    return tmp_path


# -- one text -------------------------------------------------------------------------------------------------------

def test_every_caller_carries_the_same_bootstrap_as_the_source():
    assert sync.differing() == []


def test_the_check_names_the_callers_that_drift_and_the_sync_puts_them_back(tmp_path):
    for name in [c[1] for c in CALLERS] + ["shared/skills/tmux_send_run_bootstrap.txt"]:
        (tmp_path / name).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(ROOT / name, tmp_path / name)
    assert sync.differing(tmp_path) == []
    drifted = tmp_path / "shared/skills/standby.py"
    drifted.write_text(drifted.read_text(encoding="utf-8").replace("here.parent / \"shared\"", "here / \"shared\""), encoding="utf-8")
    missing = tmp_path / ".launcher/heartbeat-bridge.py"
    missing.write_text(missing.read_text(encoding="utf-8").replace("# <<< tmux_send_run bootstrap", "# end"), encoding="utf-8")
    assert sync.differing(tmp_path) == [".launcher/heartbeat-bridge.py", "shared/skills/standby.py"]
    # a caller whose block is gone cannot be written: said, not guessed
    with pytest.raises(ValueError):
        sync.sync(tmp_path)
    missing.write_text(missing.read_text(encoding="utf-8").replace("# end", "# <<< tmux_send_run bootstrap"), encoding="utf-8")
    assert sync.sync(tmp_path) == ["shared/skills/standby.py"]
    assert sync.differing(tmp_path) == []


def test_the_script_check_exits_zero_on_the_repo():
    done = subprocess.run([sys.executable, str(ROOT / "scripts/sync_tmux_send_bootstrap.py"), "--check"],
                          capture_output=True, text=True, timeout=30)
    assert done.returncode == 0, done.stdout


# -- the ceilings ---------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("name, relative, variable, ceiling, _text", CALLERS, ids=IDS)
def test_each_caller_has_the_ceiling_it_had(clean_env, name, relative, variable, ceiling, _text):
    assert _load(relative, clean_env).TMUX_SEND_WAIT_S == ceiling


def test_the_sentinel_has_the_ceiling_it_had(clean_env):
    assert _load(SENTINEL[0], clean_env).TMUX_SEND_WAIT_S == SENTINEL[2]


def test_the_throttle_engines_wake_keeps_its_own_longer_wait(clean_env):
    assert _load("shared/skills/throttle_engine.py", clean_env).NOTIFY_TIMEOUT_SEC == 240.0


@pytest.mark.parametrize("name, relative, variable, ceiling, _text", CALLERS, ids=IDS)
def test_a_callers_own_variable_sets_that_caller_and_no_other(clean_env, monkeypatch, name, relative, variable, ceiling, _text):
    monkeypatch.setenv(variable, "7")
    assert _load(relative, clean_env).TMUX_SEND_WAIT_S == 7.0
    for other_name, other_file, _v, other_ceiling, _t in CALLERS:
        if other_name != name:
            assert _load(other_file, clean_env).TMUX_SEND_WAIT_S == other_ceiling, other_name
    assert _load(SENTINEL[0], clean_env).TMUX_SEND_WAIT_S == SENTINEL[2]


def test_the_sentinels_own_variable_sets_the_sentinel_and_no_other(clean_env, monkeypatch):
    monkeypatch.setenv(SENTINEL[1], "7")
    assert _load(SENTINEL[0], clean_env).TMUX_SEND_WAIT_S == 7.0
    for _n, relative, _v, ceiling, _t in CALLERS:
        assert _load(relative, clean_env).TMUX_SEND_WAIT_S == ceiling


@pytest.mark.parametrize("name, relative, variable, ceiling, _text", CALLERS, ids=IDS)
def test_the_old_shared_variable_still_sets_a_caller_without_its_own_and_loses_to_its_own(clean_env, monkeypatch, name, relative, variable, ceiling, _text):
    monkeypatch.setenv("JHT_TMUX_SEND_WAIT_S", "9")
    assert _load(relative, clean_env).TMUX_SEND_WAIT_S == 9.0
    monkeypatch.setenv(variable, "4")
    assert _load(relative, clean_env).TMUX_SEND_WAIT_S == 4.0


# -- the output each caller asks for ----------------------------------------------------------------------------------

class _Helper:
    """What `tmux_send_run` is to a caller: it records what it is asked for."""

    def __init__(self):
        self.asked = []

    def run(self, args, timeout, text=False):
        self.asked.append((list(args)[1:], timeout, text))
        return subprocess.CompletedProcess(args, 0, "" if text else b"", "" if text else b"")


@pytest.mark.parametrize("name, relative, variable, ceiling, text", CALLERS, ids=IDS)
def test_each_caller_asks_the_transport_for_the_output_it_asked_for(clean_env, name, relative, variable, ceiling, text):
    module = _load(relative, clean_env)
    helper = _Helper()
    module._tmux_send_run_module = helper
    SEND[name](module)
    assert helper.asked, "the delivery went through the helper"
    assert all(asked[2] is text for asked in helper.asked), (name, helper.asked)
