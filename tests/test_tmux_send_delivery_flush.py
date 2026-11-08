"""Delivery contract: flush; independent cases for file-based scheduling."""

import os
import subprocess
import pytest

from test_tmux_send_delivery_proof import (
    TRANSPORT,
    box,
    MESSAGE_2,
    BODY_1,
    _body,
    _pending,
    _age_the_pending,
    BIG_LINES,
    _pending_input,
    _collapse,
    _env,
    _flush,
)


def test_flush_ours_presses_enter_on_the_text_we_left_and_writes_nothing(box):
    box.put("enter_ignored")
    assert box.run().returncode == 5
    (box.state / "enter_ignored").unlink()
    typed_before, rows_before = len(box.typed()), (box.home / "logs" / "messages.jsonl").read_text(encoding="utf-8")
    done = _flush(box)
    assert done.returncode == 0, done.stderr
    assert _body(box, "transcript") == [BODY_1] and not _pending(box).exists()
    assert len(box.typed()) == typed_before, "nothing pasted"
    assert (box.home / "logs" / "messages.jsonl").read_text(encoding="utf-8") == rows_before, "no message logged"


def test_flush_ours_does_nothing_on_a_free_composer_and_touches_no_key(box):
    done = _flush(box)
    assert done.returncode == 0, done.stderr
    assert [c for c in box.calls() if c.startswith("send-keys")] == []


def test_flush_ours_leaves_a_text_that_is_not_ours(box):
    box.put("composer", "una bozza scritta da una persona")
    done = _flush(box)
    assert done.returncode == 130, done.stderr
    assert [c for c in box.calls() if c.startswith("send-keys")] == []
    assert (box.state / "composer").read_text(encoding="utf-8") == "una bozza scritta da una persona"


def test_flush_ours_stays_out_of_a_menu_and_says_when_the_enter_is_swallowed(box):
    box.put("mode", "menu")
    assert _flush(box).returncode == 3
    box.put("mode", "normal")
    box.put("enter_ignored")
    assert box.run().returncode == 5
    done = _flush(box)
    assert done.returncode == 5 and len(box.keys("Enter")) >= 6, done.stderr
    assert _body(box, "composer") == [BODY_1]


def test_flush_ours_refuses_a_wrong_call(box):
    for args in (["--flush-ours"], ["--flush-ours", "A", "B"]):
        done = subprocess.run([str(TRANSPORT), *args], capture_output=True, text=True, timeout=30, env=_env(box))
        assert done.returncode == 1
    assert [c for c in box.calls() if c.startswith("send-keys")] == []


def test_a_claude_token_left_by_us_is_not_proved_ours_by_the_registry_alone(box):
    """The token of Claude counts LINES, which a person can paste too: from the registry it is explained only within
    the window of JHT_TMUX_TOKEN_WINDOW seconds (see the tests of the signed composer); older, it is somebody's paste."""
    _collapse(box, "claude")
    box.put("enter_ignored")
    assert box.run(BIG_LINES).returncode == 5
    token = (box.state / "composer").read_text(encoding="utf-8")
    assert token.startswith("[Pasted text #1 +")
    (box.state / "enter_ignored").unlink()
    _age_the_pending(box, 3600)
    # a person pastes a text of the same number of lines: the same kind of token, the same number
    box.put("composer", token.replace("#1", "#2"))
    calls_before = len(box.calls())
    done = box.run(MESSAGE_2)
    assert done.returncode == 130, done.stderr
    assert not any(c.startswith(("paste-buffer", "send-keys")) for c in box.calls()[calls_before:]), "no Enter on it"
    assert _pending_input(box)[-1]["reason"] == "composer_foreign"


def test_flush_ours_does_not_press_a_claude_token_either(box):
    _collapse(box, "claude")
    box.put("enter_ignored")
    assert box.run(BIG_LINES).returncode == 5
    (box.state / "enter_ignored").unlink()
    done = _flush(box)
    assert done.returncode == 130, done.stderr


@pytest.mark.skipif(os.name == "nt", reason="mode bits")
def test_pending_input_is_private_and_a_world_readable_file_of_an_older_version_is_tightened(box):
    box.put("composer", "una bozza scritta da una persona")
    logs = box.home / "logs"
    assert box.run().returncode == 130
    assert (logs / "pending-input.jsonl").stat().st_mode & 0o777 == 0o600
    (logs / "pending-input.jsonl").chmod(0o644)
    assert box.run().returncode == 130
    assert (logs / "pending-input.jsonl").stat().st_mode & 0o777 == 0o600


@pytest.mark.skipif(os.name == "nt", reason="mode bits")
def test_the_folder_pending_input_creates_is_private_and_the_one_that_was_there_is_left_alone(box, tmp_path):
    box.put("composer", "una bozza scritta da una persona")
    fresh = tmp_path / "fresh-home"
    assert box.run(JHT_HOME=str(fresh)).returncode == 130
    assert (fresh / "logs").stat().st_mode & 0o777 == 0o700
    old = tmp_path / "old-home"
    (old / "logs").mkdir(parents=True)
    (old / "logs").chmod(0o755)
    assert box.run(JHT_HOME=str(old)).returncode == 130
    assert (old / "logs").stat().st_mode & 0o777 == 0o755, "a logs folder shared with others is not changed"


def test_a_long_message_is_recorded_up_to_64_kib_and_no_further(box):
    box.put("composer", "una bozza scritta da una persona")
    done = box.run("[@watchdog -> @capitano] [MSG] " + "x" * 70000)
    assert done.returncode == 130
    row = _pending_input(box)[-1]
    assert len(row["unsent"]) == 65536
    for locale in ("", ".it", ".de", ".es", ".fr", ".hu", ".pt"):
        text = (TRANSPORT.parent / f"SKILL{locale}.md").read_text(encoding="utf-8")
        assert "64 KiB" in text, locale
