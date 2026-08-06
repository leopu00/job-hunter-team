"""Static contract for the route-neutral mobile preview capture tool."""

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


def test_mobile_preview_route_is_required_and_not_hardcoded():
    source = SCRIPT.read_text(encoding="utf-8")
    assert '[[ -n "$ROUTE" ]] || fail "--route is required"' in source
    assert '00-index-full.png' in source
    assert 'id="chapter-' in source
    assert "/setup-guide" not in source
