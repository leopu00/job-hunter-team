#!/usr/bin/env python3
"""Detached RSA signing interface for Job Hunter Team release manifests.

Production custody is intentionally provider-neutral and selected outside this
repository. ``sign-offline`` exists for an operator-controlled offline vault
and for synthetic tests; the release workflow must never invoke it with a
GitHub secret or exported key.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import re
import stat
import subprocess
import tempfile
from pathlib import Path

try:
    from scripts.release_manifest import (
        MAX_MANIFEST_BYTES,
        ReleaseManifestError,
        parse_manifest_bytes,
    )
except ModuleNotFoundError:  # direct ``python scripts/release_signing.py``
    from release_manifest import (  # type: ignore[no-redef]
        MAX_MANIFEST_BYTES,
        ReleaseManifestError,
        parse_manifest_bytes,
    )


SIGNATURE_BYTES = 384
HELPER_PUBLIC_KEY_PLACEHOLDER = "__JHT_RELEASE_PUBLIC_KEYS_SPKI_PEM__"


class ReleaseSigningError(RuntimeError):
    """Signature production or verification failed closed."""


def _run(command: list[str], *, input_bytes: bytes | None = None) -> bytes:
    try:
        result = subprocess.run(
            command,
            input=input_bytes,
            capture_output=True,
            check=False,
            timeout=60,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ReleaseSigningError(f"signing tool unavailable: {command[0]}") from exc
    if result.returncode != 0:
        # Provider output can contain project/account details.  Keep the public
        # error stable and do not forward stderr into CI or the product.
        raise ReleaseSigningError(f"signing tool failed: {command[0]}")
    return result.stdout


def _der_length(raw: bytes, offset: int) -> tuple[int, int]:
    if offset >= len(raw):
        raise ReleaseSigningError("public key DER is truncated")
    first = raw[offset]
    offset += 1
    if first < 0x80:
        return first, offset
    count = first & 0x7F
    if count < 1 or count > 4 or offset + count > len(raw) or raw[offset] == 0:
        raise ReleaseSigningError("public key DER length is invalid")
    length = int.from_bytes(raw[offset : offset + count], "big")
    if length < 128:
        raise ReleaseSigningError("public key DER length is not canonical")
    return length, offset + count


def _der_element(raw: bytes, offset: int, tag: int) -> tuple[bytes, int]:
    if offset >= len(raw) or raw[offset] != tag:
        raise ReleaseSigningError("public key DER tag is invalid")
    length, value_offset = _der_length(raw, offset + 1)
    end = value_offset + length
    if end > len(raw):
        raise ReleaseSigningError("public key DER value is truncated")
    return raw[value_offset:end], end


def _validate_spki_der(der: bytes) -> None:
    spki, end = _der_element(der, 0, 0x30)
    if end != len(der):
        raise ReleaseSigningError("public key SPKI has trailing bytes")
    algorithm, offset = _der_element(spki, 0, 0x30)
    if algorithm.hex() != "06092a864886f70d0101010500":
        raise ReleaseSigningError("release key must use rsaEncryption SPKI")
    bits, offset = _der_element(spki, offset, 0x03)
    if offset != len(spki) or len(bits) < 2 or bits[0] != 0:
        raise ReleaseSigningError("release key SPKI bit string is invalid")
    rsa, end = _der_element(bits[1:], 0, 0x30)
    if end != len(bits) - 1:
        raise ReleaseSigningError("release RSA key has trailing bytes")
    modulus, offset = _der_element(rsa, 0, 0x02)
    exponent, offset = _der_element(rsa, offset, 0x02)
    if offset != len(rsa):
        raise ReleaseSigningError("release RSA parameters have trailing bytes")
    if len(modulus) == 385 and modulus[0] == 0:
        modulus = modulus[1:]
    if len(modulus) != SIGNATURE_BYTES or not 1 <= len(exponent) <= 4:
        raise ReleaseSigningError("release key must be RSA-3072")


def _public_key_der_from_file(public_key: Path, *, openssl: str) -> bytes:
    der = _run([openssl, "pkey", "-pubin", "-in", str(public_key), "-outform", "DER"])
    if not der or len(der) > 1024:
        raise ReleaseSigningError("public key DER is invalid")
    _validate_spki_der(der)
    return der


def _read_public_key(public_key: Path) -> bytes:
    try:
        raw = public_key.read_bytes()
    except OSError as exc:
        raise ReleaseSigningError("public key is unreadable") from exc
    if not raw or len(raw) > 16_384:
        raise ReleaseSigningError("public key is missing or oversized")
    return raw


def public_key_der(public_key: Path, *, openssl: str = "openssl") -> bytes:
    raw = _read_public_key(public_key)
    with tempfile.TemporaryDirectory(prefix="jht-release-public-") as temp_dir:
        snapshot = Path(temp_dir) / "public.pem"
        snapshot.write_bytes(raw)
        return _public_key_der_from_file(snapshot, openssl=openssl)


def public_key_id(public_key: Path, *, openssl: str = "openssl") -> str:
    return hashlib.sha256(public_key_der(public_key, openssl=openssl)).hexdigest()


def _read_manifest_raw(path: Path) -> bytes:
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise ReleaseSigningError("release manifest is unreadable") from exc
    if not raw or len(raw) > MAX_MANIFEST_BYTES:
        raise ReleaseSigningError("release manifest size is invalid")
    return raw


def _read_signature(path: Path) -> bytes:
    try:
        signature = path.read_bytes()
    except OSError as exc:
        raise ReleaseSigningError("release signature is unreadable") from exc
    if len(signature) != SIGNATURE_BYTES:
        raise ReleaseSigningError("release signature must be exactly 384 bytes")
    return signature


def _read_private_key_secure(path: Path) -> bytes:
    if os.name != "posix":
        raise ReleaseSigningError(
            "offline private-key signing requires a POSIX custody host"
        )
    if path.is_symlink():
        raise ReleaseSigningError("offline private key is unavailable")
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(path, flags)
    except OSError as exc:
        raise ReleaseSigningError("offline private key is unavailable") from exc
    try:
        identity = os.fstat(descriptor)
        if not stat.S_ISREG(identity.st_mode):
            raise ReleaseSigningError("offline private key is not a regular file")
        if identity.st_uid != os.getuid():
            raise ReleaseSigningError("offline private key owner is not current user")
        if identity.st_mode & 0o077:
            raise ReleaseSigningError("offline private key permissions are too broad")
        with os.fdopen(descriptor, "rb", closefd=False) as handle:
            raw = handle.read(65_537)
        after = os.fstat(descriptor)
        if (
            identity.st_dev,
            identity.st_ino,
            identity.st_size,
            identity.st_mtime_ns,
            identity.st_ctime_ns,
        ) != (
            after.st_dev,
            after.st_ino,
            after.st_size,
            after.st_mtime_ns,
            after.st_ctime_ns,
        ):
            raise ReleaseSigningError("offline private key changed while reading")
    finally:
        os.close(descriptor)
    if not raw or len(raw) > 65_536:
        raise ReleaseSigningError("offline private key is invalid")
    return raw


def _verify_snapshot(
    *, raw: bytes, signature: bytes, public_key_raw: bytes, openssl: str
) -> dict[str, object]:
    if len(signature) != SIGNATURE_BYTES:
        raise ReleaseSigningError("release signature must be exactly 384 bytes")
    with tempfile.TemporaryDirectory(prefix="jht-release-verify-") as temp_dir:
        snapshot = Path(temp_dir)
        manifest_copy = snapshot / "RELEASE-MANIFEST.json"
        signature_copy = snapshot / "RELEASE-MANIFEST.json.sig"
        key_copy = snapshot / "release-public.pem"
        manifest_copy.write_bytes(raw)
        signature_copy.write_bytes(signature)
        key_copy.write_bytes(public_key_raw)
        key_id = hashlib.sha256(
            _public_key_der_from_file(key_copy, openssl=openssl)
        ).hexdigest()
        try:
            result = subprocess.run(
                [
                    openssl,
                    "dgst",
                    "-sha256",
                    "-verify",
                    str(key_copy),
                    "-signature",
                    str(signature_copy),
                    str(manifest_copy),
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
                timeout=60,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise ReleaseSigningError("signature verifier is unavailable") from exc
    if result.returncode != 0:
        raise ReleaseSigningError("release signature verification failed")
    try:
        value = parse_manifest_bytes(raw)
    except ReleaseManifestError as exc:
        raise ReleaseSigningError(str(exc)) from exc
    if value["key_id"] != key_id:
        raise ReleaseSigningError("manifest key_id does not match embedded SPKI")
    return value


def _atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        dir=path.parent, prefix=f".{path.name}.", suffix=".tmp"
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            os.chmod(temporary, 0o600)
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def verify_release_signature(
    *,
    manifest: Path,
    signature: Path,
    public_key: Path,
    openssl: str = "openssl",
) -> dict[str, object]:
    raw = _read_manifest_raw(manifest)
    signature_bytes = _read_signature(signature)
    return _verify_snapshot(
        raw=raw,
        signature=signature_bytes,
        public_key_raw=_read_public_key(public_key),
        openssl=openssl,
    )


def sign_offline(
    *,
    manifest: Path,
    signature: Path,
    private_key: Path,
    public_key: Path,
    expected_tag: str,
    expected_commit: str,
    expected_manifest_sha256: str,
    minimum_sequence: int,
    openssl: str = "openssl",
) -> None:
    # Validate canonical bytes and key binding before asking a private-key
    # operation to sign anything.
    raw = _read_manifest_raw(manifest)
    try:
        value = parse_manifest_bytes(raw)
    except ReleaseManifestError as exc:
        raise ReleaseSigningError(str(exc)) from exc
    actual_manifest_sha256 = hashlib.sha256(raw).hexdigest()
    if not re.fullmatch(r"[0-9a-f]{64}", expected_manifest_sha256):
        raise ReleaseSigningError("expected manifest SHA-256 is invalid")
    if actual_manifest_sha256 != expected_manifest_sha256:
        raise ReleaseSigningError("manifest differs from authorized signing request")
    if value["tag"] != expected_tag or value["commit"] != expected_commit:
        raise ReleaseSigningError("manifest release identity was not authorized")
    if isinstance(minimum_sequence, bool) or not isinstance(minimum_sequence, int):
        raise ReleaseSigningError("minimum sequence must be an integer")
    if minimum_sequence < 0 or value["sequence"] <= minimum_sequence:
        raise ReleaseSigningError("manifest sequence does not advance signing floor")
    public_key_raw = _read_public_key(public_key)
    with tempfile.TemporaryDirectory(prefix="jht-release-offline-key-") as key_dir:
        key_snapshot = Path(key_dir) / "public.pem"
        key_snapshot.write_bytes(public_key_raw)
        key_id = hashlib.sha256(
            _public_key_der_from_file(key_snapshot, openssl=openssl)
        ).hexdigest()
    if value["key_id"] != key_id:
        raise ReleaseSigningError("manifest key_id does not match signing key")
    private_key_raw = _read_private_key_secure(private_key)

    with tempfile.TemporaryDirectory(prefix="jht-release-offline-sign-") as temp_dir:
        temp = Path(temp_dir)
        manifest_snapshot = temp / "RELEASE-MANIFEST.json"
        private_snapshot = temp / "private.pem"
        temporary = temp / "RELEASE-MANIFEST.json.sig"
        manifest_snapshot.write_bytes(raw)
        private_snapshot.write_bytes(private_key_raw)
        private_snapshot.chmod(0o600)
        _run(
            [
                openssl,
                "dgst",
                "-sha256",
                "-sign",
                str(private_snapshot),
                "-out",
                str(temporary),
                str(manifest_snapshot),
            ]
        )
        signed = _read_signature(temporary)
        _verify_snapshot(
            raw=raw,
            signature=signed,
            public_key_raw=public_key_raw,
            openssl=openssl,
        )
    _atomic_write(signature, signed)


def render_helper(
    *,
    template: Path,
    output: Path,
    public_key: Path,
    additional_public_keys: tuple[Path, ...] = (),
    openssl: str = "openssl",
) -> None:
    public_keys = (public_key, *additional_public_keys)
    if not 1 <= len(public_keys) <= 2:
        raise ReleaseSigningError("helper keyring must contain one or two keys")
    try:
        source = template.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise ReleaseSigningError("helper template is unreadable") from exc
    if source.count(HELPER_PUBLIC_KEY_PLACEHOLDER) != 1:
        raise ReleaseSigningError("helper public-key placeholder count is not one")
    rendered_keys: list[str] = []
    fingerprints: set[str] = set()
    for path in public_keys:
        try:
            pem = path.read_text(encoding="ascii").strip()
        except (OSError, UnicodeError) as exc:
            raise ReleaseSigningError("helper public key is unreadable") from exc
        if not re.fullmatch(
            r"-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/=\n]+\n-----END PUBLIC KEY-----",
            pem,
        ):
            raise ReleaseSigningError("public key is not canonical SPKI PEM")
        fingerprint = public_key_id(path, openssl=openssl)
        if fingerprint in fingerprints:
            raise ReleaseSigningError("helper keyring contains a duplicate key")
        fingerprints.add(fingerprint)
        escaped = pem.replace("`", "``").replace('"', '`"').replace("\n", "`n")
        rendered_keys.append(f'  "{escaped}"')
    rendered = source.replace(HELPER_PUBLIC_KEY_PLACEHOLDER, ",\n".join(rendered_keys))
    _atomic_write(output, rendered.encode("utf-8"))


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--openssl", default="openssl")
    subparsers = parser.add_subparsers(dest="command", required=True)

    fingerprint = subparsers.add_parser("fingerprint")
    fingerprint.add_argument("--public-key", type=Path, required=True)

    verify = subparsers.add_parser("verify")
    verify.add_argument("--manifest", type=Path, required=True)
    verify.add_argument("--signature", type=Path, required=True)
    verify.add_argument("--public-key", type=Path, required=True)

    offline = subparsers.add_parser("sign-offline")
    offline.add_argument("--manifest", type=Path, required=True)
    offline.add_argument("--signature", type=Path, required=True)
    offline.add_argument("--private-key", type=Path, required=True)
    offline.add_argument("--public-key", type=Path, required=True)
    offline.add_argument("--expected-tag", required=True)
    offline.add_argument("--expected-commit", required=True)
    offline.add_argument("--expected-manifest-sha256", required=True)
    offline.add_argument("--minimum-sequence", type=int, required=True)

    render = subparsers.add_parser("render-helper")
    render.add_argument("--template", type=Path, required=True)
    render.add_argument("--output", type=Path, required=True)
    render.add_argument("--public-key", type=Path, required=True)
    render.add_argument(
        "--additional-public-key", type=Path, action="append", default=[]
    )
    return parser


def main() -> int:
    args = _parser().parse_args()
    try:
        if args.command == "fingerprint":
            print(public_key_id(args.public_key, openssl=args.openssl))
        elif args.command == "verify":
            value = verify_release_signature(
                manifest=args.manifest,
                signature=args.signature,
                public_key=args.public_key,
                openssl=args.openssl,
            )
            print(f"verified release {value['version']} sequence {value['sequence']}")
        elif args.command == "sign-offline":
            sign_offline(
                manifest=args.manifest,
                signature=args.signature,
                private_key=args.private_key,
                public_key=args.public_key,
                expected_tag=args.expected_tag,
                expected_commit=args.expected_commit,
                expected_manifest_sha256=args.expected_manifest_sha256,
                minimum_sequence=args.minimum_sequence,
                openssl=args.openssl,
            )
            print("release manifest signed and verified")
        else:
            render_helper(
                template=args.template,
                output=args.output,
                public_key=args.public_key,
                additional_public_keys=tuple(args.additional_public_key),
                openssl=args.openssl,
            )
            print("Windows update helper rendered with pinned SPKI")
    except (OSError, ReleaseSigningError) as exc:
        print(f"release-signing: ERROR: {exc}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
