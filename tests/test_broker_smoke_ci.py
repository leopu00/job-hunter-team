"""The broker smoke of docker.yml (scripts/ci/broker_smoke.py), without Docker.

The smoke runs only in CI on the real image. Here its in-container probe of
the broker's directories runs on a fake mount table, and its verdicts are
checked with Docker's answers faked. The image itself has /jht_secrets and
/jht_broker_state (empty, 0700, owned by the broker: a fresh named volume
copies that at its first mount), so a check that only asks whether the path
exists was red on every image (run 37873089084).

Run with: pytest tests/test_broker_smoke_ci.py -v
"""

import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("broker_smoke", ROOT / "scripts" / "ci" / "broker_smoke.py")
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


def _mountinfo(tmp_path, *mount_points):
    table = tmp_path / "mountinfo"
    lines = ["22 1 0:21 / / rw,relatime - overlay overlay rw"]
    lines += [f"{30 + i} 22 8:1 /volumes/x/_data {point} rw,relatime - ext4 /dev/sda1 rw"
              for i, point in enumerate(mount_points)]
    table.write_text("\n".join(lines) + "\n")
    return table


def _probe(table, *dirs):
    result = subprocess.run([sys.executable, "-c", smoke.SECRET_DIRS_PROBE, str(table), *map(str, dirs)],
                            capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


def test_an_empty_directory_of_the_image_is_not_a_volume(tmp_path):
    empty = tmp_path / "jht_secrets"
    empty.mkdir()
    assert _probe(_mountinfo(tmp_path), empty, tmp_path / "absent") == {}


@pytest.mark.skipif(os.geteuid() == 0, reason="root lists any directory")
def test_a_directory_the_agent_cannot_list_holds_nothing_for_it(tmp_path):
    closed = tmp_path / "jht_broker_state"
    closed.mkdir()
    (closed / "state.json").write_text("{}")
    closed.chmod(0o000)
    try:
        assert _probe(_mountinfo(tmp_path), closed) == {}
    finally:
        closed.chmod(0o700)


def test_a_mount_is_caught_even_when_the_agent_cannot_list_it(tmp_path):
    mounted = tmp_path / "jht_secrets"
    mounted.mkdir()
    assert _probe(_mountinfo(tmp_path, str(mounted)), mounted) == {str(mounted): "mounted"}


def test_a_directory_the_agent_can_list_with_entries_is_caught(tmp_path):
    readable = tmp_path / "jht_secrets"
    readable.mkdir()
    (readable / "mail.json").write_text("{}")
    assert _probe(_mountinfo(tmp_path), readable) == {str(readable): "lists 1 entries"}


OWNERS = json.dumps({path: [1002, "0o700"] for path in smoke.SECRET_DIRS})


def _verdict(monkeypatch, capsys, seen="{}", caught=json.dumps({"/jht_secrets": "mounted"}), owners=OWNERS):
    def fake(*args, check=True, timeout=120):
        out = ""
        if args[0] == "logs":
            out = "listening"
        elif args[0] == "exec":
            out = owners
        elif args[:2] == ("run", "--rm"):
            script = args[args.index("-c") + 1]
            if script == smoke.SECRET_DIRS_PROBE:
                mounted = any(a.endswith(":/jht_secrets:ro") for a in args)
                out = caught if mounted else seen
            elif "email_monitor" in script:
                out = json.dumps({"ok": True, "configured": False})
            elif "broker.client" in script:
                out = json.dumps({"ok": False, "reason": "peer_not_allowed"})
            elif "broker.view_ws" in script:
                out = "logged clean"  # the login view's log check, where the branch has it
            else:
                out = "13"
        return subprocess.CompletedProcess(["docker", *args], 0, stdout=out + "\n", stderr="")

    monkeypatch.setattr(smoke, "docker", fake)
    monkeypatch.setattr(smoke.time, "sleep", lambda s: None)
    code = smoke.main(["jht:x"])
    return code, capsys.readouterr().out


def test_the_image_s_empty_directories_pass(monkeypatch, capsys):
    code, out = _verdict(monkeypatch, capsys)
    assert code == 0 and "checks done: 0 failed" in out


def test_a_volume_reaching_the_agent_fails(monkeypatch, capsys):
    code, out = _verdict(monkeypatch, capsys, seen=json.dumps({"/jht_secrets": "mounted"}))
    assert code == 1 and "FAIL [secret-volumes]" in out


def test_a_probe_that_cannot_see_a_mistaken_mount_fails(monkeypatch, capsys):
    code, out = _verdict(monkeypatch, capsys, caught="{}")
    assert code == 1 and "FAIL [secret-volumes-control]" in out


def test_volumes_without_the_image_s_owner_and_mode_fail(monkeypatch, capsys):
    root_owned = json.dumps({path: [0, "0o755"] for path in smoke.SECRET_DIRS})
    code, out = _verdict(monkeypatch, capsys, owners=root_owned)
    assert code == 1 and "FAIL [volume-owner]" in out
