"""`session_exists` del sentinel-bridge non deve appendere il loop.

La domanda "esiste la sessione?" era un `subprocess.run` senza timeout: un
server tmux che non risponde fermava il bridge per sempre — niente tick, niente
pacing, niente daily-cap — senza una riga nel log. Qui un tmux finto nel PATH
che non risponde mai, e lo stesso finto che risponde, contro la funzione vera.
"""
import importlib.util
import os
import sys
import time
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
BRIDGE_PATH = REPO_ROOT / ".launcher" / "sentinel-bridge.py"

pytestmark = pytest.mark.skipif(
    sys.platform == "win32", reason="il bridge gira nel container Linux"
)


def _load_bridge():
    spec = importlib.util.spec_from_file_location(
        "sentinel_bridge_session_exists_test", BRIDGE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def bridge(tmp_path, monkeypatch):
    fake = tmp_path / "bin" / "tmux"
    fake.parent.mkdir()
    fake.write_text(
        "#!/usr/bin/env bash\n"
        'printf "%s\\n" "$*" >> "$T_CALLS"\n'
        '[ "$T_TMUX" = hang ] && exec sleep 30\n'
        '[ "$3" = "=CAPITANO" ]\n',
        encoding="utf-8", newline="\n",
    )
    fake.chmod(0o755)
    monkeypatch.setenv("PATH", f"{fake.parent}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.setenv("T_CALLS", str(tmp_path / "calls.txt"))
    module = _load_bridge()
    # raising=False: sul codice senza tetto il test deve fallire sul
    # COMPORTAMENTO (appeso / eccezione), non su un attributo mancante.
    monkeypatch.setattr(module, "SESSION_EXISTS_TIMEOUT_S", 1, raising=False)
    return module


def test_a_tmux_server_that_never_answers_does_not_hang_the_bridge(bridge, monkeypatch, capsys):
    monkeypatch.setenv("T_TMUX", "hang")
    started = time.monotonic()
    assert bridge.session_exists("CAPITANO") is False
    assert time.monotonic() - started < 10, "la domanda non ha un tetto"
    err = capsys.readouterr().err
    assert "no answer within 1s" in err and "CAPITANO" in err, err


def test_a_healthy_answer_is_unchanged_and_anchored(bridge, monkeypatch, tmp_path):
    monkeypatch.setenv("T_TMUX", "ok")
    assert bridge.session_exists("CAPITANO") is True
    assert bridge.session_exists("CAPITAN") is False
    calls = (tmp_path / "calls.txt").read_text(encoding="utf-8").splitlines()
    assert calls == ["has-session -t =CAPITANO", "has-session -t =CAPITAN"]


def test_a_missing_tmux_binary_is_an_absent_session_not_a_crash(bridge, monkeypatch):
    monkeypatch.setenv("PATH", "/nonexistent")
    assert bridge.session_exists("CAPITANO") is False
