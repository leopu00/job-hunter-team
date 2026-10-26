"""rc=130 of jht-tmux-send («the composer holds text that is not provably ours»): the bridges do not shrug.

Before, the pacing-bridge scaled only rc=3 and rc=5 and the sentinel-bridge wrote a WARN: a pane whose composer
was taken stayed deaf for hours, 166 refusals in a log, nobody told. Now N refusals in a row first try
`jht-tmux-send --flush-ours` (Enter only on a text provably ours), then tell the Captain and leave the same
notice in the bridge mailbox (which the Captain drains at the start of a turn, even when his own composer is taken).
"""
import importlib.util
import json
import os
import stat
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
LAUNCHER = ROOT / ".launcher"


def _fake_sender(directory: Path, flush_rc: int, send_rc: int) -> Path:
    """A jht-tmux-send that logs its calls: `--flush-ours` answers flush_rc, a delivery answers send_rc."""
    script = directory / "jht-tmux-send"
    script.write_text(
        "#!/bin/bash\n"
        f'echo "$1|$2" >> "{directory}/sent.log"\n'
        f'[ "$1" = "--flush-ours" ] && exit {flush_rc}\n'
        f"exit {send_rc}\n",
        encoding="utf-8",
    )
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    return script


def _load(name: str, filename: str, home: Path, bin_dir: Path):
    os.environ["JHT_HOME"] = str(home)
    os.environ["PATH"] = f"{bin_dir}:{os.environ['PATH']}"
    spec = importlib.util.spec_from_file_location(name, LAUNCHER / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture()
def world(tmp_path, monkeypatch):
    home = tmp_path / "home"
    (home / "logs").mkdir(parents=True)
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    monkeypatch.setenv("JHT_HOME", str(home))
    monkeypatch.setenv("PATH", os.environ["PATH"])           # restored by monkeypatch after the test
    monkeypatch.setenv("PYTHONDONTWRITEBYTECODE", "1")

    def calls():
        log = bin_dir / "sent.log"
        return log.read_text(encoding="utf-8").splitlines() if log.exists() else []

    def mailbox():
        path = home / "logs" / "bridge-mailbox.jsonl"
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()] if path.exists() else []

    return type("World", (), {"home": home, "bin": bin_dir, "calls": staticmethod(calls), "mailbox": staticmethod(mailbox)})


# -- pacing-bridge ---------------------------------------------------------------------------------------------------

def test_pacing_first_tries_to_free_the_composer_and_does_not_escalate_when_it_works(world):
    _fake_sender(world.bin, flush_rc=0, send_rc=0)
    pacing = _load("pacing_bridge_under_test", "pacing-bridge.py", world.home, world.bin)
    assert pacing.escalate_composer_to_capitano(2) is True
    assert world.calls() == [f"--flush-ours|{pacing.TARGET_SESSION}"], "only the Enter on our own text, no notice"
    assert world.mailbox() == []


def test_pacing_tells_the_captain_and_leaves_the_notice_in_the_mailbox_when_it_cannot_free_it(world):
    _fake_sender(world.bin, flush_rc=130, send_rc=0)
    pacing = _load("pacing_bridge_under_test", "pacing-bridge.py", world.home, world.bin)
    assert pacing.escalate_composer_to_capitano(2) is True
    sent = world.calls()
    assert sent[0].startswith("--flush-ours|") and sent[1].startswith(f"{pacing.ESCALATION_SESSION}|")
    notice = sent[1]
    assert "rc=130" in notice and "do NOT respawn" in notice and "--flush-ours" in notice
    rows = world.mailbox()
    assert [row["kind"] for row in rows] == ["escalation"] and "NOT provably ours" in rows[0]["msg"]


def test_pacing_notice_survives_a_captain_whose_own_composer_is_taken(world):
    _fake_sender(world.bin, flush_rc=130, send_rc=130)
    pacing = _load("pacing_bridge_under_test", "pacing-bridge.py", world.home, world.bin)
    assert pacing.escalate_composer_to_capitano(3) is False
    assert [row["kind"] for row in world.mailbox()] == ["escalation"], "the Captain drains it at the next turn"


def test_pacing_loop_counts_the_130_and_never_mixes_it_with_the_respawn_streaks():
    source = (LAUNCHER / "pacing-bridge.py").read_text(encoding="utf-8")
    loop = source.split("composer_streak = 0\n", 1)[1]
    assert "if rc == 130 and TARGET_SESSION != ESCALATION_SESSION:" in loop
    assert "escalate_composer_to_capitano(composer_streak)" in loop
    assert "elif rc != 130:\n                composer_streak = 0" in loop
    # 130 is the pane's composer, not a dead pane: it never reaches the rc=3 path that can end in a respawn
    assert "rc == 3 and" in loop and "escalate_unreceptive_to_capitano(unreceptive_streak)" in loop
    assert "escalate_composer_to_capitano" not in source.split("def escalate_unreceptive_to_capitano")[1].split("\ndef ")[0]


# -- sentinel-bridge -------------------------------------------------------------------------------------------------

def _sentinel(world, monkeypatch, flush_rc, send_rc):
    _fake_sender(world.bin, flush_rc=flush_rc, send_rc=send_rc)
    module = _load("sentinel_bridge_under_test", "sentinel-bridge.py", world.home, world.bin)
    monkeypatch.setattr(module, "_standby_active", lambda: False)
    monkeypatch.setattr(module, "LOGS_DIR", world.home / "logs")
    module._composer_refusals.clear()
    module._composer_noticed_at.clear()
    return module


def test_sentinel_third_refusal_in_a_row_tells_the_captain_once_and_leaves_a_mailbox_row(world, monkeypatch):
    module = _sentinel(world, monkeypatch, flush_rc=130, send_rc=130)
    for _ in range(2):
        assert module.jht_tmux_send("SENTINELLA", "tick") is False
    assert world.mailbox() == [], "two refusals are not yet a stuck pane"
    assert module.jht_tmux_send("SENTINELLA", "tick") is False
    rows = world.mailbox()
    assert [row["kind"] for row in rows] == ["composer-refused"] and "do NOT respawn" in rows[0]["msg"]
    assert any(call.startswith("--flush-ours|SENTINELLA") for call in world.calls())
    to_captain = [call for call in world.calls() if call.startswith(f"{module.CAPITANO_SESSION}|")]
    assert len(to_captain) == 1 and "NOT provably ours" in to_captain[0]
    # the fourth and fifth refusal inside the notice window do not repeat it
    module.jht_tmux_send("SENTINELLA", "tick")
    module.jht_tmux_send("SENTINELLA", "tick")
    assert len(world.mailbox()) == 1


def test_sentinel_a_text_of_ours_is_freed_instead_of_escalated(world, monkeypatch):
    module = _sentinel(world, monkeypatch, flush_rc=0, send_rc=130)
    for _ in range(3):
        module.jht_tmux_send("SENTINELLA", "tick")
    assert world.mailbox() == []
    assert not any(call.startswith(f"{module.CAPITANO_SESSION}|") for call in world.calls())
    assert module._composer_refusals.get("SENTINELLA") == 0


def test_sentinel_a_delivery_in_between_restarts_the_count(world, monkeypatch):
    module = _sentinel(world, monkeypatch, flush_rc=130, send_rc=130)
    module.jht_tmux_send("SENTINELLA", "tick")
    module.jht_tmux_send("SENTINELLA", "tick")
    _fake_sender(world.bin, flush_rc=130, send_rc=0)
    assert module.jht_tmux_send("SENTINELLA", "tick") is True
    _fake_sender(world.bin, flush_rc=130, send_rc=130)
    module.jht_tmux_send("SENTINELLA", "tick")
    module.jht_tmux_send("SENTINELLA", "tick")
    assert world.mailbox() == []


def test_the_captain_is_not_told_about_his_own_composer_through_his_own_composer(world, monkeypatch):
    module = _sentinel(world, monkeypatch, flush_rc=130, send_rc=130)
    for _ in range(3):
        module.jht_tmux_send(module.CAPITANO_SESSION, "tick")
    rows = world.mailbox()
    assert [row["kind"] for row in rows] == ["composer-refused"]
    assert len([c for c in world.calls() if c.startswith(f"{module.CAPITANO_SESSION}|")]) == 3, "no extra message to him"
