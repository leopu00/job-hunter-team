"""The banner reads enrichment-policy.json with the same validation as enrichment_policy.load_policy().

mode_banner keeps its own reading of the file (it runs at every turn of the Capitano and does not import the policy
module), and it took any value: an `enabled` of "no", a score of 500, a section in a list. The banner then counted the
care queues under a policy different from the one the code applies. Same file, same answer now.
"""
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

SKILLS = Path(__file__).resolve().parent.parent / "shared" / "skills"

FILES = [
    {},
    {"economy": "yes", "logo": {"enabled": "no", "min_score": 500}},
    {"economy": True, "logo": {"enabled": False, "min_score": 70}},
    {"geocode_missing": {"enabled": 0, "min_score": -1, "non_remote_only": "false"}},
    {"geocode_missing": {"enabled": False, "min_score": None, "non_remote_only": False}},
    {"recheck_weekly": {"enabled": True, "min_score": 101, "older_than_days": 0}},
    {"recheck_weekly": {"enabled": False, "min_score": 65, "older_than_days": 21}},
    {"logo": ["enabled", False], "recheck_weekly": {"min_score": True, "older_than_days": 400}},
    {"web_search": {"analista": {"enabled": True}, "scout": {"enabled": "no"}, "mentor": False, "scorer": {"enabled": True}}},
    {"web_search": ["analista"]},
]


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _policy_from_the_module(home):
    # enrichment_policy reads the path of the database at import: a fresh interpreter per home
    code = "import json, enrichment_policy as p; print(json.dumps(p.load_policy()))"
    env = {**os.environ, "JHT_HOME": str(home), "PYTHONDONTWRITEBYTECODE": "1"}
    env.pop("JHT_DB", None)
    r = subprocess.run([sys.executable, "-c", code], cwd=str(SKILLS), capture_output=True, text=True, env=env, timeout=60)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


@pytest.mark.parametrize("payload", FILES, ids=[str(i) for i in range(len(FILES))])
def test_the_banner_and_the_policy_read_the_same_file_the_same_way(tmp_path, monkeypatch, payload):
    (tmp_path / "profile").mkdir()
    (tmp_path / "profile" / "enrichment-policy.json").write_text(json.dumps(payload), encoding="utf-8")
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.delenv("JHT_DB", raising=False)
    banner = _load("mode_banner_policy_under_test", SKILLS / "mode_banner.py")
    assert banner._enrichment_policy() == _policy_from_the_module(tmp_path)
