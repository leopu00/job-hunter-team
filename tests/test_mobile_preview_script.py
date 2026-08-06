"""Static contract for the route-neutral mobile preview capture tool."""

import json
import os
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts/capture-mobile-preview.sh"


def test_mobile_preview_script_is_valid_bash_and_documents_its_contract():
    subprocess.run(["bash", "-n", str(SCRIPT)], check=True)
    help_text = subprocess.run(
        ["bash", str(SCRIPT), "--help"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    assert "--route PATH" in help_text
    assert "--chapter ID" in help_text
    assert "--base-url URL" in help_text
    assert "--output-dir DIR" in help_text
    assert "390" in help_text
    assert "Browser and site language" in help_text


def test_mobile_preview_route_is_required_and_not_hardcoded():
    source = SCRIPT.read_text(encoding="utf-8")
    assert '[[ -n "$ROUTE" ]] || fail "--route is required"' in source
    assert '00-index-full.png' in source
    assert 'id="chapter-' in source
    assert "/setup-guide" not in source
    assert 'localStorage: [{ name: "jht-lang", value: language }]' in source
    assert '--load-storage "$STORAGE_STATE"' in source


def test_stale_bundle_fails_before_network_and_is_preserved(tmp_path):
    output = tmp_path / "preview"
    output.mkdir()
    stale = output / "stale.png"
    stale.write_bytes(b"previous-run-evidence")

    result = subprocess.run(
        [
            "bash",
            str(SCRIPT),
            "--route",
            "/unreachable",
            "--base-url",
            "http://127.0.0.1:1",
            "--output-dir",
            str(output),
        ],
        capture_output=True,
        text=True,
        timeout=2,
    )

    assert result.returncode != 0
    assert "output directory contains an earlier bundle" in result.stderr
    assert "no dev server responded" not in result.stderr
    assert stale.read_bytes() == b"previous-run-evidence"


def test_unsupported_site_language_fails_before_network(tmp_path):
    result = subprocess.run(
        [
            "bash",
            str(SCRIPT),
            "--route",
            "/unreachable",
            "--lang",
            "nl-NL",
            "--base-url",
            "http://127.0.0.1:1",
            "--output-dir",
            str(tmp_path / "preview"),
        ],
        capture_output=True,
        text=True,
        timeout=2,
    )

    assert result.returncode != 0
    assert "unsupported site language: nl-NL" in result.stderr
    assert "no dev server responded" not in result.stderr


def test_language_option_seeds_site_storage_and_manifest_without_network(tmp_path):
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    fake_curl = fake_bin / "curl"
    fake_curl.write_text(
        "#!/usr/bin/env bash\nprintf '<html><main></main></html>'\n",
        encoding="utf-8",
    )
    fake_curl.chmod(0o755)

    captured_state = tmp_path / "captured-storage.json"
    fake_npx = fake_bin / "npx"
    fake_npx.write_text(
        """#!/usr/bin/env bash
set -euo pipefail
state=""
previous=""
for argument in "$@"; do
    if [[ "$previous" == "--load-storage" ]]; then state="$argument"; fi
    previous="$argument"
done
[[ -n "$state" ]]
cp "$state" "$CAPTURED_STATE"
destination="${!#}"
printf 'synthetic-png' >"$destination"
""",
        encoding="utf-8",
    )
    fake_npx.chmod(0o755)

    output = tmp_path / "preview"
    env = os.environ.copy()
    env["PATH"] = f"{fake_bin}{os.pathsep}{env['PATH']}"
    env["CAPTURED_STATE"] = str(captured_state)
    subprocess.run(
        [
            "bash",
            str(SCRIPT),
            "--route",
            "/guide-candidate",
            "--lang",
            "fr-FR",
            "--base-url",
            "http://preview.test",
            "--output-dir",
            str(output),
        ],
        check=True,
        capture_output=True,
        text=True,
        timeout=5,
        env=env,
    )

    storage = json.loads(captured_state.read_text(encoding="utf-8"))
    assert storage == {
        "cookies": [],
        "origins": [
            {
                "origin": "http://preview.test",
                "localStorage": [{"name": "jht-lang", "value": "fr"}],
            }
        ],
    }
    manifest = (output / "manifest.txt").read_text(encoding="utf-8")
    assert "browser_language=fr-FR" in manifest
    assert "site_language=fr" in manifest
