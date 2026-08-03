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

    # Modalità RISPARMIO (mode=saving nel file dei mode, scritto dalla
    # Console): spegne l'enrichment autonomo SENZA toccare
    # enrichment-policy.json — uscendo dalla modalità la policy di prima
    # torna a valere da sola.
    mode_file = Path(home) / "profile" / "capitano-maintenance.json"
    mode_file.write_text('{"mode": "saving"}\n', encoding="utf-8")
    assert "OFF" in run(QUERY, "next-for-geocode-missing", env=env)
    assert "mode=saving" in run(QUERY, "next-for-recheck-due", env=env)
    assert "OFF" in run(QUERY, "next-for-logo-missing", env=env)
    # Le code di lettura delle altre modalità restano interrogabili: sono
    # liste, non spesa.
    assert "Raccolto" in run(QUERY, "next-for-harvest", env=env)
    assert "Calibrazione" in run(QUERY, "next-for-calibration", env=env)
    # File mode presente ma illeggibile = enrichment sospeso (mai "search").
    mode_file.write_text("garbage", encoding="utf-8")
    assert "OFF" in run(QUERY, "next-for-geocode-missing", env=env)
    mode_file.unlink()
    assert "score >= 65, non remote" in run(
        QUERY, "next-for-geocode-missing", env=env)

print("COORDINATOR-POLICY-TEST PASS")
