#!/usr/bin/env python3
"""Fail closed when a Tauri release lacks public Supabase login config.

The Vite URL and anon/publishable key are public client configuration. This
gate never prints them; it only proves that both reached the built web assets
and that no privileged Supabase credential pattern reached the same payload.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
from pathlib import Path
from urllib.parse import urlparse


FORBIDDEN_BYTES = (
    b"sb_secret_",
    b"SUPABASE_SERVICE_ROLE_KEY",
    b"VITE_SUPABASE_SERVICE_ROLE_KEY",
    b"c2VydmljZV9yb2xl",  # base64url for service_role
)
FORBIDDEN_ENV_PARTS = ("SERVICE_ROLE", "SECRET", "PRIVATE", "ADMIN", "DATABASE")


class BundleConfigError(RuntimeError):
    pass


def _jwt_role(value: str) -> str | None:
    parts = value.split(".")
    if len(parts) != 3:
        return None
    try:
        payload = parts[1] + "=" * (-len(parts[1]) % 4)
        decoded = base64.urlsafe_b64decode(payload.encode("ascii"))
        parsed = json.loads(decoded)
    except (ValueError, UnicodeError, json.JSONDecodeError):
        raise BundleConfigError("the Supabase anon key has an invalid JWT payload")
    role = parsed.get("role")
    return role if isinstance(role, str) else None


def validate_public_config(url: str, key: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname or not parsed.hostname.endswith(".supabase.co"):
        raise BundleConfigError("VITE_SUPABASE_URL is missing or is not an HTTPS Supabase project URL")
    if not key:
        raise BundleConfigError("VITE_SUPABASE_ANON_KEY is missing")
    if key.startswith("sb_secret_") or "service_role" in key.lower():
        raise BundleConfigError("a privileged Supabase key was supplied instead of an anon key")
    role = _jwt_role(key)
    if role is not None and role != "anon":
        raise BundleConfigError("the supplied Supabase JWT is not an anon key")
    if role is None and not key.startswith("sb_publishable_"):
        raise BundleConfigError("the Supabase key is neither an anon JWT nor a publishable key")


def verify_paths(paths: list[Path], url: str, key: str) -> None:
    files = [item for path in paths for item in ([path] if path.is_file() else path.rglob("*")) if item.is_file()]
    if not files:
        raise BundleConfigError("no built Tauri assets were found")

    url_bytes = url.encode()
    key_bytes = key.encode()
    found_url = False
    found_key = False
    for file in files:
        data = file.read_bytes()
        if any(marker in data for marker in FORBIDDEN_BYTES):
            raise BundleConfigError(f"privileged credential marker found in bundled file {file.name}")
        found_url = found_url or url_bytes in data
        found_key = found_key or key_bytes in data

    if not found_url or not found_key:
        missing = "URL and anon key" if not found_url and not found_key else ("URL" if not found_url else "anon key")
        raise BundleConfigError(f"built Tauri assets do not contain the configured Supabase {missing}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--path", type=Path, action="append", required=True)
    args = parser.parse_args()

    url = os.environ.get("VITE_SUPABASE_URL", "").strip()
    key = os.environ.get("VITE_SUPABASE_ANON_KEY", "").strip()
    for name in os.environ:
        if name.startswith("VITE_SUPABASE_") and any(part in name for part in FORBIDDEN_ENV_PARTS):
            raise BundleConfigError(f"forbidden privileged build variable is set: {name}")

    validate_public_config(url, key)
    verify_paths(args.path, url, key)
    print("[tauri-login-bundle] OK — public login configuration is present; no privileged key marker found")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BundleConfigError as exc:
        print(f"[tauri-login-bundle] ERROR: {exc}", file=os.sys.stderr)
        raise SystemExit(1)
