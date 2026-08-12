"""Regression gate for the single persisted product-language preference.

The historical divergence was concrete: Godot wrote ``user://lang.cfg`` while
agent startup consumed ``$JHT_HOME/i18n-prefs.json`` (and, in practice, a
stale ``JHT_LANG`` from host.env won even over that file). These tests exercise
the resolution order and pin both sides to the frozen v1 contract.
"""

from __future__ import annotations

import json
import importlib.util
import os
from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]
SPAWN_LIB = ROOT / ".launcher" / "spawn-lib.sh"
UI_STRINGS = ROOT / "game" / "scripts" / "ui_strings.gd"
VPS_BACKEND = ROOT / "game" / "scripts" / "backend" / "vps_backend.gd"
LANGUAGE_PAYLOAD = (
    ROOT / "game" / "scripts" / "backend" / "payloads" / "language_save.py"
)
SHARED_I18N = ROOT / "shared" / "i18n.py"
SHARED_I18N_SH = ROOT / "shared" / "i18n.sh"
WIZARD_I18N = ROOT / "cli" / "wizard" / "i18n.js"


def _fake_jq(bin_dir: Path) -> None:
    """Enough jq for spawn-lib's ``.locale // "en"`` lookup."""
    jq = bin_dir / "jq"
    jq.write_text(
        "#!/usr/bin/env sh\n"
        "python3 -c 'import json,sys; print(json.load(open(sys.argv[-1])).get(\"locale\", \"en\"))' \"$@\"\n",
        encoding="utf-8",
    )
    jq.chmod(0o755)


def _bash_path(path: Path) -> str:
    posix = path.resolve().as_posix()
    if len(posix) >= 3 and posix[1:3] == ":/":
        return f"/mnt/{posix[0].lower()}/{posix[3:]}"
    return posix


def test_agent_spawn_prefers_canonical_file_over_stale_bootstrap(tmp_path):
    home = tmp_path / "jht-home"
    home.mkdir()
    (home / "i18n-prefs.json").write_text(
        json.dumps({"locale": "fr"}), encoding="utf-8"
    )
    (home / "host.env").write_text("JHT_LANG=it\n", encoding="utf-8")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _fake_jq(bin_dir)

    env = os.environ.copy()
    env.update(
        {
            "JHT_HOME": _bash_path(home),
            "JHT_LANG": "en",
            "PATH": f"{_bash_path(bin_dir)}:/usr/local/bin:/usr/bin:/bin",
        }
    )
    result = subprocess.run(
        [
            "bash",
            "-c",
            'source ".launcher/spawn-lib.sh"; jht_spawn_user_locale',
        ],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
        timeout=10,
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout == "fr"


def _divergent_language_home(tmp_path: Path) -> Path:
    home = tmp_path / "jht-home"
    home.mkdir()
    (home / "i18n-prefs.json").write_text(
        json.dumps({"locale": "fr"}), encoding="utf-8"
    )
    (home / "host.env").write_text("JHT_LANG=it\n", encoding="utf-8")
    return home


def test_python_copy_resolver_prefers_the_canonical_file(tmp_path, monkeypatch):
    home = _divergent_language_home(tmp_path)
    monkeypatch.setenv("JHT_HOME", str(home))
    monkeypatch.setenv("JHT_LANG", "en")
    spec = importlib.util.spec_from_file_location("contract_i18n", SHARED_I18N)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)

    assert module.current_lang() == "fr"


def test_shell_copy_resolver_prefers_the_canonical_file(tmp_path):
    home = _divergent_language_home(tmp_path)
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _fake_jq(bin_dir)
    env = {
        **os.environ,
        "JHT_HOME": _bash_path(home),
        "JHT_LANG": "en",
        "PATH": f"{_bash_path(bin_dir)}:/usr/local/bin:/usr/bin:/bin",
    }
    result = subprocess.run(
        ["bash", "-c", 'source "shared/i18n.sh"; _i18n_resolve_lang'],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
        timeout=10,
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout == "fr"


def test_node_copy_resolver_prefers_the_canonical_file(tmp_path):
    home = _divergent_language_home(tmp_path)
    env = {**os.environ, "JHT_HOME": str(home), "JHT_LANG": "en"}
    result = subprocess.run(
        [
            "node",
            "--input-type=module",
            "--eval",
            f'import {{ currentLang }} from {json.dumps(WIZARD_I18N.as_uri())}; '
            "process.stdout.write(currentLang());",
        ],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
        timeout=10,
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout == "fr"


def test_game_reads_and_writes_only_the_canonical_language_artifact():
    source = UI_STRINGS.read_text(encoding="utf-8")

    assert 'const LANGUAGE_PREFS := "i18n-prefs.json"' in source
    assert 'JhtFs.read_json(LANGUAGE_PREFS)' in source
    assert 'JhtFs.write_json(LANGUAGE_PREFS, {"locale": l})' in source
    assert 'user://lang.cfg' not in source
    assert "LANG_CFG" not in source


def test_remote_runtime_receives_the_same_validated_language_artifact():
    backend = VPS_BACKEND.read_text(encoding="utf-8")

    assert LANGUAGE_PAYLOAD.exists()
    payload = LANGUAGE_PAYLOAD.read_text(encoding="utf-8")
    assert "SUPPORTED_LOCALES" in payload
    assert "os.replace" in payload
    assert "'/jht_home/i18n-prefs.json'" in payload
    assert 'payload("language_save.py")' in backend
    assert "func save_ui_language(" in backend
