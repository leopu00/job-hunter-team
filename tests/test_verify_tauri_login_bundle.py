from pathlib import Path
import importlib.util

import pytest


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "verify-tauri-login-bundle.py"
SPEC = importlib.util.spec_from_file_location("verify_tauri_login_bundle", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
BundleConfigError = MODULE.BundleConfigError
validate_public_config = MODULE.validate_public_config
verify_paths = MODULE.verify_paths


URL = "https://example.supabase.co"
KEY = "sb_publishable_public_test_value"


def test_accepts_public_config_present_in_built_assets(tmp_path: Path) -> None:
    (tmp_path / "app.js").write_text(f'const url="{URL}", key="{KEY}"')
    validate_public_config(URL, KEY)
    verify_paths([tmp_path], URL, KEY)


@pytest.mark.parametrize("marker", ["sb_secret_value", "SUPABASE_SERVICE_ROLE_KEY", "c2VydmljZV9yb2xl"])
def test_rejects_privileged_markers(tmp_path: Path, marker: str) -> None:
    (tmp_path / "app.js").write_text(f"{URL} {KEY} {marker}")
    with pytest.raises(BundleConfigError, match="privileged credential marker"):
        verify_paths([tmp_path], URL, KEY)


def test_rejects_bundle_without_login_config(tmp_path: Path) -> None:
    (tmp_path / "app.js").write_text("no login config")
    with pytest.raises(BundleConfigError, match="do not contain"):
        verify_paths([tmp_path], URL, KEY)
