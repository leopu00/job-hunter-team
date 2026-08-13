#!/usr/bin/env python3
"""Fail-closed, read-only gate for the live Supabase Auth posture.

Only two fixed Management API GETs are allowed. Remote responses and command
diagnostics stay private; the public result contains only versioned codes and
aggregate counts.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "supabase/auth-security-contract.v1.json"
LINKED_PROJECT_REF = ROOT / "supabase/.temp/project-ref"
API_ORIGIN = "https://api.supabase.com"
AUTH_CONFIG_ENDPOINT = "/v1/projects/{project_ref}/config/auth"
SECURITY_ADVISORS_ENDPOINT = "/v1/projects/{project_ref}/advisors/security"
MAX_DOCUMENT_BYTES = 256 * 1024
PROJECT_REF_RE = re.compile(r"^[a-z0-9]{20}$")
ACCESS_TOKEN_RE = re.compile(r"^sbp_[A-Za-z0-9_-]{20,4096}$")
ENDPOINT_RE = re.compile(
    re.escape(API_ORIGIN)
    + r"/v1/projects/[a-z0-9]{20}/(?:config/auth|advisors/security)$"
)
FIELD_RE = re.compile(r"^[a-z][a-z0-9_]{2,80}$")
PROVIDER_FIELD_RE = re.compile(r"^external_[a-z0-9_]+_enabled$")
CONTRACT_ID_RE = re.compile(r"^[a-z0-9][a-z0-9.-]{2,80}$")
SAFE_CODE_RE = re.compile(r"^[a-z][a-z0-9_]{2,80}$")


class GateError(RuntimeError):
    """A finite error classification safe to expose in logs."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class Contract:
    contract_id: str
    approved_oauth_provider_fields: tuple[str, ...]
    known_external_provider_fields: tuple[str, ...]
    required_boolean_fields: tuple[str, ...]
    required_integer_fields: tuple[str, ...]
    minimum_password_length: int
    advisor_config_contract: tuple[tuple[str, str], ...]


@dataclass(frozen=True)
class GateResult:
    contract_id: str
    mode: str
    email_signup_enabled: bool
    oauth_provider_count: int
    relevant_advisor_count: int
    codes: tuple[str, ...]

    @property
    def ok(self) -> bool:
        return not self.codes


RunCommand = Callable[..., subprocess.CompletedProcess[bytes]]
FetchJson = Callable[[str, str], object]


def _decode_json(raw: bytes, error_code: str) -> object:
    if len(raw) > MAX_DOCUMENT_BYTES:
        raise GateError(error_code)

    def object_pairs(pairs: list[tuple[str, object]]) -> dict[str, object]:
        result: dict[str, object] = {}
        for key, value in pairs:
            if key in result:
                raise GateError(error_code)
            result[key] = value
        return result

    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=object_pairs)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise GateError(error_code) from exc


def _read_json(path: Path, error_code: str) -> object:
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise GateError(error_code) from exc
    return _decode_json(raw, error_code)


def load_contract() -> Contract:
    document = _read_json(CONTRACT_PATH, "contract_invalid")
    expected_keys = {
        "schema_version",
        "contract_id",
        "approved_oauth_provider_fields",
        "known_external_provider_fields",
        "required_boolean_fields",
        "required_integer_fields",
        "minimum_password_length",
        "advisor_config_contract",
    }
    if not isinstance(document, dict) or set(document) != expected_keys:
        raise GateError("contract_invalid")
    contract_id = document.get("contract_id")
    oauth_fields = document.get("approved_oauth_provider_fields")
    known_provider_fields = document.get("known_external_provider_fields")
    boolean_fields = document.get("required_boolean_fields")
    integer_fields = document.get("required_integer_fields")
    minimum = document.get("minimum_password_length")
    advisor_contract = document.get("advisor_config_contract")
    if (
        document.get("schema_version") != 1
        or not isinstance(contract_id, str)
        or contract_id != "f-02-f-08-auth-posture-v1"
        or not CONTRACT_ID_RE.fullmatch(contract_id)
        or not _valid_field_list(oauth_fields)
        or set(oauth_fields) != {
            "external_github_enabled",
            "external_google_enabled",
        }
        or not _valid_field_list(known_provider_fields)
        or any(
            not PROVIDER_FIELD_RE.fullmatch(field)
            for field in known_provider_fields
        )
        or not set(oauth_fields) < set(known_provider_fields)
        or "external_email_enabled" not in known_provider_fields
        or "external_phone_enabled" not in known_provider_fields
        or "external_anonymous_users_enabled" not in known_provider_fields
        or not _valid_field_list(boolean_fields)
        or not _valid_field_list(integer_fields)
        or not isinstance(minimum, int)
        or isinstance(minimum, bool)
        or minimum < 8
        or minimum > 128
        or not isinstance(advisor_contract, dict)
        or len(advisor_contract) != 2
        or any(
            not isinstance(name, str)
            or not FIELD_RE.fullmatch(name)
            or not isinstance(condition, str)
            or not SAFE_CODE_RE.fullmatch(condition)
            for name, condition in advisor_contract.items()
        )
        or advisor_contract
        != {
            "auth_insufficient_mfa_options": "totp_unavailable",
            "auth_leaked_password_protection": "hibp_disabled",
        }
    ):
        raise GateError("contract_invalid")
    required = set(boolean_fields)
    if required != {
        "disable_signup",
        "external_email_enabled",
        "mailer_autoconfirm",
        "mfa_totp_enroll_enabled",
        "mfa_totp_verify_enabled",
        "password_hibp_enabled",
    } or set(integer_fields) != {"password_min_length"}:
        raise GateError("contract_invalid")
    return Contract(
        contract_id=contract_id,
        approved_oauth_provider_fields=tuple(oauth_fields),
        known_external_provider_fields=tuple(known_provider_fields),
        required_boolean_fields=tuple(boolean_fields),
        required_integer_fields=tuple(integer_fields),
        minimum_password_length=minimum,
        advisor_config_contract=tuple(sorted(advisor_contract.items())),
    )


def _valid_field_list(value: object) -> bool:
    return (
        isinstance(value, list)
        and bool(value)
        and value == sorted(value)
        and len(value) == len(set(value))
        and all(isinstance(field, str) and FIELD_RE.fullmatch(field) for field in value)
    )


def _advisor_name_counts(payload: object) -> dict[str, int]:
    if isinstance(payload, dict) and set(payload) == {"lints"}:
        payload = payload.get("lints")
    if not isinstance(payload, list):
        raise GateError("advisors_invalid")
    names: dict[str, int] = {}
    for row in payload:
        if not isinstance(row, dict):
            raise GateError("advisors_invalid")
        name = row.get("name")
        if not isinstance(name, str) or not FIELD_RE.fullmatch(name):
            raise GateError("advisors_invalid")
        names[name] = names.get(name, 0) + 1
    return names


def evaluate(contract: Contract, config: object, advisors: object) -> GateResult:
    if not isinstance(config, dict):
        raise GateError("auth_config_invalid")
    observed_provider_fields = {
        field
        for field in config
        if isinstance(field, str) and PROVIDER_FIELD_RE.fullmatch(field)
    }
    if observed_provider_fields != set(contract.known_external_provider_fields):
        raise GateError("auth_provider_set_changed")
    required_booleans = (
        contract.required_boolean_fields + contract.known_external_provider_fields
    )
    for field in required_booleans:
        if not isinstance(config.get(field), bool):
            raise GateError("auth_config_invalid")
    for field in contract.required_integer_fields:
        value = config.get(field)
        if not isinstance(value, int) or isinstance(value, bool):
            raise GateError("auth_config_invalid")

    advisor_counts = _advisor_name_counts(advisors)
    relevant = {name for name, _ in contract.advisor_config_contract}
    if any(advisor_counts.get(name, 0) > 1 for name in relevant):
        raise GateError("advisors_invalid")
    relevant_present = set(advisor_counts) & relevant
    expected_conditions = {
        "hibp_disabled": not config["password_hibp_enabled"],
        "totp_unavailable": not (
            config["mfa_totp_enroll_enabled"]
            and config["mfa_totp_verify_enabled"]
        ),
    }
    codes: set[str] = set()
    for advisor_name, condition in contract.advisor_config_contract:
        if (advisor_name in advisor_counts) != expected_conditions[condition]:
            codes.add("advisor_config_mismatch")

    oauth_count = sum(
        1 for field in contract.approved_oauth_provider_fields if config[field]
    )
    email_enabled = config["external_email_enabled"]
    email_signup_enabled = email_enabled and not config["disable_signup"]
    conditionally_allowed = set(contract.approved_oauth_provider_fields) | {
        "external_email_enabled"
    }
    unsupported_enabled = any(
        config[field]
        for field in contract.known_external_provider_fields
        if field not in conditionally_allowed
    )
    if unsupported_enabled:
        codes.add("unsupported_auth_provider_enabled")

    if email_enabled:
        mode = "email"
        if config["mailer_autoconfirm"]:
            codes.add("email_autoconfirm_enabled")
        if not config["password_hibp_enabled"]:
            codes.add("leaked_password_protection_disabled")
        if config["password_min_length"] < contract.minimum_password_length:
            codes.add("password_min_length_low")
        if not (
            config["mfa_totp_enroll_enabled"]
            and config["mfa_totp_verify_enabled"]
        ):
            codes.add("mfa_totp_unavailable")
    else:
        mode = "oauth-only"
        if oauth_count == 0:
            codes.add("no_approved_login_provider")
    if unsupported_enabled:
        mode = "unsupported"

    return GateResult(
        contract_id=contract.contract_id,
        mode=mode,
        email_signup_enabled=email_signup_enabled,
        oauth_provider_count=oauth_count,
        relevant_advisor_count=len(relevant_present),
        codes=tuple(sorted(codes)),
    )


def _resolve_access_token(run: RunCommand = subprocess.run) -> str:
    if "SUPABASE_ACCESS_TOKEN" in os.environ:
        token = os.environ["SUPABASE_ACCESS_TOKEN"]
        if not ACCESS_TOKEN_RE.fullmatch(token):
            raise GateError("credentials_unavailable")
        return token
    try:
        completed = run(
            ["security", "find-generic-password", "-s", "Supabase CLI", "-w"],
            capture_output=True,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise GateError("credentials_unavailable") from exc
    if completed.returncode != 0:
        raise GateError("credentials_unavailable")
    try:
        if len(completed.stdout) > 8192:
            raise ValueError("oversized credential record")
        stored = completed.stdout.decode("utf-8").strip()
        _, encoded = stored.split(":", 1)
        token = base64.b64decode(encoded, validate=True).decode("utf-8").strip()
    except (ValueError, UnicodeDecodeError) as exc:
        raise GateError("credentials_unavailable") from exc
    if not ACCESS_TOKEN_RE.fullmatch(token):
        raise GateError("credentials_unavailable")
    return token


def _resolve_project_ref() -> str:
    if "SUPABASE_PROJECT_REF" in os.environ:
        project_ref = os.environ["SUPABASE_PROJECT_REF"]
    else:
        try:
            project_ref = LINKED_PROJECT_REF.read_text(encoding="utf-8").strip()
        except OSError as exc:
            raise GateError("project_link_unavailable") from exc
    if not PROJECT_REF_RE.fullmatch(project_ref):
        raise GateError("project_link_unavailable")
    return project_ref


def _fetch_json(
    url: str, access_token: str, run: RunCommand = subprocess.run
) -> object:
    if not ENDPOINT_RE.fullmatch(url) or not ACCESS_TOKEN_RE.fullmatch(access_token):
        raise GateError("transport_invalid")
    curl_config = "\n".join(
        (
            "silent",
            "show-error",
            "fail",
            "connect-timeout = 10",
            "max-time = 20",
            f"max-filesize = {MAX_DOCUMENT_BYTES}",
            'proto = "=https"',
            'request = "GET"',
            'user-agent = "jht-auth-security-gate/1"',
            f'header = "Authorization: Bearer {access_token}"',
            'header = "Accept: application/json"',
            f'url = "{url}"',
            "",
        )
    ).encode("utf-8")
    curl_env = dict(os.environ)
    curl_env.pop("SUPABASE_ACCESS_TOKEN", None)
    curl_env.pop("SUPABASE_PROJECT_REF", None)
    try:
        completed = run(
            ["curl", "-q", "--config", "-"],
            input=curl_config,
            capture_output=True,
            env=curl_env,
            timeout=25,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise GateError("transport_error") from exc
    if completed.returncode != 0:
        raise GateError("transport_error")
    return _decode_json(completed.stdout, "remote_response_invalid")


def run_live(
    contract: Contract,
    *,
    fetch_json: FetchJson = _fetch_json,
) -> GateResult:
    access_token = _resolve_access_token()
    project_ref = _resolve_project_ref()
    config_url = API_ORIGIN + AUTH_CONFIG_ENDPOINT.format(project_ref=project_ref)
    advisors_url = API_ORIGIN + SECURITY_ADVISORS_ENDPOINT.format(
        project_ref=project_ref
    )
    config = fetch_json(config_url, access_token)
    advisors = fetch_json(advisors_url, access_token)
    return evaluate(contract, config, advisors)


def _print_result(result: GateResult) -> int:
    status = "pass" if result.ok else "fail"
    signup = "enabled" if result.email_signup_enabled else "disabled"
    codes = "none" if result.ok else ",".join(result.codes)
    line = (
        f"auth_security_gate status={status} contract={result.contract_id} "
        f"mode={result.mode} email_signup={signup} "
        f"oauth_providers={result.oauth_provider_count} "
        f"relevant_advisors={result.relevant_advisor_count} codes={codes}"
    )
    print(line, file=sys.stdout if result.ok else sys.stderr)
    return 0 if result.ok else 1


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("live", help="run the two fixed read-only live checks")
    evaluate_parser = subparsers.add_parser(
        "evaluate", help="evaluate synthetic captured-shape fixtures"
    )
    evaluate_parser.add_argument("--config", required=True, type=Path)
    evaluate_parser.add_argument("--advisors", required=True, type=Path)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        contract = load_contract()
        if args.command == "live":
            result = run_live(contract)
        else:
            config = _read_json(args.config, "auth_config_invalid")
            advisors = _read_json(args.advisors, "advisors_invalid")
            result = evaluate(contract, config, advisors)
        return _print_result(result)
    except GateError as exc:
        print(
            f"auth_security_gate status=fail mode=unknown codes={exc.code}",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
