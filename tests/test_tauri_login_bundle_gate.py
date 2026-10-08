import base64
import importlib.util
import json
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "verify-tauri-login-bundle.py"
PUBLIC_URL = "https://synthetic-project.supabase.co"
PUBLIC_KEY = "sb_publishable_synthetic_public_value"
SECRET_VALUE = b"sb_secret_" + b"A" * 22 + b"_" + b"B" * 8

SPEC = importlib.util.spec_from_file_location("verify_tauri_login_bundle", SCRIPT)
assert SPEC and SPEC.loader
gate = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gate)


def write_bundle(tmp_path: Path, extra: bytes = b"") -> Path:
    bundle = tmp_path / "dist"
    bundle.mkdir()
    (bundle / "app.js").write_bytes(
        PUBLIC_URL.encode() + b"\n" + PUBLIC_KEY.encode() + b"\n" + extra
    )
    return bundle


def jwt_for_role(role: str) -> bytes:
    def segment(value: dict[str, str]) -> bytes:
        encoded = base64.urlsafe_b64encode(json.dumps(value).encode())
        return encoded.rstrip(b"=")

    return b".".join(
        (
            segment({"alg": "HS256", "typ": "JWT"}),
            segment({"role": role}),
            b"synthetic-signature",
        )
    )


def test_the_public_login_config_is_accepted() -> None:
    gate.validate_public_config(PUBLIC_URL, PUBLIC_KEY)


@pytest.mark.parametrize(
    "marker",
    [
        b"key.startsWith('sb_secret_') || example === 'sb_secret_not-a-credential'",
        b"sb_secret_value",
        b"SUPABASE_SERVICE_ROLE_KEY",
        b"c2VydmljZV9yb2xl",  # "service_role" in base64, as SDK code carries it
    ],
)
def test_sdk_secret_format_marker_without_a_value_is_allowed(tmp_path: Path, marker: bytes) -> None:
    bundle = write_bundle(tmp_path, marker)

    gate.verify_paths([bundle], PUBLIC_URL, PUBLIC_KEY)


def test_public_anon_jwt_is_not_confused_with_a_service_role_value(tmp_path: Path) -> None:
    bundle = write_bundle(tmp_path, jwt_for_role("anon"))

    gate.verify_paths([bundle], PUBLIC_URL, PUBLIC_KEY)


@pytest.mark.parametrize(
    "credential",
    [
        SECRET_VALUE,
        b'{"apiKey":"' + SECRET_VALUE + b'"}',
        jwt_for_role("service_role"),
    ],
)
def test_real_shaped_privileged_values_are_rejected_without_echoing_them(
    tmp_path: Path, credential: bytes
) -> None:
    bundle = write_bundle(tmp_path, b"const credential='" + credential + b"';")

    with pytest.raises(gate.BundleConfigError) as caught:
        gate.verify_paths([bundle], PUBLIC_URL, PUBLIC_KEY)

    message = str(caught.value)
    assert "privileged Supabase credential" in message
    assert credential.decode() not in message


def test_privileged_value_in_a_source_map_is_rejected(tmp_path: Path) -> None:
    bundle = write_bundle(tmp_path)
    (bundle / "app.js.map").write_bytes(b'{"sourcesContent":["' + SECRET_VALUE + b'"]}')

    with pytest.raises(gate.BundleConfigError, match="privileged Supabase credential"):
        gate.verify_paths([bundle], PUBLIC_URL, PUBLIC_KEY)


def test_an_asset_read_failure_is_fail_closed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    bundle = write_bundle(tmp_path)

    def fail_read(_path: Path) -> bytes:
        raise OSError("synthetic read failure")

    monkeypatch.setattr(Path, "read_bytes", fail_read)
    with pytest.raises(gate.BundleConfigError, match="could not be read"):
        gate.verify_paths([bundle], PUBLIC_URL, PUBLIC_KEY)


@pytest.mark.parametrize(
    ("contents", "missing"),
    [
        (PUBLIC_KEY.encode(), "URL"),
        (PUBLIC_URL.encode(), "anon key"),
        (b"SDK only: sb_secret_", "URL and anon key"),
    ],
)
def test_missing_login_configuration_still_fails(
    tmp_path: Path, contents: bytes, missing: str
) -> None:
    bundle = tmp_path / "dist"
    bundle.mkdir()
    (bundle / "app.js").write_bytes(contents)

    with pytest.raises(gate.BundleConfigError, match=missing):
        gate.verify_paths([bundle], PUBLIC_URL, PUBLIC_KEY)
