import json
import runpy
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PAYLOAD = ROOT / "game" / "scripts" / "backend" / "payloads" / "settings.py"
STATUS_COMMAND = [
    "/usr/bin/python3",
    "-I",
    "/app/shared/skills/email_monitor.py",
    "status",
]


def run_payload(monkeypatch, capsys, status):
    calls = []

    def fake_run(command, **kwargs):
        calls.append((command, kwargs))
        return subprocess.CompletedProcess(command, 0, json.dumps(status), "")

    monkeypatch.setattr(subprocess, "run", fake_run)
    runpy.run_path(str(PAYLOAD), run_name="__main__")
    return json.loads(capsys.readouterr().out), calls


def test_settings_reads_mailbox_address_and_policy_from_the_broker(monkeypatch, capsys):
    settings, calls = run_payload(
        monkeypatch,
        capsys,
        {
            "ok": True,
            "configured": True,
            "address": "jobs@example.com",
            "admission": "allowlist",
            "rotation_pending": False,
        },
    )

    assert settings["email_account"] == {
        "configured": True,
        "email": "jobs@example.com",
        "policy": "allowlist",
        "reason": "",
    }
    assert calls == [
        (
            STATUS_COMMAND,
            {
                "capture_output": True,
                "text": True,
                "timeout": 8,
                "check": False,
            },
        )
    ]
    assert calls[0][0][0] != "python3"


def test_settings_reports_an_unavailable_broker_as_not_configured(monkeypatch, capsys):
    settings, _ = run_payload(
        monkeypatch,
        capsys,
        {
            "ok": True,
            "configured": False,
            "unavailable": "broker_unavailable",
        },
    )

    assert settings["email_account"] == {
        "configured": False,
        "email": "",
        "policy": "",
        "reason": "broker_unavailable",
    }
