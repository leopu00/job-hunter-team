"""Execute the shell bridges with fake tools; delivery failure never changes containment."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
WATCHDOG = ROOT / ".launcher/agent-watchdog.sh"
DELIVERY = ROOT / "shared/skills/watchdog_delivery.py"


def function(name):
    match = re.search(rf"^{name}\(\) \{{.*?^\}}", WATCHDOG.read_text(), re.M | re.S)
    assert match
    return match.group(0)


def script(path, text):
    path.write_text(text)
    path.chmod(0o755)
    return path


def test_worker_and_bridge_forward_their_arguments_to_the_delivery_module(tmp_path):
    calls = tmp_path / "forwarded.jsonl"
    helper = script(tmp_path / "forward.py", "import json,sys\n"
                    f"with open({str(calls)!r}, 'a') as f: f.write(json.dumps(sys.argv[1:])+'\\n')\n")
    body = (f'JHT_HOME="{tmp_path}"\nTMUX_SENDER="fixture-sender"\nLOG="{tmp_path}/watchdog.log"\n'
            f'JHT_WATCHDOG_DELIVERY="{helper}"\nBRIDGE_STATE_DIR="{tmp_path}"\n'
            'BRIDGE_ESCALATE_COOLDOWN_SEC=60\nBRIDGE_FLAP_CAP=3\nBRIDGE_FLAP_WINDOW_SEC=600\n'
            'escalate_key() { printf "%s" "$1"; }\n'
            + function("worker_kickoff") + "\n" + function("bridge_escalate")
            + '\nworker_kickoff SCOUT-1 scout\nwait\nbridge_escalate fixture "fixture bridge"\n')
    result = subprocess.run(["bash", "-c", body], capture_output=True, text=True, timeout=20)
    assert result.returncode == 0, result.stderr
    assert [json.loads(line) for line in calls.read_text().splitlines()] == [
        ["kickoff", "SCOUT-1", "scout"],
        ["bridge", str(tmp_path / "bridge-escalate-fixture.ts"), "60", "fixture bridge", "3", "600", "fixture-sender"],
    ]


def test_failed_containment_notices_are_logged_and_do_not_block_release_or_reenforcement(tmp_path):
    log = tmp_path / "actions.log"
    sender = script(tmp_path / "sender", "#!/bin/sh\nexit 3\n")
    roster = script(tmp_path / "roster.py", "import sys\n"
                    "if sys.argv[1]=='release-expired': print('SCOUT-1\\tsaving\\trapid\\tASSISTENTE')\n"
                    "if sys.argv[1]=='contained-live': print('SCOUT-2\\tASSISTENTE\\t/fixture/original')\n")
    body = (f'JHT_HOME="{tmp_path}"\nTMUX_SENDER="{sender}"\nROSTER_TOOL="{roster}"\n'
            f'JHT_WATCHDOG_DELIVERY="{DELIVERY}"\n'
            f'log() {{ printf "%s\\n" "$*" >> "{log}"; }}\n'
            f'tmux() {{ printf "%s\\n" "$*" >> "{log}"; }}\n'
            'capture_for_containment() { printf "/fixture/evidence"; }\n'
            + function("maybe_enforce_containments") + '\nmaybe_enforce_containments\n'
            + f'printf "next watchdog step\\n" >> "{log}"\n')
    result = subprocess.run(["bash", "-c", body], capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
    actions = log.read_text()
    assert "SCOUT-1 released" in actions
    assert "kill-session -t =SCOUT-2" in actions and "stopped again" in actions
    assert actions.rstrip().endswith("next watchdog step")
    rows = [json.loads(line) for line in (tmp_path / "logs/runtime.log").read_text().splitlines()]
    assert len(rows) == 4 and all(row["code"] == "message_not_delivered" for row in rows)
    direct = subprocess.run([sys.executable, str(DELIVERY), "send", str(sender), "CAPITANO", "fixture"],
                            env={**os.environ, "JHT_HOME": str(tmp_path)}, capture_output=True, text=True, timeout=10)
    assert direct.returncode == 3 and "message_not_delivered" in direct.stderr


def test_an_alert_about_a_process_is_written_to_the_log_and_not_sent_to_any_agent(tmp_path, monkeypatch):
    """A bridge, a bot or a process of pid1 is not an agent: the Capitano spent turns answering that it does nothing (build10, Mac, the live screen)."""
    import sys
    sys.path.insert(0, str(Path(DELIVERY).parent))
    import watchdog_delivery as delivery
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    sent = []
    stamp = tmp_path / "bridge-escalate-pid1-child.ts"
    done = delivery.bridge(stamp, 60, "process pid1-managed morti: live-screen", 3, 600, "jht-tmux-send",
                           sender=lambda *a: sent.append(a) or True, now=10_000)
    assert done is True and sent == [], "no agent is written to"
    rows = [json.loads(line) for line in (tmp_path / "logs" / "process-alerts.jsonl").read_text().splitlines()]
    assert len(rows) == 1 and rows[0]["what"] == "process pid1-managed morti: live-screen" and "STOPPED" in rows[0]["text"]
    assert stamp.read_text().strip() == "10000"
    again = delivery.bridge(stamp, 60, "process pid1-managed morti: live-screen", 3, 600, "jht-tmux-send", sender=lambda *a: True, now=10_030)
    assert again is None, "the cooldown holds as before"
