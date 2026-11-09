"""The Google Drive client is installed the first time it is used, not shipped in the image (~100 MB for one script)."""
import io
import re
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "shared" / "skills"))

import optional_libs  # noqa: E402

REQUIREMENT = "google-api-python-client==2.198.0"


def _ensure(importable, run, which=lambda name: None):
    out = io.StringIO()
    original = optional_libs.shutil.which
    optional_libs.shutil.which = which
    try:
        optional_libs.ensure("googleapiclient", REQUIREMENT, "Google Drive", run=run, importable=importable, out=out)
    finally:
        optional_libs.shutil.which = original
    return out.getvalue()


def test_an_importable_library_installs_nothing():
    calls = []
    text = _ensure(lambda module: True, lambda *a, **k: calls.append(a))
    assert calls == [] and text == ""


def test_a_missing_library_is_installed_through_the_team_lane_and_then_imported():
    state = {"installed": False}
    calls = []

    def run(argv, **kwargs):
        calls.append((argv, kwargs))
        state["installed"] = True
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    text = _ensure(lambda module: state["installed"], run, which=lambda name: f"/usr/bin/{name}" if name == "jht-install" else None)
    assert calls[0][0] == ["jht-install", "py", REQUIREMENT]
    assert calls[0][1]["timeout"] == optional_libs.INSTALL_SECONDS
    assert "installing it now" in text and "installed." in text


def test_without_the_team_wrapper_it_falls_back_to_uv_then_pip():
    assert optional_libs._installer(REQUIREMENT)[:3] in (["jht-install", "py", REQUIREMENT], ["uv", "pip", "install"], [sys.executable, "-m", "pip"])
    optional_libs.shutil.which, original = (lambda name: "/x/uv" if name == "uv" else None), optional_libs.shutil.which
    try:
        assert optional_libs._installer(REQUIREMENT) == ["uv", "pip", "install", "--user", REQUIREMENT]
        optional_libs.shutil.which = lambda name: None
        assert optional_libs._installer(REQUIREMENT) == [sys.executable, "-m", "pip", "install", "--user", REQUIREMENT]
    finally:
        optional_libs.shutil.which = original


def test_no_network_says_so_and_stops_with_exit_2():
    def run(argv, **kwargs):
        return SimpleNamespace(returncode=1, stdout="", stderr="error: Failed to fetch: Could not resolve host: pypi.org")

    with pytest.raises(SystemExit) as stop:
        _ensure(lambda module: False, run)
    assert stop.value.code == 2


def test_the_message_for_the_user_names_the_library_and_the_network(capsys):
    def run(argv, **kwargs):
        raise subprocess.TimeoutExpired(argv, 300)

    out = io.StringIO()
    with pytest.raises(SystemExit):
        optional_libs.ensure("googleapiclient", REQUIREMENT, "Google Drive", run=run, importable=lambda m: False, out=out)
    assert REQUIREMENT in out.getvalue() and "network" in out.getvalue() and "run the command again" in out.getvalue()


def test_an_install_that_succeeds_but_does_not_import_is_a_failure():
    with pytest.raises(SystemExit) as stop:
        _ensure(lambda module: False, lambda *a, **k: SimpleNamespace(returncode=0, stdout="", stderr=""))
    assert stop.value.code == 2


def test_the_image_does_not_carry_the_drive_client_and_the_script_pins_it():
    requirements = [line.split("==")[0].strip() for line in (ROOT / "requirements.txt").read_text().splitlines()
                    if line.strip() and not line.lstrip().startswith("#")]
    assert "google-api-python-client" not in requirements
    assert {"google-auth", "google-auth-oauthlib", "gspread"} <= set(requirements)  # gspread needs the two
    script = (ROOT / "shared" / "skills" / "db_to_drive.py").read_text(encoding="utf-8")
    assert REQUIREMENT in script
    # every use of the client goes through the check, and the module still imports without it
    assert len(re.findall(r"_ensure_drive_client\(\)", script)) >= 2


def test_the_script_imports_without_the_client_installed():
    done = subprocess.run([sys.executable, "-I", "-c", "import sys; sys.modules['googleapiclient'] = None; sys.path.insert(0, 'shared/skills'); import db_to_drive"],
                          cwd=ROOT, capture_output=True, text=True, timeout=60, check=False)
    assert done.returncode == 0, done.stderr
