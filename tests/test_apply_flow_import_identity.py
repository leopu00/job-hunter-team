"""Recipe exceptions remain catchable across the supported ways to load the flow."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
ENTRY = ROOT / "shared" / "skills" / "apply_flow.py"

CHECK_RECIPE_EXCEPTIONS = """
for name in ("apply_generic", "linkedin_apply", "workday_apply", "oracle_ce_apply", "icims_apply"):
    recipe = importlib.import_module(name)
    assert recipe.BlockedHuman is flow.BlockedHuman, name
    try:
        raise recipe.BlockedHuman("synthetic_stop", "synthetic detail", "detect")
    except flow.BlockedHuman as caught:
        assert caught.reason == "synthetic_stop"
    else:
        raise AssertionError("the flow did not catch the recipe's stop")
"""


@pytest.mark.parametrize("order", ["package_first", "alias_first"])
def test_recipes_raise_the_exception_the_loaded_flow_catches(order: str) -> None:
    setup = """
import importlib
import importlib.util
import sys
from pathlib import Path
root = Path.cwd()
skills = root / "shared" / "skills"
"""
    if order == "package_first":
        setup += """
flow = importlib.import_module("shared.skills.apply_flow")
sys.path.insert(0, str(skills))
flat = importlib.import_module("apply_flow")
assert flat.ApplicationFlow is flow.ApplicationFlow
assert flat.FlowCheckpoint is flow.FlowCheckpoint
assert flat.BlockedHuman is flow.BlockedHuman
"""
    else:
        setup += """
sys.path.insert(0, str(skills))
spec = importlib.util.spec_from_file_location("apply_flow_for_identity", skills / "apply_flow.py")
flow = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = flow
spec.loader.exec_module(flow)
flat = importlib.import_module("apply_flow")
assert flat.ApplicationFlow is flow.ApplicationFlow
assert flat.FlowCheckpoint is flow.FlowCheckpoint
assert flat.BlockedHuman is flow.BlockedHuman
"""
    env = dict(os.environ, PYTHONPATH=str(ROOT))
    done = subprocess.run(
        [sys.executable, "-c", setup + CHECK_RECIPE_EXCEPTIONS],
        cwd=ROOT, env=env, capture_output=True, text=True, timeout=30,
    )
    assert done.returncode == 0, done.stderr


def test_the_cli_main_keeps_recipe_exceptions_catchable(tmp_path: Path) -> None:
    cli = subprocess.run(
        [sys.executable, str(ENTRY), "--help"], cwd=tmp_path,
        capture_output=True, text=True, timeout=30,
    )
    assert cli.returncode == 0, cli.stderr
    assert "--position-id" in cli.stdout and "--ask" in cli.stdout
    script = """
import contextlib
import importlib
import io
import runpy
import sys
from pathlib import Path
skills = Path.cwd() / "shared" / "skills"
sys.path.insert(0, str(skills))
sys.argv = [str(skills / "apply_flow.py"), "--help"]
with contextlib.redirect_stdout(io.StringIO()):
    try:
        runpy.run_path(sys.argv[0], run_name="__main__")
    except SystemExit as stopped:
        assert stopped.code == 0
    else:
        raise AssertionError("the CLI did not exit")
flow = sys.modules["apply_flow"]
"""
    done = subprocess.run(
        [sys.executable, "-c", script + CHECK_RECIPE_EXCEPTIONS], cwd=ROOT,
        capture_output=True, text=True, timeout=30,
    )
    assert done.returncode == 0, done.stderr
