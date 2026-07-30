#!/usr/bin/env python3
"""Regression test: la Console governa davvero le code autonome."""

import json
import os
from pathlib import Path
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[2]
POLICY = ROOT / "shared" / "skills" / "enrichment_policy.py"
QUERY = ROOT / "shared" / "skills" / "db_query.py"


def run(script: Path, *args: str, env: dict[str, str]) -> str:
    result = subprocess.run(
        ["python3", str(script), *args], env=env, text=True,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=True,
    )
    return result.stdout


with tempfile.TemporaryDirectory(prefix="jht-coordinator-") as home:
    env = dict(os.environ, JHT_HOME=home)
    run(POLICY, "set", "geocode_missing.min_score", "65", env=env)
    run(POLICY, "set", "geocode_missing.non_remote_only", "true", env=env)
    run(POLICY, "set", "recheck_weekly.min_score", "72", env=env)
    run(POLICY, "set", "recheck_weekly.older_than_days", "14", env=env)
    state = json.loads(run(POLICY, "show", env=env))
    assert state["policy"]["geocode_missing"] == {
        "enabled": True, "min_score": 65, "non_remote_only": True,
    }
    assert state["policy"]["recheck_weekly"] == {
        "enabled": True, "min_score": 72, "older_than_days": 14,
    }
    geo = run(QUERY, "next-for-geocode-missing", env=env)
    recheck = run(QUERY, "next-for-recheck-due", env=env)
    # L'alias legacy resta valido (prompt/sessioni vive pre-rinomina).
    recheck_legacy = run(QUERY, "next-for-recheck-weekly", env=env)
    assert "score >= 65, non remote" in geo
    assert "score>=72" in recheck and ">14gg" in recheck
    assert "score>=72" in recheck_legacy and ">14gg" in recheck_legacy

print("COORDINATOR-POLICY-TEST PASS")
