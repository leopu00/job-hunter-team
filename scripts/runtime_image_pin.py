#!/usr/bin/env python3
"""Validate and publish the immutable OCI identity used by a JHT release.

The versioned manifest is the only authority.  Distributed consumers repeat
the digest because they must work without a source checkout; ``verify-tree``
turns those copies into generated-by-contract values and fails on drift.
Registry diagnostics are deliberately finite: raw responses and credentials
never reach workflow output.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 1
MANIFEST_PATH = Path("release/runtime-image.v1.json")
EXPECTED_KEYS = {
    "schema_version",
    "release_version",
    "repository",
    "digest",
    "source_revision",
}
VERSION_RE = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$")
DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
MUTABLE_RELEASE_REF_RE = re.compile(
    r"ghcr\.io/leopu00/jht:(?:\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?|latest|master)"
)
MAX_REGISTRY_BODY = 4 * 1024 * 1024
PINNED_CONSUMERS = (
    Path("docker-compose.yml"),
    Path("game/scripts/backend/payloads/runtime_compose.yml"),
    Path("game/scripts/setup/setup_service.gd"),
    Path("cli/src/commands/container.js"),
    Path("scripts/install.sh"),
    Path("web/public/install.sh"),
    Path("scripts/install.ps1"),
    Path("web/public/install.ps1"),
    Path("scripts/jht-wrapper.sh"),
    Path("scripts/jht-wrapper.ps1"),
    Path("docs/guides/CLI-INSTALL.md"),
    Path(".env.example"),
)
INDEX_ACCEPT = ", ".join(
    (
        "application/vnd.oci.image.index.v1+json",
        "application/vnd.docker.distribution.manifest.list.v2+json",
    )
)
MANIFEST_ACCEPT = ", ".join(
    (
        "application/vnd.oci.image.manifest.v1+json",
        "application/vnd.docker.distribution.manifest.v2+json",
    )
)


class RuntimeImagePinError(RuntimeError):
    """A stable, public error code for a failed release identity gate."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class RuntimeImagePin:
    release_version: str
    repository: str
    digest: str
    source_revision: str

    @property
    def image_ref(self) -> str:
        return f"{self.repository}@{self.digest}"

    @property
    def release_tag_ref(self) -> str:
        return f"{self.repository}:{self.release_version}"


def load_manifest(path: Path) -> RuntimeImagePin:
    try:
        raw = path.read_text(encoding="utf-8")
        data = json.loads(raw)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise RuntimeImagePinError("manifest_invalid") from exc
    if not isinstance(data, dict) or set(data) != EXPECTED_KEYS:
        raise RuntimeImagePinError("manifest_shape")
    if data.get("schema_version") != SCHEMA_VERSION:
        raise RuntimeImagePinError("manifest_schema")
    if not isinstance(data.get("release_version"), str) or not VERSION_RE.fullmatch(
        data["release_version"]
    ):
        raise RuntimeImagePinError("version_invalid")
    if data.get("repository") != "ghcr.io/leopu00/jht":
        raise RuntimeImagePinError("repository_invalid")
    if not isinstance(data.get("digest"), str) or not DIGEST_RE.fullmatch(
        data["digest"]
    ):
        raise RuntimeImagePinError("digest_invalid")
    if not isinstance(data.get("source_revision"), str) or not COMMIT_RE.fullmatch(
        data["source_revision"]
    ):
        raise RuntimeImagePinError("source_revision_invalid")
    canonical = json.dumps(data, indent=2, sort_keys=True) + "\n"
    if raw != canonical:
        raise RuntimeImagePinError("manifest_not_canonical")
    return RuntimeImagePin(
        release_version=data["release_version"],
        repository=data["repository"],
        digest=data["digest"],
        source_revision=data["source_revision"],
    )


def verify_tree(
    root: Path,
    expected_version: str | None = None,
    manifest_path: Path = MANIFEST_PATH,
) -> RuntimeImagePin:
    root = root.resolve()
    if not manifest_path.is_absolute():
        manifest_path = root / manifest_path
    pin = load_manifest(manifest_path)
    try:
        package_version = json.loads((root / "package.json").read_text())["version"]
    except (OSError, KeyError, json.JSONDecodeError) as exc:
        raise RuntimeImagePinError("package_version_invalid") from exc
    if package_version != pin.release_version or (
        expected_version is not None and expected_version != pin.release_version
    ):
        raise RuntimeImagePinError("release_version_mismatch")

    for relative in PINNED_CONSUMERS:
        try:
            text = (root / relative).read_text(encoding="utf-8")
        except (OSError, UnicodeError) as exc:
            raise RuntimeImagePinError("consumer_missing") from exc
        if pin.image_ref not in text:
            raise RuntimeImagePinError("consumer_digest_drift")
        if MUTABLE_RELEASE_REF_RE.search(text):
            raise RuntimeImagePinError("consumer_mutable_ref")
    return pin


def _registry_url(pin: RuntimeImagePin, kind: str, identity: str) -> str:
    repository_path = pin.repository.removeprefix("ghcr.io/")
    quoted = urllib.parse.quote(identity, safe=":")
    return f"https://ghcr.io/v2/{repository_path}/{kind}/{quoted}"


def _read_response(response: Any) -> bytes:
    length = response.headers.get("Content-Length")
    if length is not None:
        try:
            if int(length) > MAX_REGISTRY_BODY:
                raise RuntimeImagePinError("registry_response_large")
        except ValueError as exc:
            raise RuntimeImagePinError("registry_response_invalid") from exc
    body = response.read(MAX_REGISTRY_BODY + 1)
    if len(body) > MAX_REGISTRY_BODY:
        raise RuntimeImagePinError("registry_response_large")
    return body


def _anonymous_registry_token(pin: RuntimeImagePin) -> str:
    scope = urllib.parse.quote(
        f"repository:{pin.repository.removeprefix('ghcr.io/')}:pull", safe=":"
    )
    request = urllib.request.Request(
        f"https://ghcr.io/token?service=ghcr.io&scope={scope}", method="GET"
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = json.loads(_read_response(response))
    except (OSError, urllib.error.URLError, json.JSONDecodeError) as exc:
        raise RuntimeImagePinError("registry_token_unavailable") from exc
    token = payload.get("token") if isinstance(payload, dict) else None
    if not isinstance(token, str) or not token:
        raise RuntimeImagePinError("registry_token_invalid")
    return token


def _registry_request(
    pin: RuntimeImagePin,
    *,
    kind: str,
    identity: str,
    accept: str,
    token: str,
    method: str = "GET",
) -> tuple[dict[str, str], bytes]:
    request = urllib.request.Request(
        _registry_url(pin, kind, identity),
        headers={"Authorization": f"Bearer {token}", "Accept": accept},
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            headers = {key.lower(): value for key, value in response.headers.items()}
            return headers, b"" if method == "HEAD" else _read_response(response)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            raise RuntimeImagePinError("tag_absent") from exc
        raise RuntimeImagePinError("registry_unavailable") from exc
    except (OSError, urllib.error.URLError) as exc:
        raise RuntimeImagePinError("registry_unavailable") from exc


def registry_tag_digest(pin: RuntimeImagePin, tag: str) -> str | None:
    if tag != pin.release_version and tag != "master":
        raise RuntimeImagePinError("tag_invalid")
    token = _anonymous_registry_token(pin)
    try:
        headers, _ = _registry_request(
            pin,
            kind="manifests",
            identity=tag,
            accept=INDEX_ACCEPT,
            token=token,
            method="HEAD",
        )
    except RuntimeImagePinError as exc:
        if exc.code == "tag_absent":
            return None
        raise
    digest = headers.get("docker-content-digest", "")
    if not DIGEST_RE.fullmatch(digest):
        raise RuntimeImagePinError("registry_digest_invalid")
    return digest


def verify_source_labels(pin: RuntimeImagePin) -> None:
    token = _anonymous_registry_token(pin)
    _, raw_index = _registry_request(
        pin,
        kind="manifests",
        identity=pin.digest,
        accept=INDEX_ACCEPT,
        token=token,
    )
    if f"sha256:{hashlib.sha256(raw_index).hexdigest()}" != pin.digest:
        raise RuntimeImagePinError("index_digest_mismatch")
    try:
        index = json.loads(raw_index)
    except json.JSONDecodeError as exc:
        raise RuntimeImagePinError("index_invalid") from exc
    manifests = index.get("manifests") if isinstance(index, dict) else None
    if not isinstance(manifests, list):
        raise RuntimeImagePinError("index_invalid")

    platform_manifests: dict[tuple[str, str], str] = {}
    for entry in manifests:
        if not isinstance(entry, dict) or not isinstance(entry.get("platform"), dict):
            continue
        platform = entry["platform"]
        key = (platform.get("os"), platform.get("architecture"))
        digest = entry.get("digest")
        if key in {("linux", "amd64"), ("linux", "arm64")}:
            if (
                key in platform_manifests
                or not isinstance(digest, str)
                or not DIGEST_RE.fullmatch(digest)
            ):
                raise RuntimeImagePinError("platform_manifest_invalid")
            platform_manifests[key] = digest
    if set(platform_manifests) != {("linux", "amd64"), ("linux", "arm64")}:
        raise RuntimeImagePinError("platform_set_invalid")

    for manifest_digest in platform_manifests.values():
        _, raw_manifest = _registry_request(
            pin,
            kind="manifests",
            identity=manifest_digest,
            accept=MANIFEST_ACCEPT,
            token=token,
        )
        try:
            manifest = json.loads(raw_manifest)
            config_digest = manifest["config"]["digest"]
        except (json.JSONDecodeError, KeyError, TypeError) as exc:
            raise RuntimeImagePinError("platform_manifest_invalid") from exc
        if not isinstance(config_digest, str) or not DIGEST_RE.fullmatch(config_digest):
            raise RuntimeImagePinError("config_digest_invalid")
        _, raw_config = _registry_request(
            pin,
            kind="blobs",
            identity=config_digest,
            accept="application/vnd.oci.image.config.v1+json",
            token=token,
        )
        try:
            config = json.loads(raw_config)
            labels = config["config"]["Labels"]
        except (json.JSONDecodeError, KeyError, TypeError) as exc:
            raise RuntimeImagePinError("config_invalid") from exc
        if not isinstance(labels, dict):
            raise RuntimeImagePinError("config_invalid")
        if labels.get("org.opencontainers.image.revision") != pin.source_revision:
            raise RuntimeImagePinError("source_revision_mismatch")


def publish_release_tag(pin: RuntimeImagePin) -> str:
    verify_source_labels(pin)
    existing = registry_tag_digest(pin, pin.release_version)
    if existing is not None:
        if existing != pin.digest:
            raise RuntimeImagePinError("release_tag_mismatch")
        return "tag_verified"

    command = [
        "docker",
        "buildx",
        "imagetools",
        "create",
        "--tag",
        pin.release_tag_ref,
        pin.image_ref,
    ]
    try:
        result = subprocess.run(
            command, capture_output=True, text=False, check=False, timeout=120
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise RuntimeImagePinError("release_tag_publish_failed") from exc
    if result.returncode != 0:
        raise RuntimeImagePinError("release_tag_publish_failed")
    if registry_tag_digest(pin, pin.release_version) != pin.digest:
        raise RuntimeImagePinError("release_tag_verify_failed")
    return "tag_published"


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=MANIFEST_PATH)
    subparsers = parser.add_subparsers(dest="command", required=True)
    show = subparsers.add_parser("show")
    show.add_argument(
        "--field",
        required=True,
        choices=(
            "release_version",
            "repository",
            "digest",
            "source_revision",
            "image_ref",
        ),
    )
    verify = subparsers.add_parser("verify-tree")
    verify.add_argument("--root", type=Path, default=Path.cwd())
    verify.add_argument("--version")
    remote = subparsers.add_parser("verify-tag")
    remote.add_argument("--tag", required=True, choices=("master", "release"))
    subparsers.add_parser("verify-source")
    subparsers.add_parser("publish")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        manifest = args.manifest
        if not manifest.is_absolute() and args.command == "verify-tree":
            manifest = args.root / manifest
        pin = load_manifest(manifest)
        if args.command == "show":
            print(
                pin.image_ref if args.field == "image_ref" else getattr(pin, args.field)
            )
        elif args.command == "verify-tree":
            verify_tree(args.root, args.version, args.manifest)
            print("runtime-image-pin result=pass code=tree_verified")
        elif args.command == "verify-tag":
            tag = "master" if args.tag == "master" else pin.release_version
            if registry_tag_digest(pin, tag) != pin.digest:
                raise RuntimeImagePinError("tag_digest_mismatch")
            verify_source_labels(pin)
            print("runtime-image-pin result=pass code=tag_verified")
        elif args.command == "verify-source":
            verify_source_labels(pin)
            print("runtime-image-pin result=pass code=source_verified")
        elif args.command == "publish":
            code = publish_release_tag(pin)
            print(f"runtime-image-pin result=pass code={code}")
        return 0
    except RuntimeImagePinError as exc:
        print(f"runtime-image-pin result=fail code={exc.code}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
