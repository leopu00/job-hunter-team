"""The user notices of the no-quota mode and of the Pi spending cap are written from shared/i18n.py, one folder above the skills. A bridge
puts only shared/skills on its path (sentinel-bridge.py): the import failed there, every tick, and the notice never reached the person
(«no-quota user notice: No module named 'i18n'»). Each text is built here in a fresh interpreter with only the skills folder on the path."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SKILLS = ROOT / "shared" / "skills"

CASES = {
    "no-quota": "import quota_data; print(quota_data.user_text('10 EUR'))",
    "spend-cap warn": "import pi_spend_cap; print(pi_spend_cap.user_text({'action': 'warn'}, {'cost': 1.5}))",
    "spend-cap credit": "import pi_spend_cap; print(pi_spend_cap.user_text({'action': 'halt', 'why': 'credit', 'provider': 'glm'}, {'cost': 0}))",
}


@pytest.mark.parametrize("name", sorted(CASES))
def test_the_notice_is_written_with_only_the_skills_folder_on_the_path(name, tmp_path):
    code = f"import sys; sys.path.insert(0, {str(SKILLS)!r}); {CASES[name]}"
    # -I: no PYTHONPATH, no current folder, no user site; run from a folder that is not the repository
    done = subprocess.run([sys.executable, "-I", "-c", code], cwd=tmp_path, capture_output=True, text=True, timeout=60,
                          env={"JHT_HOME": str(tmp_path), "JHT_LANG": "en", "PATH": "/usr/bin:/bin"})
    assert done.returncode == 0, done.stderr[-800:]
    assert "No module named" not in done.stderr
    assert done.stdout.strip(), "the notice has a text"
