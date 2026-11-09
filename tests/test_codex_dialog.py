"""Synthetic live panes exercise semantic recovery and refusal boundaries."""
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
from datetime import datetime, timedelta, timezone

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared/skills"))
import codex_dialog as dialog
from codex_dialog_state import DialogState

READY = "› \n\n  fake-model-a · /synthetic/workspace"
LABELS = ["Switch to fake-model-b  Lower usage.", "Keep current model",
          "Keep current model (never show again)  Hide future reminders."]


def menu(labels=LABELS, selected=0):
    rows = ["Approaching rate limits", "Switch to fake-model-b for lower credit usage?", ""]
    rows += [("› " if index == selected else "  ") + f"{index + 1}. {label}"
             for index, label in enumerate(labels)]
    return "\n".join(rows + ["", dialog.FOOTER, ""])


class Pane:
    def __init__(self, labels=LABELS, selected=0, closes=True):
        self.labels, self.selected, self.closes = labels, selected, closes
        self.screen = None
        self.keys = []
        self.pid = "%4:123:codex"

    def identity(self, pane):
        assert pane == "%4"
        return self.pid

    def capture(self, pane):
        assert pane == "%4"
        return self.screen if self.screen is not None else menu(self.labels, self.selected)

    def key(self, pane, key):
        assert pane == "%4"
        self.keys.append(key)
        if key in ("Up", "Down"):
            self.selected += 1 if key == "Down" else -1
        elif key == "Enter" and self.closes:
            assert self.labels[self.selected] == "Keep current model"
            self.screen = READY


def fast_recover(tmux, pane, identity, expected):
    moments = iter(range(100))
    return dialog.recover(tmux, pane, identity, expected, timeout=3,
                          sleeper=lambda _: None, clock=lambda: next(moments) / 10)


@pytest.mark.parametrize("labels,selected,keys", [
    (LABELS, 0, ["Down", "Enter"]),
    ([LABELS[1], LABELS[2], LABELS[0]], 2, ["Up", "Up", "Enter"]),
    (LABELS, 1, ["Enter"]),
])
def test_selects_the_semantic_keep_option_without_replacing_model_or_process(labels, selected, keys):
    pane = Pane(labels, selected)
    assert fast_recover(pane, "%4", pane.pid, dialog.model_menu(pane.capture("%4"))) == "codex_dialog_recovered"
    assert pane.keys == keys and pane.pid == "%4:123:codex" and pane.screen == READY


@pytest.mark.parametrize("screen", [menu() + READY, menu().replace(dialog.FOOTER, "Other prompt"),
                                    menu().replace("Keep current model\n", "Use another model\n"),
                                    "Example output:\n" + menu() + "\n› quoted output\n  ? for shortcuts",
                                    "Do you trust this folder?\n1. Yes\n2. No"])
def test_incomplete_or_historical_menus_never_earn_keys(screen):
    assert dialog.model_menu(screen) is None


def test_recaptures_under_the_lock_and_refuses_a_changed_dialog():
    pane = Pane()
    expected = dialog.model_menu(pane.capture("%4"))
    pane.screen = READY
    assert fast_recover(pane, "%4", pane.pid, expected) == "codex_dialog_changed"
    assert pane.keys == []


def test_process_change_before_confirmation_is_not_success():
    pane = Pane(selected=1)
    expected = dialog.model_menu(pane.capture("%4"))
    pane.pid = "%4:456:codex"
    assert fast_recover(pane, "%4", "%4:123:codex", expected) == "codex_dialog_changed"
    assert not pane.keys


def test_timeout_is_visible_durable_and_does_not_press_enter_again(tmp_path):
    pane, notices = Pane(closes=False), []
    for _ in range(2):
        dialog.inspect_session(tmp_path, "SCORER-1", "%4", pane,
                               notify=lambda text: notices.append(text) or True, recovery=fast_recover)
    assert pane.keys == ["Down", "Enter"]
    assert len(notices) == 1 and "codex_dialog_timeout" in notices[0]
    assert "not a dead worker" in notices[0] and "Do not replace it silently" in notices[0]
    rows = [json.loads(row) for row in (tmp_path / "logs/runtime.log").read_text().splitlines()]
    assert [row["code"] for row in rows] == ["codex_dialog_pending", "codex_dialog_timeout"]
    assert all("fake-model" not in row["message"] for row in rows)


def test_concurrent_holder_prevents_all_input(tmp_path):
    state, pane = DialogState(tmp_path, "SCORER-1", "%4"), Pane()
    state.path.parent.mkdir(parents=True)
    with state.path.with_suffix(".lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        dialog.inspect_session(tmp_path, "SCORER-1", "%4", pane, recovery=fast_recover)
    assert pane.keys == []


@pytest.mark.parametrize("damage", ["invalid", "symlink", "fifo"])
def test_hostile_state_never_rearms_a_previous_attempt(tmp_path, damage):
    state, pane = DialogState(tmp_path, "SCORER-1", "%4"), Pane()
    state.path.parent.mkdir(parents=True)
    if damage == "invalid":
        state.path.write_text("{} BAD")
    elif damage == "symlink":
        target = tmp_path / "external"
        target.write_text("{}")
        state.path.symlink_to(target)
    else:
        os.mkfifo(state.path)
    with pytest.raises((OSError, ValueError)):
        dialog.inspect_session(tmp_path, "SCORER-1", "%4", pane, recovery=fast_recover)
    assert pane.keys == []


def test_failed_notification_is_logged_and_retries_are_bounded(tmp_path):
    pane, attempts = Pane(), []
    pane.screen = "Do you trust this folder?"
    for _ in range(5):
        dialog.inspect_session(tmp_path, "SCORER-1", "%4", pane,
                               notify=lambda text: attempts.append(text) or False)
    assert not pane.keys and len(attempts) == 3
    log = (tmp_path / "logs/runtime.log").read_text()
    assert log.count('"code": "codex_dialog_notice_failed"') == 3
    assert "codex_dialog_unrecognized" in log


def test_recovery_rearms_only_after_a_confirmed_return_to_the_composer(tmp_path):
    pane = Pane()
    inspect = lambda: dialog.inspect_session(tmp_path, "SCORER-1", "%4", pane,
                                             notify=lambda _: True, recovery=fast_recover)
    inspect()
    assert pane.keys == ["Down", "Enter"]
    inspect()
    pane.screen, pane.selected = None, 0
    inspect()
    assert pane.keys == ["Down", "Enter", "Down", "Enter"]


def test_a_non_codex_process_gets_no_input(tmp_path):
    pane = Pane()
    pane.pid = "%4:123:node"
    dialog.inspect_session(tmp_path, "SCORER-1", "%4", pane)
    assert not pane.keys


def test_paused_agent_gets_no_input(tmp_path):
    from datetime import datetime, timedelta, timezone
    from agent_pause import marker_path

    path = marker_path("SCORER-1", tmp_path)
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps({"until": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()}))
    pane = Pane()
    dialog.inspect_session(tmp_path, "SCORER-1", "%4", pane)
    assert not pane.keys


def test_watchdog_dispatches_the_real_module_with_a_fake_tmux_in_path(tmp_path):
    binary = tmp_path / "bin"
    binary.mkdir()
    pane_file = tmp_path / "pane"
    pane_file.write_text(menu())
    keys = tmp_path / "keys"
    source = '''import os, sys
from pathlib import Path
args = sys.argv[1:]
pane = Path(os.environ["PANE_FILE"])
if args[0] == "list-panes": print("SCORER-1\\t%4")
elif args[0] == "display-message": print("%4" if args[-1] == "#{pane_id}" else "%4:123:codex")
elif args[0] == "capture-pane": print(pane.read_text())
elif args[0] == "send-keys":
    with open(os.environ["KEYS_FILE"], "a") as out: out.write(args[-1] + "\\n")
    text = pane.read_text()
    if args[-1] == "Down": pane.write_text(text.replace("› 1.", "  1.").replace("  2.", "› 2."))
    elif args[-1] == "Enter": pane.write_text("› \\n  fake-model-a · /synthetic/workspace")
else: raise SystemExit(7)
'''
    tmux = binary / "tmux"
    tmux.write_text(f"#!{sys.executable}\n" + source)
    tmux.chmod(0o755)
    sender = binary / "sender"
    sender.write_text(f"#!{sys.executable}\nimport sys\nfrom pathlib import Path\n"
                      f"Path({str(tmp_path / 'notice')!r}).write_text(sys.argv[-1])\n")
    sender.chmod(0o755)
    env = {**os.environ, "PATH": str(binary) + os.pathsep + os.environ["PATH"],
           "JHT_HOME": str(tmp_path), "PANE_FILE": str(pane_file), "KEYS_FILE": str(keys),
           "JHT_TMUX_SENDER": str(sender)}
    env.update(_AGENT_WATCHDOG_DIR=str(ROOT / ".launcher"), TMUX_SENDER=str(sender))
    launch = next(line for line in (ROOT / ".launcher/agent-watchdog.sh").read_text().splitlines()
                  if 'python3 "$_AGENT_WATCHDOG_DIR/../shared/skills/codex_dialog.py"' in line)
    result = subprocess.run(["bash", "-c", launch],
                            env=env, capture_output=True, text=True, timeout=15)
    assert result.returncode == 0, result.stderr
    assert keys.read_text().splitlines() == ["Down", "Enter"]
    assert "codex_dialog_recovered" in (tmp_path / "notice").read_text()
    assert "fake-model-a" in pane_file.read_text()
    status = subprocess.run([sys.executable, str(ROOT / "shared/skills/codex_dialog.py"), "status", "SCORER-1"],
                            env=env, capture_output=True, text=True, timeout=5)
    observation = json.loads(status.stdout)
    assert status.returncode == 0 and observation["last_observation"] == "codex_dialog_recovered"
    assert isinstance(observation["at"], float) and observation["session"] == "SCORER-1"


@pytest.mark.parametrize("flag", [".team-halted.flag", ".weekly-halt.flag", ".team-standby.flag"])
def test_team_stop_flags_prevent_even_a_pane_probe(tmp_path, flag):
    value = {"until": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()}
    (tmp_path / flag).write_text(json.dumps(value))
    assert dialog.tick(tmp_path, object()) == 0


def test_an_expired_standby_does_not_become_a_permanent_pause(tmp_path):
    value = {"until": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()}
    (tmp_path / ".team-standby.flag").write_text(json.dumps(value))
    assert dialog.inactive(tmp_path) is False


def test_generic_unknown_menu_is_reported_without_a_key(tmp_path):
    pane, notices = Pane(), []
    pane.screen = "Choose a model migration\n› 1. Accept migration\n  2. Cancel\nEnter to select"
    dialog.inspect_session(tmp_path, "SCORER-1", "%4", pane,
                           notify=lambda text: notices.append(text) or True)
    assert not pane.keys and "codex_dialog_unrecognized" in notices[0]


def test_kickoff_preserves_other_providers_and_gates_codex(tmp_path, monkeypatch):
    import spawn_kickoff

    calls, sleeps = [], []
    class Runtime(Pane):
        def call(self, *args):
            calls.append(args)
            return "%4"
    runtime = Runtime()
    assert spawn_kickoff.kickoff("DOTTORE", "synthetic task", "claude", tmp_path,
                                  tmux=runtime, sleeper=sleeps.append)
    assert sleeps == [6, 3, 3, 4, 1, 2]
    assert [call[-1] for call in calls] == ["Enter", "Enter", "Enter", "synthetic task", "Enter", "Enter"]
    calls.clear()
    def inspect(home, session, pane, tmux):
        return dialog.inspect_session(home, session, pane, tmux, notify=lambda _: True, recovery=fast_recover)
    monkeypatch.setattr(spawn_kickoff, "inspect_session", inspect)
    delivered = []
    assert spawn_kickoff.kickoff("DOTTORE", "synthetic task", "codex", tmp_path,
                                  tmux=runtime, sleeper=lambda _: None,
                                  deliver=lambda *args: delivered.append(args) or True)
    assert runtime.keys == ["Down", "Enter"]
    assert len(calls) == 1 and calls[0][-1] == "#{pane_id}"
    assert delivered == [("DOTTORE", "synthetic task")]


def test_kickoff_delivery_refusal_is_not_reported_as_success(tmp_path):
    import spawn_kickoff

    class Runtime(Pane):
        def call(self, *args):
            return "%4"
    runtime = Runtime()
    runtime.screen = READY
    assert not spawn_kickoff.kickoff("DOTTORE", "synthetic task", "codex", tmp_path,
                                      tmux=runtime, sleeper=lambda _: None, deliver=lambda *_: False)
    assert not runtime.keys
    assert "message_not_delivered" in (tmp_path / "logs/runtime.log").read_text()


def test_notification_and_kickoff_delegate_deadlines_without_killing_the_transport(tmp_path, monkeypatch):
    import spawn_kickoff

    calls = []
    def transport(argv, timeout):
        calls.append((argv, timeout))
        raise subprocess.TimeoutExpired(argv, timeout)
    def destructive(*args, **kwargs):
        raise AssertionError("the send transport must not use subprocess.run")
    monkeypatch.setattr(dialog, "run", transport)
    monkeypatch.setattr(spawn_kickoff, "run", transport)
    monkeypatch.setattr(subprocess, "run", destructive)
    monkeypatch.setattr(spawn_kickoff, "inspect_session", lambda *args: None)
    class Runtime:
        def call(self, *args):
            return "%4"
        def capture(self, pane):
            return READY
        def identity(self, pane):
            return "%4:123:codex"
    assert dialog.notify_captain("synthetic notice") is False
    with pytest.raises(subprocess.TimeoutExpired):
        spawn_kickoff.kickoff("DOTTORE", "synthetic task", "codex", tmp_path,
                              tmux=Runtime(), sleeper=lambda _: None)
    assert [(argv[1], timeout) for argv, timeout in calls] == [("CAPITANO", 10), ("DOTTORE", 120)]


@pytest.mark.parametrize("screen", ["Sign in to Codex\nPress enter to confirm", menu(),
                                    "plain shell", "› synthetic draft\n  fake-model-a · /synthetic/workspace"])
def test_kickoff_never_delivers_into_an_unresolved_dialog_or_draft(tmp_path, monkeypatch, screen):
    import spawn_kickoff

    class Runtime(Pane):
        def call(self, *args):
            return "%4"
    runtime, deliveries = Runtime(closes=False), []
    runtime.screen = screen
    def inspect(home, session, pane, tmux):
        dialog.inspect_session(home, session, pane, tmux, notify=lambda _: True, recovery=fast_recover)
    monkeypatch.setattr(spawn_kickoff, "inspect_session", inspect)
    assert not spawn_kickoff.kickoff("DOTTORE", "synthetic task", "codex", tmp_path,
                                      tmux=runtime, sleeper=lambda _: None,
                                      deliver=lambda *args: deliveries.append(args) or True)
    assert deliveries == []


def test_tmux_probe_failure_has_a_catalog_code_and_a_runtime_row(tmp_path):
    class Broken:
        def call(self, *args):
            raise subprocess.TimeoutExpired("tmux", 5)
    assert dialog.tick(tmp_path, Broken()) == 3
    row = json.loads((tmp_path / "logs/runtime.log").read_text())
    assert row["code"] == "codex_dialog_io_error" and row["message"]


def test_regular_log_guard_refuses_a_symlink_before_sending_any_key(tmp_path):
    (tmp_path / "logs").mkdir()
    target = tmp_path / "unrelated"
    target.write_text("synthetic sentinel")
    (tmp_path / "logs/runtime.log").symlink_to(target)
    pane = Pane()
    with pytest.raises(OSError):
        dialog.inspect_session(tmp_path, "SCORER-1", "%4", pane, recovery=fast_recover)
    assert not pane.keys and target.read_text() == "synthetic sentinel"


def test_two_panes_keep_independent_persistent_attempts_across_ticks(tmp_path):
    panes = {"%4": Pane(closes=False), "%5": Pane(closes=False)}
    class Multipane:
        def identity(self, pane):
            return panes[pane].pid.replace("%4", pane)
        def capture(self, pane):
            return panes[pane].capture("%4")
        def key(self, pane, key):
            panes[pane].key("%4", key)
    runtime = Multipane()
    for _ in range(2):
        for pane in panes:
            dialog.inspect_session(tmp_path, "SCORER-1", pane, runtime,
                                   notify=lambda _: True, recovery=fast_recover)
    assert [pane.keys for pane in panes.values()] == [["Down", "Enter"], ["Down", "Enter"]]
    assert len(list((tmp_path / "state/codex-dialogs").glob("*.json"))) == 2


def test_manual_resolution_replaces_the_stale_timeout_with_an_explicit_observation(tmp_path):
    pane, notices = Pane(closes=False), []
    def inspect():
        dialog.inspect_session(tmp_path, "SCORER-1", "%4", pane,
                               notify=lambda text: notices.append(text) or True, recovery=fast_recover)
    inspect()
    assert "codex_dialog_timeout" in notices[-1]
    pane.screen = READY
    inspect()
    state = DialogState(tmp_path, "SCORER-1", "%4").read()
    assert state["code"] == "codex_dialog_ready" and state["attempted"] is False
    assert "no automatic recovery is claimed" in notices[-1]
    assert pane.keys == ["Down", "Enter"]


# ── Pi: the same kickoff, without the Codex dialogs ──────────────────────

def _pi_runtime(screens):
    from pi_screens import screen as pi_screen

    class Runtime(Pane):
        def call(self, *args):
            return "%4"

        def capture(self, pane):
            return screens.pop(0) if len(screens) > 1 else screens[0]
    runtime = Runtime()
    runtime.pi_screen = pi_screen
    return runtime


def test_kickoff_waits_for_pis_composer_and_delivers_whatever_the_provider(tmp_path):
    import spawn_kickoff
    from pi_screens import screen

    booting = "fd not found. Downloading...\nripgrep not found. Downloading...\n"
    runtime = _pi_runtime([booting, booting, screen()])
    sleeps, delivered = [], []
    for provider in ("openai", "anthropic", ""):
        assert spawn_kickoff.kickoff("DOTTORE", "synthetic task", provider, tmp_path, tmux=runtime,
                                      sleeper=sleeps.append, deliver=lambda *a: delivered.append(a) or True,
                                      harness="pi")
        runtime.capture = lambda pane: screen()
    # the spawner of the Dottore and the Mantenitore names the CLI ("pi") as the provider
    runtime.capture = lambda pane: screen()
    assert spawn_kickoff.kickoff("DOTTORE", "synthetic task", "pi", tmp_path, tmux=runtime, sleeper=sleeps.append,
                                  deliver=lambda *a: delivered.append(a) or True)
    assert delivered == [("DOTTORE", "synthetic task")] * 4
    assert sleeps[:3] == [6, 3, 3]
    assert not runtime.keys, "no key is pressed on Pi's TUI by the kickoff"


@pytest.mark.parametrize("draft", [["una bozza"], None])
def test_kickoff_does_not_paste_over_a_draft_or_a_composer_that_never_appears(tmp_path, draft):
    import spawn_kickoff
    from pi_screens import screen

    runtime = _pi_runtime([screen(draft) if draft else "fd not found. Downloading...\n"])
    delivered = []
    assert not spawn_kickoff.kickoff("DOTTORE", "synthetic task", "openai", tmp_path, tmux=runtime,
                                      sleeper=lambda _: None, deliver=lambda *a: delivered.append(a) or True,
                                      harness="pi")
    assert not delivered
    assert "message_not_delivered" in (tmp_path / "logs/runtime.log").read_text()


def test_the_harness_of_a_session_is_read_from_its_option():
    import spawn_kickoff

    class Runtime:
        def __init__(self, out):
            self.out, self.seen = out, []

        def call(self, *args):
            self.seen.append(args)
            if self.out is None:
                raise OSError("no tmux")
            return self.out
    assert spawn_kickoff.session_harness("SCOUT-1", Runtime("pi\n")) == "pi"
    assert spawn_kickoff.session_harness("SCOUT-1", Runtime("")) == ""
    assert spawn_kickoff.session_harness("SCOUT-1", Runtime(None)) == ""
    asked = Runtime("pi")
    spawn_kickoff.session_harness("SCOUT-1", asked)
    assert asked.seen == [("show-options", "-qv", "-t", "=SCOUT-1", "@jht_harness")]
