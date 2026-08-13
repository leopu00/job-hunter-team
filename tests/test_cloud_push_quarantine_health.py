import json
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "shared" / "skills" / "sync_health.py"


def test_sync_health_surfaces_only_aggregate_quarantine(tmp_path):
    (tmp_path / "cloud.json").write_text(
        json.dumps({"enabled": True, "token": "synthetic-token"}),
        encoding="utf-8",
    )
    (tmp_path / ".cloud-push-quarantine.json").write_text(
        json.dumps(
            {
                "version": 1,
                "entries": [
                    {
                        "identity": "q_0123456789abcdef01234567",
                        "table": "applications",
                        "status": "active",
                        "reason": "http_500:applications_upsert_failed",
                        "attempts": 1,
                        "private_fixture": "synthetic body must not be printed",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    env = {**os.environ, "JHT_HOME": str(tmp_path)}
    result = subprocess.run(
        [sys.executable, str(TOOL), "summary", "--json"],
        text=True,
        capture_output=True,
        env=env,
        check=False,
    )

    assert result.returncode == 1
    payload = json.loads(result.stdout)
    assert payload["quarantine"] == {
        "active": 1,
        "tables": ["applications"],
    }
    assert any(
        problem["kind"] == "push_quarantine"
        for problem in payload["problems"]
    )
    assert "synthetic body" not in result.stdout
    assert "q_0123456789abcdef01234567" not in result.stdout
