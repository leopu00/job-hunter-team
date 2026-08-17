"""Executable oracles for the versioned Supabase Auth posture gate."""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/check-auth-security.py"

spec = importlib.util.spec_from_file_location("check_auth_security", SCRIPT)
assert spec and spec.loader
gate = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = gate
spec.loader.exec_module(gate)


def auth_config(**overrides):
    contract = gate.load_contract()
    config = {field: False for field in contract.known_external_provider_fields}
    config.update(
        {
            "disable_signup": False,
            "external_email_enabled": False,
            "external_github_enabled": True,
            "external_google_enabled": True,
            "mailer_autoconfirm": True,
            "mfa_totp_enroll_enabled": False,
            "mfa_totp_verify_enabled": False,
            "password_hibp_enabled": False,
            "password_min_length": 6,
        }
    )
    config.update(overrides)
    return config


def advisors(*names):
    return [{"name": name, "title": "Synthetic"} for name in names]


def disabled_control_advisors():
    return advisors(
        "auth_insufficient_mfa_options",
        "auth_leaked_password_protection",
    )


def test_oauth_only_is_safe_when_password_controls_are_not_applicable():
    result = gate.evaluate(
        gate.load_contract(), auth_config(), disabled_control_advisors()
    )

    assert result.ok
    assert result.mode == "oauth-only"
    assert not result.email_signup_enabled
    assert result.oauth_provider_count == 2
    assert result.relevant_advisor_count == 2


def test_live_shape_email_signup_fails_every_required_control():
    result = gate.evaluate(
        gate.load_contract(),
        auth_config(external_email_enabled=True),
        disabled_control_advisors(),
    )

    assert not result.ok
    assert result.mode == "email"
    assert result.email_signup_enabled
    assert result.codes == (
        "email_autoconfirm_enabled",
        "leaked_password_protection_disabled",
        "mfa_totp_unavailable",
        "password_min_length_low",
    )


def test_hardened_email_auth_passes_with_or_without_new_signup():
    contract = gate.load_contract()
    secure = dict(
        external_email_enabled=True,
        mailer_autoconfirm=False,
        mfa_totp_enroll_enabled=True,
        mfa_totp_verify_enabled=True,
        password_hibp_enabled=True,
        password_min_length=8,
    )
    for disable_signup in (False, True):
        result = gate.evaluate(
            contract,
            auth_config(disable_signup=disable_signup, **secure),
            advisors("unrelated_synthetic_advisor"),
        )
        assert result.ok
        assert result.mode == "email"
        assert result.email_signup_enabled is not disable_signup


def test_no_approved_provider_fails_closed():
    result = gate.evaluate(
        gate.load_contract(),
        auth_config(
            external_github_enabled=False,
            external_google_enabled=False,
        ),
        disabled_control_advisors(),
    )
    assert result.codes == ("no_approved_login_provider",)


@pytest.mark.parametrize(
    "provider",
    [
        "external_phone_enabled",
        "external_anonymous_users_enabled",
        "external_facebook_enabled",
        "external_web3_ethereum_enabled",
    ],
)
def test_non_product_provider_can_never_pass_as_oauth_only(provider):
    result = gate.evaluate(
        gate.load_contract(),
        auth_config(**{provider: True}),
        disabled_control_advisors(),
    )
    assert result.mode == "unsupported"
    assert result.codes == ("unsupported_auth_provider_enabled",)


def test_new_or_missing_provider_field_requires_a_versioned_contract_update():
    contract = gate.load_contract()
    new_provider = auth_config(external_synthetic_enabled=False)
    with pytest.raises(gate.GateError, match="auth_provider_set_changed"):
        gate.evaluate(contract, new_provider, disabled_control_advisors())

    missing_provider = auth_config()
    del missing_provider["external_phone_enabled"]
    with pytest.raises(gate.GateError, match="auth_provider_set_changed"):
        gate.evaluate(contract, missing_provider, disabled_control_advisors())

    with pytest.raises(gate.GateError, match="auth_provider_set_changed"):
        gate.evaluate(contract, {}, disabled_control_advisors())


@pytest.mark.parametrize(
    "config",
    [
        auth_config(external_email_enabled="false"),
        auth_config(password_min_length=True),
        auth_config(external_google_enabled=None),
    ],
)
def test_missing_or_wrong_typed_config_fails_closed(config):
    with pytest.raises(gate.GateError, match="auth_config_invalid"):
        gate.evaluate(gate.load_contract(), config, disabled_control_advisors())


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"lints": [], "unknown": []},
        [{"title": "missing name"}],
        [{"name": "bad name"}],
        [
            {"name": "auth_leaked_password_protection"},
            {"name": "auth_leaked_password_protection"},
        ],
    ],
)
def test_malformed_or_duplicate_advisors_fail_closed(payload):
    with pytest.raises(gate.GateError, match="advisors_invalid"):
        gate.evaluate(gate.load_contract(), auth_config(), payload)


def test_advisor_and_config_must_independently_agree():
    result = gate.evaluate(gate.load_contract(), auth_config(), advisors())
    assert result.codes == ("advisor_config_mismatch",)

    result = gate.evaluate(
        gate.load_contract(),
        auth_config(
            mfa_totp_enroll_enabled=True,
            mfa_totp_verify_enabled=True,
            password_hibp_enabled=True,
        ),
        disabled_control_advisors(),
    )
    assert result.codes == ("advisor_config_mismatch",)


def test_live_transport_is_two_fixed_gets_and_keeps_token_out_of_argv(monkeypatch):
    contract = gate.load_contract()
    token = "sbp_" + "a" * 24
    project_ref = "abcdefghijklmnopqrst"
    monkeypatch.setenv("SUPABASE_ACCESS_TOKEN", token)
    monkeypatch.setenv("SUPABASE_PROJECT_REF", project_ref)
    calls = []

    def run(args, **kwargs):
        calls.append((args, kwargs))
        request = kwargs["input"].decode()
        if "/config/auth" in request:
            payload = auth_config()
        elif "/advisors/security" in request:
            payload = disabled_control_advisors()
        else:  # pragma: no cover - assertion below is the oracle
            payload = {"unexpected": True}
        return subprocess.CompletedProcess(args, 0, json.dumps(payload).encode(), b"")

    result = gate.run_live(
        contract,
        fetch_json=lambda url, access_token: gate._fetch_json(
            url, access_token, run=run
        ),
    )

    assert result.ok
    assert len(calls) == 2
    for args, kwargs in calls:
        request = kwargs["input"].decode()
        assert args == ["curl", "-q", "--config", "-"]
        assert token not in " ".join(args)
        assert 'request = "GET"' in request
        assert 'proto = "=https"' in request
        assert f"max-filesize = {gate.MAX_DOCUMENT_BYTES}" in request
        assert "PATCH" not in request
        assert "POST" not in request
        assert kwargs["capture_output"] is True
        assert kwargs["check"] is False
        assert "SUPABASE_ACCESS_TOKEN" not in kwargs["env"]
        assert "SUPABASE_PROJECT_REF" not in kwargs["env"]
    assert f"{gate.API_ORIGIN}/v1/projects/{project_ref}/config/auth" in calls[0][1][
        "input"
    ].decode()
    assert (
        f"{gate.API_ORIGIN}/v1/projects/{project_ref}/advisors/security"
        in calls[1][1]["input"].decode()
    )


def test_runtime_transport_failure_never_echoes_raw_output_or_credentials(tmp_path):
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    fake_curl = fake_bin / "curl"
    fake_curl.write_text(
        "#!/bin/sh\n"
        "cat >/dev/null\n"
        "printf '%s' 'synthetic-session /private/synthetic-path'\n"
        "printf '%s' ' synthetic-secret-host' >&2\n"
        "exit 7\n"
    )
    fake_curl.chmod(0o755)
    secret_token = "sbp_" + "z" * 24
    env = {
        **os.environ,
        "PATH": f"{fake_bin}:{os.environ['PATH']}",
        "SUPABASE_ACCESS_TOKEN": secret_token,
        "SUPABASE_PROJECT_REF": "abcdefghijklmnopqrst",
    }
    completed = subprocess.run(
        [sys.executable, str(SCRIPT), "live"],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    output = completed.stdout + completed.stderr

    assert completed.returncode == 1
    assert output.strip() == (
        "auth_security_gate status=fail mode=unknown codes=transport_error"
    )
    for secret in (
        secret_token,
        "abcdefghijklmnopqrst",
        "synthetic-session",
        "/private/synthetic-path",
        "synthetic-secret-host",
    ):
        assert secret not in output


def test_fixture_cli_reduces_extra_remote_fields_to_versioned_codes(tmp_path):
    config = auth_config(
        external_email_enabled=True,
        synthetic_private_url="https://synthetic-secret-host/private",
    )
    advisor_rows = disabled_control_advisors()
    advisor_rows[0]["description"] = "synthetic-session /private/synthetic-path"
    config_path = tmp_path / "synthetic-secret-config.json"
    advisors_path = tmp_path / "synthetic-secret-advisors.json"
    config_path.write_text(json.dumps(config))
    advisors_path.write_text(json.dumps(advisor_rows))

    completed = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "evaluate",
            "--config",
            str(config_path),
            "--advisors",
            str(advisors_path),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    output = completed.stdout + completed.stderr

    assert completed.returncode == 1
    assert "mode=email" in output
    assert (
        "codes=email_autoconfirm_enabled,leaked_password_protection_disabled"
        in output
    )
    for raw_value in (
        "synthetic-secret-host",
        "synthetic-session",
        "/private/synthetic-path",
        str(config_path),
        str(advisors_path),
    ):
        assert raw_value not in output


def test_contract_is_pinned_and_cannot_be_selected_by_cli(capsys):
    contract = gate.load_contract()
    assert contract.contract_id == "f-02-f-08-auth-posture-v1"
    assert contract.minimum_password_length == 8

    with pytest.raises(SystemExit) as error:
        gate.main(["live", "--contract", "/tmp/weaker.json"])
    assert error.value.code == 2
    assert "unrecognized arguments" in capsys.readouterr().err


def test_contract_rejects_weaker_provider_or_advisor_identity(tmp_path, monkeypatch):
    original = json.loads(gate.CONTRACT_PATH.read_text())
    variants = []

    weaker_provider = dict(original)
    weaker_provider["approved_oauth_provider_fields"] = [
        "external_facebook_enabled"
    ]
    variants.append(weaker_provider)

    renamed_advisor = dict(original)
    renamed_advisor["advisor_config_contract"] = {
        "synthetic_insufficient_mfa": "totp_unavailable",
        "synthetic_leaked_passwords": "hibp_disabled",
    }
    variants.append(renamed_advisor)

    for index, variant in enumerate(variants):
        changed = tmp_path / f"changed-{index}.json"
        changed.write_text(json.dumps(variant))
        monkeypatch.setattr(gate, "CONTRACT_PATH", changed)
        with pytest.raises(gate.GateError, match="contract_invalid"):
            gate.load_contract()


def test_invalid_explicit_credentials_never_fall_back(monkeypatch):
    calls = []

    def run(*args, **kwargs):
        calls.append((args, kwargs))
        raise AssertionError("credential fallback must not run")

    monkeypatch.setenv("SUPABASE_ACCESS_TOKEN", "invalid")
    with pytest.raises(gate.GateError, match="credentials_unavailable"):
        gate._resolve_access_token(run=run)
    assert calls == []

    monkeypatch.setenv("SUPABASE_PROJECT_REF", "invalid")
    with pytest.raises(gate.GateError, match="project_link_unavailable"):
        gate._resolve_project_ref()
