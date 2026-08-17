#!/usr/bin/env python3
"""Attesta i byte checkout delle trust root Windows prima dell'import Godot."""

from __future__ import annotations

import argparse
import base64
import binascii
import hashlib
from pathlib import Path
import subprocess
import sys


EXPECTED_FINGERPRINT = (
    "3ab73bd9203a2e4f5d01a61bfecbb2bd891663164732a647af8c9164da97a0b2"
)
EXPECTED_SIZE = 625
EXPECTED_LF = 11
KEY_PATHS = (
    "scripts/release-keys/production-spki.pem",
    "game/release-keys/production-spki.pem",
)
REPO_ROOT = Path(__file__).resolve().parents[2]


def _attributes(path: str) -> dict[str, str]:
    result = subprocess.run(
        ["git", "-C", str(REPO_ROOT), "check-attr", "text", "eol", "--", path],
        check=True,
        capture_output=True,
        text=True,
    )
    attributes: dict[str, str] = {}
    for line in result.stdout.splitlines():
        _checked_path, name, value = line.split(": ", 2)
        attributes[name] = value
    return attributes


def _spki_der(raw: bytes) -> bytes:
    if raw.startswith(b"\xef\xbb\xbf") or b"\r" in raw or not raw.endswith(b"\n"):
        raise ValueError("PEM non canonico: BOM/CR/final-LF")
    lines = raw[:-1].split(b"\n")
    if (
        len(lines) < 3
        or lines[0] != b"-----BEGIN PUBLIC KEY-----"
        or lines[-1] != b"-----END PUBLIC KEY-----"
    ):
        raise ValueError("header/footer SPKI non canonici")
    body_lines = lines[1:-1]
    if any(not line or len(line) > 76 for line in body_lines):
        raise ValueError("body SPKI vuoto o oltre 76 byte")
    body = b"".join(body_lines)
    try:
        der = base64.b64decode(body, validate=True)
    except binascii.Error as error:
        raise ValueError("body SPKI non base64 canonico") from error
    if not der or base64.b64encode(der) != body:
        raise ValueError("round-trip DER/base64 non canonico")
    return der


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default="checkout")
    args = parser.parse_args()

    failures: list[str] = []
    copies: list[bytes] = []
    fingerprints: list[str] = []
    for relative in KEY_PATHS:
        path = REPO_ROOT / relative
        raw = path.read_bytes() if path.is_file() else b""
        copies.append(raw)
        cr = raw.count(b"\r")
        lf = raw.count(b"\n")
        final_lf = int(raw.endswith(b"\n"))
        print(
            "WINDOWS-UPDATE-TRUST-BYTES "
            f"source={args.source} path={relative} present={int(path.is_file())} "
            f"size={len(raw)} cr={cr} lf={lf} final_lf={final_lf}"
        )
        if len(raw) != EXPECTED_SIZE or cr != 0 or lf != EXPECTED_LF or not final_lf:
            failures.append(f"{relative}: byte census non canonico")

        attributes = _attributes(relative)
        print(
            "WINDOWS-UPDATE-TRUST-ATTR "
            f"path={relative} text={attributes.get('text', 'missing')} "
            f"eol={attributes.get('eol', 'missing')}"
        )
        if attributes.get("text") != "set" or attributes.get("eol") != "lf":
            failures.append(f"{relative}: atteso text=set eol=lf")

        try:
            fingerprint = hashlib.sha256(_spki_der(raw)).hexdigest()
        except ValueError as error:
            failures.append(f"{relative}: {error}")
            fingerprint = "invalid"
        fingerprints.append(fingerprint)
        print(
            "WINDOWS-UPDATE-TRUST-FINGERPRINT "
            f"source={args.source} path={relative} value={fingerprint}"
        )
        if fingerprint != EXPECTED_FINGERPRINT:
            failures.append(f"{relative}: fingerprint fuori pin")

    if len(copies) != 2 or copies[0] != copies[1]:
        failures.append("le copie producer/consumer del PEM non coincidono byte-per-byte")
    if len(set(fingerprints)) != 1:
        failures.append("le copie producer/consumer non hanno lo stesso fingerprint")

    if failures:
        for failure in failures:
            print(f"[windows-trust-root-test] {failure}", file=sys.stderr)
        print("WINDOWS-UPDATE-TRUST-CHECKOUT-TEST FAIL")
        return 1
    print("WINDOWS-UPDATE-TRUST-CHECKOUT-TEST PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
