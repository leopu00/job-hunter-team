"""JHT-T09, phase 2: the transport hands messages between agents to the mailbox.

Two layers. The decisions (`route`, the schedule of nudges, the watchdog's tick) are tested on the
library with the identity of the sender injected. The script `jht-tmux-send` is run for real with a
fake `tmux` first in the PATH (a shell function would not be seen by a child process): the fake keeps
a composer, so what is typed, what is submitted and what the pane shows can be read afterwards.
Every name and text is synthetic.
"""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
MODULE = ROOT / "shared" / "skills" / "jht_mail.py"
TRANSPORT = ROOT / "agents" / "_skills" / "tmux-send" / "jht-tmux-send"
WATCHDOG = ROOT / ".launcher" / "agent-watchdog.sh"
SOURCE_PATH = ROOT / "shared" / "skills"

spec = importlib.util.spec_from_file_location("jht_mail_transport_under_test", MODULE)
mail = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mail)

T0 = datetime.now(timezone.utc).replace(microsecond=0)
VERIFIED = ("verified", "scout-1", "scout-1")


@pytest.fixture(autouse=True)
def jht_home(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    return tmp_path


def enable(home, *names):
    (home / "jht.config.json").write_text(json.dumps({"mail_receivers": list(names)}), encoding="utf-8")


def envelope(sender="scout-1", to="capitano", kind="REQ", text="please look at position 7"):
    return f"[@{sender} -> @{to}] [{kind}] {text}"


# -- who is a receiver: fail closed ---------------------------------------------------------------------

def test_without_a_config_nobody_receives_by_mail():
    assert mail.load_receivers() == frozenset()


def test_the_receivers_are_the_names_in_the_config(jht_home):
    enable(jht_home, "capitano", "Mentor-1")
    assert mail.load_receivers() == frozenset({"capitano-1", "mentor-1"})


@pytest.mark.parametrize("content", [
    "not json", "[]", '{"mail_receivers": "capitano"}', '{"mail_receivers": {"capitano": true}}',
    '{"mail_receivers": ["capitano", "../x"]}',  # one bad name voids the whole list
    '{"mail_receivers": ["capitano", 7]}',
])
def test_a_config_that_is_not_a_clean_list_of_agents_means_nobody(jht_home, content):
    (jht_home / "jht.config.json").write_text(content, encoding="utf-8")
    assert mail.load_receivers() == frozenset()


def test_a_link_or_a_huge_file_as_the_config_means_nobody(jht_home, tmp_path):
    real = tmp_path / "elsewhere.json"
    real.write_text(json.dumps({"mail_receivers": ["capitano"]}))
    (jht_home / "jht.config.json").symlink_to(real)
    assert mail.load_receivers() == frozenset()
    (jht_home / "jht.config.json").unlink()
    (jht_home / "jht.config.json").write_text(json.dumps({"mail_receivers": ["capitano"], "pad": "x" * 300000}))
    assert mail.load_receivers() == frozenset()


# -- the decision to route ----------------------------------------------------------------------------------

def route(session="CAPITANO", message=None, identity=VERIFIED, receivers=frozenset({"capitano-1"}), now=T0):
    return mail.route(session, message or envelope(), identity=identity, receivers=receivers, now=now)


def test_a_verified_agent_to_a_receiver_becomes_a_file_with_the_first_nudge_recorded():
    routed = route()
    assert routed["session"] == "CAPITANO" and routed["recipient"] == "capitano-1" and routed["created"] is True
    [record] = mail.drain("capitano-1", now=T0)
    assert record["body"] == "please look at position 7" and record["kind"] == "REQ"
    assert record["from_verified"] == "scout-1" and record["trust"] == "verified"
    assert [r["state"] for r in mail.receipts("capitano-1", routed["id"])] == ["queued", "nudged", "taken"]


def test_the_same_message_twice_in_ten_seconds_is_one_file_and_one_nudge():
    start = T0 - timedelta(seconds=T0.timestamp() % 10)
    first = route(now=start)
    again = route(now=start + timedelta(seconds=2))
    assert again["id"] == first["id"] and again["created"] is False
    assert [r["state"] for r in mail.receipts("capitano-1", first["id"])].count("nudged") == 1


@pytest.mark.parametrize("name,kwargs", [
    ("nobody is a receiver", {"receivers": frozenset()}),
    ("another recipient", {"session": "SCOUT-2"}),
    ("no envelope", {"message": "just words"}),
    ("an envelope to somebody else", {"message": envelope(to="scout-2")}),
    ("a message to oneself", {"message": envelope(sender="capitano"), "identity": ("verified", "capitano-1", "capitano-1")}),
    ("the user as sender", {"message": envelope(sender="utente"), "identity": ("verified", "utente", "scout-1")}),
    ("a bridge as sender", {"message": envelope(sender="bridge"), "identity": ("relayed", "bridge", "scout-1")}),
    ("an unverified sender", {"identity": ("unverified", "scout-1", None)}),
    ("a relayed sender even from the right pane", {"identity": ("relayed", "scout-1", "scout-1")}),
    ("no origin at all", {"identity": ("verified", "scout-1", None)}),
    ("an origin that is not the claimed sender", {"identity": ("verified", "scout-1", "analista-1")}),
    ("a claimed name that differs from the envelope", {"identity": ("verified", "analista-1", "scout-1")}),
    ("an empty text", {"message": "[@scout-1 -> @capitano] [REQ]   "}),
    ("a session that is not an agent name", {"session": "../x"}),
])
def test_everything_else_keeps_to_the_terminal(name, kwargs):
    assert route(**kwargs) is None
    assert not (mail.home() / "mailbox").exists() or not list((mail.home() / "mailbox").rglob("*.json")), name


def test_no_folder_is_made_for_a_name_nobody_listed(jht_home):
    route(session="SCOUT-2", message=envelope(to="scout-2"))
    assert not (jht_home / "mailbox").exists()


def test_the_command_to_send_refuses_a_name_that_is_not_a_receiver(jht_home):
    env = {**os.environ, "JHT_HOME": str(jht_home)}
    done = subprocess.run([sys.executable, str(MODULE), "send", "scout-2"], input="x", capture_output=True, text=True, env=env)
    assert done.returncode == mail.EXIT["refused"] and "not a mail receiver" in done.stdout
    assert not (jht_home / "mailbox").exists()


# -- the nudges that follow ---------------------------------------------------------------------------------------

def test_a_queued_message_is_woken_for_again_after_a_minute_then_after_five_and_no_more():
    routed = route(now=T0)
    receivers = frozenset({"capitano-1"})
    assert mail.remind(receivers, now=T0 + timedelta(seconds=59)) == []
    [second] = mail.remind(receivers, now=T0 + timedelta(seconds=60))
    assert second == {"session": "CAPITANO", "text": mail.nudge_text(1)}
    assert mail.remind(receivers, now=T0 + timedelta(seconds=60 + 299)) == []
    assert len(mail.remind(receivers, now=T0 + timedelta(seconds=60 + 300))) == 1
    assert mail.remind(receivers, now=T0 + timedelta(days=1)) == [], "three nudges, no more"
    assert [r["state"] for r in mail.receipts("capitano-1", routed["id"])].count("nudged") == 3


def test_a_message_that_was_taken_is_not_woken_for():
    route(now=T0)
    mail.drain("capitano-1", now=T0 + timedelta(seconds=5))
    assert mail.remind(frozenset({"capitano-1"}), now=T0 + timedelta(seconds=120)) == []


def test_the_nudge_carries_no_content_of_any_message():
    route(message=envelope(text="the secret words of the message"), now=T0)
    [line] = mail.remind(frozenset({"capitano-1"}), now=T0 + timedelta(seconds=61))
    assert "secret" not in line["text"] and "[@" not in line["text"], "no envelope: it can never be routed itself"


def test_the_words_the_transport_types_are_the_ones_the_library_would():
    script = TRANSPORT.read_text(encoding="utf-8")
    assert f'message="{mail.nudge_text(1)}"' in script


def test_the_tick_expires_tells_and_wakes_and_makes_no_folder_for_those_who_are_not_receivers(jht_home):
    receivers = frozenset({"capitano-1"})
    route(now=T0)  # an ordinary request, 10 minutes of patience
    urgent = mail.route("CAPITANO", envelope(kind="URG", text="stop now"), identity=VERIFIED, receivers=receivers, now=T0)
    lines = mail.tick(receivers, now=T0 + timedelta(seconds=60))
    assert [l for l in lines if "new message" in l["text"]] == [{"session": "CAPITANO", "text": mail.nudge_text(2)}]
    lines = mail.tick(receivers, now=T0 + timedelta(seconds=60 + 120))
    expired = mail.state_of("capitano-1", urgent["id"])
    assert expired == "expired"
    typed = [l for l in lines if "was not taken" in l["text"]]
    assert {l["session"] for l in typed} == {"SCOUT-1", "SENTINELLA"}, "the sender and the sentinel; the captain is the recipient"
    assert all(l["text"].startswith("[@watchdog -> @") for l in typed)
    assert sorted(p.name for p in (jht_home / "mailbox").iterdir()) == ["capitano-1"]


def test_the_sessions_of_the_agents_that_run_once_have_a_bare_name():
    assert [mail.session_of(n) for n in ("capitano-1", "scout-2", "sentinella", "Analista-1")] == [
        "CAPITANO", "SCOUT-2", "SENTINELLA", "ANALISTA-1"]


def test_the_command_tick_prints_session_tab_text_and_nothing_else(jht_home):
    enable(jht_home, "capitano")
    route(now=datetime.now(timezone.utc) - timedelta(seconds=90))
    env = {**os.environ, "JHT_HOME": str(jht_home)}
    done = subprocess.run([sys.executable, str(MODULE), "tick"], capture_output=True, text=True, env=env)
    assert done.returncode == 0, done.stderr
    assert done.stdout.splitlines() == [f"CAPITANO\t{mail.nudge_text(1)}"]


# -- no receipt is lost while another process trims the file ----------------------------------------------------------

def test_a_receipt_appended_while_the_file_is_rewritten_is_not_lost():
    mail.send("capitano", "seed", sender=VERIFIED, message_id="seed-1", now=T0)
    path = mail.box_dir("capitano") / "receipts.jsonl"
    stale = json.dumps({"id": "old", "state": "taken", "at": "2020-01-01T00:00:00Z"}) + "\n"
    stop = threading.Event()

    def trimmer():
        while not stop.is_set():
            with open(path, "a") as handle:
                handle.write(stale * (mail.RECEIPTS_TRIM_AT // len(stale) + 2))
            with mail._Lock("capitano"):
                mail._trim_receipts("capitano", datetime.now(timezone.utc))

    worker = threading.Thread(target=trimmer)
    worker.start()
    try:
        for number in range(40):
            mail.record_nudge("capitano", [f"id-{number:02d}"], now=datetime.now(timezone.utc))
    finally:
        stop.set()
        worker.join()
    kept = {r["id"] for r in mail.receipts("capitano") if r.get("state") == "nudged"}
    assert kept == {f"id-{n:02d}" for n in range(40)}


# -- the transport, for real, with a fake tmux ---------------------------------------------------------------------------

FAKE_TMUX = r"""#!/bin/sh
S="$FAKE_TMUX_STATE"
cmd="$1"; shift
case "$cmd" in
  has-session) exit 0 ;;
  list-panes) printf '%s %s\n' "$FAKE_PANE_PID" "$FAKE_PANE_SESSION"; printf '99999 capitano\n99998 analista-1\n'; exit 0 ;;
  show-options) exit 0 ;;
  capture-pane) printf '%s\n' "${FAKE_SCREEN:-}"; printf '❯ %s\n' "$(cat "$S/composer" 2>/dev/null)"; exit 0 ;;
  send-keys)
    while [ "$1" = "-t" ]; do shift 2; done
    if [ "$1" = "-l" ]; then
      [ "${FAKE_MUTE:-0}" = 1 ] && exit 0
      printf '%s' "$2" >> "$S/composer"; printf '%s\0' "$2" >> "$S/typed"; exit 0
    fi
    if [ "$1" = "Enter" ]; then
      [ "${FAKE_ENTER_IGNORED:-0}" = 1 ] && exit 0
      cat "$S/composer" >> "$S/submitted" 2>/dev/null; printf '\0' >> "$S/submitted"; : > "$S/composer"; exit 0
    fi
    exit 0 ;;
esac
exit 0
"""


@pytest.fixture
def wire(tmp_path, jht_home):
    """The transport run as `scout-1`, whose pane is this test process, towards fake sessions."""
    bin_dir = tmp_path / "fake-bin"
    state = tmp_path / "fake-state"
    bin_dir.mkdir()
    state.mkdir()
    (bin_dir / "tmux").write_text(FAKE_TMUX, encoding="utf-8")
    (bin_dir / "tmux").chmod(0o755)

    def run(session, message, *, pane_session="scout-1", **extra):
        env = {**os.environ, "JHT_HOME": str(jht_home), "FAKE_TMUX_STATE": str(state),
               "FAKE_PANE_PID": str(os.getpid()), "FAKE_PANE_SESSION": pane_session,
               "PATH": f"{bin_dir}:{Path(sys.executable).parent}:/usr/bin:/bin", "TMUX": "fake", **extra}
        return subprocess.run([str(TRANSPORT), session, message], capture_output=True, text=True, timeout=120, env=env)

    def typed():
        raw = (state / "typed").read_text(encoding="utf-8") if (state / "typed").exists() else ""
        return [part for part in raw.split("\0") if part]

    def messages():
        path = jht_home / "logs" / "messages.jsonl"
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()] if path.exists() else []

    return run, typed, messages


def queued_files(home, agent="capitano-1"):
    return sorted((home / "mailbox" / agent / "new").glob("*.json")) if (home / "mailbox" / agent / "new").exists() else []


def test_a_receivers_message_is_queued_and_only_the_nudge_is_typed(wire, jht_home):
    run, typed, messages = wire
    enable(jht_home, "capitano")
    done = run("CAPITANO", envelope())
    assert done.returncode == 0, done.stderr
    assert "queued" in done.stdout
    [file] = queued_files(jht_home)
    record = json.loads(file.read_text())
    assert record["body"] == "please look at position 7" and record["from_verified"] == "scout-1"
    assert typed() == [mail.nudge_text(1)], "the text of the message is never typed"
    [line] = messages()
    assert line["delivered"] is False and line["mail_state"] == "queued" and line["mail_id"] == record["id"]
    assert line["from_trust"] == "verified"


def test_without_receivers_the_message_is_typed_as_it_always_was(wire, jht_home):
    run, typed, messages = wire
    done = run("CAPITANO", envelope())
    assert done.returncode == 0, done.stderr
    assert typed() == [envelope()]
    assert not (jht_home / "mailbox").exists()
    assert messages()[0]["delivered"] is True and "mail_id" not in messages()[0]


def test_a_session_that_is_not_a_receiver_keeps_the_terminal(wire, jht_home):
    run, typed, _ = wire
    enable(jht_home, "capitano")
    assert run("ANALISTA-1", envelope(to="analista-1")).returncode == 0
    assert typed() == [envelope(to="analista-1")] and not (jht_home / "mailbox").exists()


@pytest.mark.parametrize("message", ["[@watchdog -> @capitano] [MSG] a daemon's notice", "plain words without an envelope"])
def test_only_a_verified_agent_to_agent_envelope_is_routed(wire, jht_home, message):
    run, typed, _ = wire
    enable(jht_home, "capitano")
    done = run("CAPITANO", message)
    assert done.returncode == 0, done.stderr
    assert queued_files(jht_home) == []
    assert len(typed()) == 1 and message.split("] ", 1)[-1] in typed()[0]


def test_a_sender_that_tmux_cannot_place_is_never_routed(wire, jht_home):
    run, typed, _ = wire
    enable(jht_home, "capitano")
    done = run("CAPITANO", envelope(), FAKE_PANE_PID="1")  # the pane is somebody else's process tree
    assert done.returncode == 0, done.stderr
    assert queued_files(jht_home) == [] and typed() and "UNVERIFIED" in typed()[0]


@pytest.mark.parametrize("message", [envelope(sender="analista-1"), envelope(sender="utente")])
def test_impersonation_is_refused_before_the_router_and_leaves_no_mail(wire, jht_home, message):
    run, typed, _ = wire
    enable(jht_home, "capitano")
    done = run("CAPITANO", message)
    assert done.returncode == 6, done.stderr
    assert queued_files(jht_home) == [] and typed() == []


def test_a_nudge_that_is_not_confirmed_still_leaves_the_message_queued_and_exits_zero(wire, jht_home):
    run, typed, _ = wire
    enable(jht_home, "capitano")
    done = run("CAPITANO", envelope(), FAKE_ENTER_IGNORED="1")
    assert done.returncode == 0, done.stderr
    assert "nudge unconfirmed" in done.stderr
    assert len(queued_files(jht_home)) == 1, "the message is safe, whatever happened to the nudge"


def test_a_terminal_that_does_not_respond_keeps_its_exit_code_three(wire, jht_home):
    run, _, _ = wire
    enable(jht_home, "capitano")
    done = run("CAPITANO", envelope(), FAKE_MUTE="1")
    assert done.returncode == 3, done.stderr
    assert len(queued_files(jht_home)) == 1 and "queued" in done.stderr


# -- the watchdog ----------------------------------------------------------------------------------------------------------

def test_the_watchdog_runs_the_tick_each_round_and_types_what_it_prints(tmp_path):
    source = WATCHDOG.read_text(encoding="utf-8")
    assert 'MAIL_BIN="${JHT_MAIL_BIN:-jht-mail}"' in source
    assert source.index("    maybe_mail_tick\n") > source.index("    maybe_respawn_workers\n")
    start = source.index("maybe_mail_tick() {")
    function = source[start:source.index("\n}\n", start) + 3]
    fake_mail = tmp_path / "fake-mail"
    fake_mail.write_text("#!/bin/sh\nprintf 'CAPITANO\\twake up\\nSCOUT-1\\t[@watchdog -> @scout-1] [MSG] late\\n\\n'\n")
    fake_mail.chmod(0o755)
    sender = tmp_path / "fake-sender"
    log = tmp_path / "typed.log"
    sender.write_text(f"#!/bin/sh\nprintf '%s|%s\\n' \"$1\" \"$2\" >> {log}\n")
    sender.chmod(0o755)
    script = f'MAIL_BIN="{fake_mail}"\nTMUX_SENDER="{sender}"\n{function}\nmaybe_mail_tick\n'
    done = subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=30)
    assert done.returncode == 0, done.stderr
    assert log.read_text().splitlines() == ["CAPITANO|wake up", "SCOUT-1|[@watchdog -> @scout-1] [MSG] late"]


def test_the_watchdog_does_nothing_when_the_command_is_not_installed():
    source = WATCHDOG.read_text(encoding="utf-8")
    start = source.index("maybe_mail_tick() {")
    function = source[start:source.index("\n}\n", start) + 3]
    done = subprocess.run(["bash", "-c", f'MAIL_BIN="/nonexistent/jht-mail"\n{function}\nmaybe_mail_tick; echo rc=$?'],
                          capture_output=True, text=True, timeout=30)
    assert done.stdout.strip() == "rc=0"


# -- the skills say it, in every language -------------------------------------------------------------------------------------

@pytest.mark.parametrize("locale", ["", ".it", ".es", ".fr", ".de", ".pt", ".hu"])
def test_the_captain_s_skill_drains_the_mailbox_and_the_sender_s_skill_says_what_zero_means(locale):
    bridge = (ROOT / "agents" / "_skills" / "bridge-mailbox" / f"SKILL{locale}.md").read_text(encoding="utf-8")
    assert "jht-mail drain" in bridge and "jht-mail ack" in bridge and "Bash(jht-mail *)" in bridge
    sender = (ROOT / "agents" / "_skills" / "tmux-send" / f"SKILL{locale}.md").read_text(encoding="utf-8")
    assert "mail_receivers" in sender and "jht-mail status" in sender
