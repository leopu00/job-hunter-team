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
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator


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
STRAY_PIN_RE = re.compile(r"ghcr\.io/leopu00/jht@sha256:[0-9a-f]{64}")
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
    Path("scripts/enable-podman-windows-runtime.ps1"),
    Path("scripts/windows-config-acl-selftest.ps1"),
    Path("docs/guides/CLI-INSTALL.md"),
    Path(".env.example"),
)
# L'app desktop compila lo sha256 dell'installer che scarica dal sito
# (onboarding.rs: include_str!("../installer.sha256")) e rifiuta un installer
# diverso. Gli installer portano il pin dentro: cambiato il pin, cambia il
# loro digest, e quello compilato nell'app deve seguirlo. Coppie
# (installer, file col suo sha256).
INSTALLER_DIGESTS = (
    (Path("scripts/install.sh"), Path("desktop/src-tauri/installer.sha256")),
    (Path("scripts/install.ps1"), Path("desktop/src-tauri/installer-windows.sha256")),
)
# Ogni copia distribuita ha un punto operativo preciso. Cercare il digest in
# qualunque punto del file era un falso verde: una riga commentata poteva
# attestare il valore corretto mentre l'assegnazione eseguita usava altro.
# Ogni pattern estrae il valore effettivo dal costrutto canonico; i due esempi
# della guida sono contratti separati perché vengono copiati dagli utenti.
CONSUMER_VALUE_PATTERNS: dict[Path, tuple[str, ...]] = {
    # The compose names the image once, with a YAML anchor that the broker
    # service reuses (`image: *jht-image`): two literal lines would be two
    # values to keep equal.
    Path("docker-compose.yml"): (
        r"^[ \t]*image: (?:&[A-Za-z0-9_-]+[ \t]+)?\$\{JHT_IMAGE:-(?P<image>[^}\s]+)\}[ \t]*$",
    ),
    Path("game/scripts/backend/payloads/runtime_compose.yml"): (
        r"^[ \t]*image: \$\{JHT_IMAGE:-(?P<image>[^}\s]+)\}[ \t]*$",
    ),
    Path("game/scripts/setup/setup_service.gd"): (
        r'^const DEFAULT_RUNTIME_IMAGE := "(?P<image>[^"]+)"$',
    ),
    Path("cli/src/commands/container.js"): (
        r"^const DEFAULT_RUNTIME_IMAGE = '(?P<image>[^']+)';$",
    ),
    Path("scripts/install.sh"): (r'^IMAGE="\$\{JHT_IMAGE:-(?P<image>[^}\s]+)\}"$',),
    Path("web/public/install.sh"): (r'^IMAGE="\$\{JHT_IMAGE:-(?P<image>[^}\s]+)\}"$',),
    Path("scripts/install.ps1"): (
        r"^\$Image\s+= if \(\$env:JHT_IMAGE\).*else \{ '(?P<image>[^']+)' \}$",
    ),
    Path("web/public/install.ps1"): (
        r"^\$Image\s+= if \(\$env:JHT_IMAGE\).*else \{ '(?P<image>[^']+)' \}$",
    ),
    Path("scripts/jht-wrapper.sh"): (r'^DEFAULT_RUNTIME_IMAGE="(?P<image>[^"]+)"$',),
    Path("scripts/jht-wrapper.ps1"): (r"^\$DefaultRuntimeImage = '(?P<image>[^']+)'$",),
    # The enabler's parameter default, and the self-test's fixture: the latter
    # names the image and, on the next line, its bare digest (group `digest`).
    Path("scripts/enable-podman-windows-runtime.ps1"): (
        r"^[ \t]*\[string\]\$RuntimeImage = '(?P<image>[^']+)',[ \t]*$",
    ),
    Path("scripts/windows-config-acl-selftest.ps1"): (
        r"^[ \t]*\$RuntimeImage = '(?P<image>[^']+)'[ \t]*$",
        r"^[ \t]*\$RuntimeImageDigest = '(?P<digest>sha256:[0-9a-f]{64})'[ \t]*$",
    ),
    Path("docs/guides/CLI-INSTALL.md"): (
        r"^\| `JHT_IMAGE` \| `(?P<image>[^`]+)` \| Content-addressed container image referenced by the compose \|$",
        r"^[ \t]*image:[ \t]+(?P<image>ghcr\.io/leopu00/jht@sha256:[0-9a-f]{64})[ \t]*$",
    ),
    Path(".env.example"): (
        r"^# \{(?P<image>ghcr\.io/leopu00/jht@sha256:[0-9a-f]{64})\}$",
    ),
}
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
    # bool e' una sottoclasse di int in Python: `True == 1` non deve poter
    # selezionare uno schema che non e' stato dichiarato come intero JSON.
    if (
        type(data.get("schema_version")) is not int
        or data["schema_version"] != SCHEMA_VERSION
    ):
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


def _pinned_group(pattern: str) -> str:
    """`image` (the full reference) or `digest` (the bare sha256:...) of a consumer pattern."""
    names = re.compile(pattern).groupindex
    if set(names) not in ({"image"}, {"digest"}):
        raise RuntimeImagePinError("consumer_contract_invalid")
    return next(iter(names))


def _pinned_value(pin: "RuntimeImagePin", group: str) -> str:
    return pin.image_ref if group == "image" else pin.digest


def _installer_digest(content: bytes) -> str:
    """sha256 of an installer as git stores it: a checkout that made it CRLF hashes the same."""
    return hashlib.sha256(content.replace(b"\r\n", b"\n")).hexdigest()


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

    if set(CONSUMER_VALUE_PATTERNS) != set(PINNED_CONSUMERS):
        raise RuntimeImagePinError("consumer_contract_invalid")
    for relative in PINNED_CONSUMERS:
        try:
            text = (root / relative).read_text(encoding="utf-8")
        except (OSError, UnicodeError) as exc:
            raise RuntimeImagePinError("consumer_missing") from exc
        for pattern in CONSUMER_VALUE_PATTERNS[relative]:
            group = _pinned_group(pattern)
            values = [
                match.group(group)
                for match in re.finditer(pattern, text, flags=re.MULTILINE)
            ]
            if values != [_pinned_value(pin, group)]:
                raise RuntimeImagePinError("consumer_digest_drift")
        if MUTABLE_RELEASE_REF_RE.search(text):
            raise RuntimeImagePinError("consumer_mutable_ref")
    for installer, digest_file in INSTALLER_DIGESTS:
        if installer not in PINNED_CONSUMERS:
            continue
        try:
            expected = _installer_digest((root / installer).read_bytes())
            recorded = (root / digest_file).read_text(encoding="ascii").strip()
        except (OSError, UnicodeError) as exc:
            raise RuntimeImagePinError("consumer_missing") from exc
        if recorded != expected:
            raise RuntimeImagePinError("installer_digest_drift")
    return pin


def update_tree(
    root: Path,
    digest: str,
    source_revision: str,
    release_version: str | None = None,
    manifest_path: Path = MANIFEST_PATH,
) -> RuntimeImagePin:
    """Point the manifest and EVERY consumer at a new image, or change nothing.

    The consumers are found and rewritten with the very patterns that
    ``verify_tree`` reads them with, so a copy cannot be updated in a way the
    gate does not see, and one that the patterns miss stops the update.
    """
    root = root.resolve()
    if not manifest_path.is_absolute():
        manifest_path = root / manifest_path
    try:
        package_version = json.loads((root / "package.json").read_text())["version"]
    except (OSError, KeyError, json.JSONDecodeError) as exc:
        raise RuntimeImagePinError("package_version_invalid") from exc
    version = release_version or package_version
    if version != package_version:
        raise RuntimeImagePinError("release_version_mismatch")
    # the same validation the manifest gets when it is read back
    pin = RuntimeImagePin(version, "ghcr.io/leopu00/jht", digest, source_revision)
    if not VERSION_RE.fullmatch(version):
        raise RuntimeImagePinError("version_invalid")
    if not DIGEST_RE.fullmatch(digest):
        raise RuntimeImagePinError("digest_invalid")
    if not COMMIT_RE.fullmatch(source_revision):
        raise RuntimeImagePinError("source_revision_invalid")

    if set(CONSUMER_VALUE_PATTERNS) != set(PINNED_CONSUMERS):
        raise RuntimeImagePinError("consumer_contract_invalid")
    rewritten: dict[Path, str] = {}
    raw_bytes: dict[Path, bytes] = {}
    for relative in PINNED_CONSUMERS:
        try:
            with open(root / relative, encoding="utf-8", newline="") as handle:
                raw = handle.read()
        except (OSError, UnicodeError) as exc:
            raise RuntimeImagePinError("consumer_missing") from exc
        # a file that is CRLF all through (a Windows checkout) is matched as LF and written back as CRLF
        crlf = "\r\n" in raw and raw.count("\n") == raw.count("\r\n")
        text = raw.replace("\r\n", "\n") if crlf else raw
        spans: list[tuple[int, int, str]] = []
        for pattern in CONSUMER_VALUE_PATTERNS[relative]:
            group = _pinned_group(pattern)
            found = list(re.finditer(pattern, text, flags=re.MULTILINE))
            if len(found) != 1:
                raise RuntimeImagePinError("consumer_pattern_unmatched")
            spans.append(
                (found[0].start(group), found[0].end(group), _pinned_value(pin, group))
            )
        for start, end, value in sorted(spans, reverse=True):
            text = text[:start] + value + text[end:]
        rewritten[relative] = text.replace("\n", "\r\n") if crlf else text
        raw_bytes[relative] = rewritten[relative].encode("utf-8")

    # The digest the app compiles follows the installer it names, from the bytes about to be written.
    digests: dict[Path, str] = {}
    for installer, digest_file in INSTALLER_DIGESTS:
        if installer in raw_bytes:
            if not (root / digest_file).is_file():
                raise RuntimeImagePinError("consumer_missing")
            digests[digest_file] = _installer_digest(raw_bytes[installer]) + "\n"
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "release_version": version,
        "repository": pin.repository,
        "digest": digest,
        "source_revision": source_revision,
    }
    # Every new content is written beside its file first: an I/O error there
    # (disk full, a read-only file) leaves the tree as it was. Only then the
    # files are put in place, the manifest last. newline="": the consumers keep
    # the line endings they had.
    staged: list[tuple[Path, Path]] = []
    try:
        for relative, text in rewritten.items():
            target = root / relative
            temporary = target.with_name(target.name + ".pin-new")
            staged.append((temporary, target))
            with open(temporary, "w", encoding="utf-8", newline="") as handle:
                handle.write(text)
            # os.replace puts the new file's mode in place: the installers are 0755
            shutil.copymode(target, temporary)
        for relative, text in digests.items():
            target = root / relative
            temporary = target.with_name(target.name + ".pin-new")
            staged.append((temporary, target))
            with open(temporary, "w", encoding="ascii", newline="") as handle:
                handle.write(text)
            shutil.copymode(target, temporary)
        temporary = manifest_path.with_name(manifest_path.name + ".pin-new")
        staged.append((temporary, manifest_path))
        temporary.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    except OSError as exc:
        for temporary, _ in staged:
            temporary.unlink(missing_ok=True)
        raise RuntimeImagePinError("update_write_failed") from exc
    for temporary, target in staged:
        os.replace(temporary, target)
    return verify_tree(root, version, manifest_path)


def find_stray_pins(root: Path, pin: RuntimeImagePin) -> None:
    """No tracked file may name a JHT image by digest other than the manifest's.

    ``PINNED_CONSUMERS`` lists the places that are known; a new copy of the pin
    in a file that is not listed would stay at the old digest at the next
    release and nothing would say so.
    """
    try:
        listed = subprocess.run(
            ["git", "-C", str(root), "ls-files", "-z"],
            capture_output=True, check=True, timeout=60,
        ).stdout.decode("utf-8", errors="replace")
    except (OSError, subprocess.SubprocessError) as exc:
        raise RuntimeImagePinError("git_unavailable") from exc
    manifest = (root / MANIFEST_PATH).resolve()
    for name in filter(None, listed.split("\0")):
        path = root / name
        if path.resolve() == manifest:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            continue  # not on disk (sparse checkout) or not text
        for found in STRAY_PIN_RE.findall(text):
            if found != pin.image_ref:
                raise RuntimeImagePinError("unlisted_stale_pin")


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


def _platform_revisions(pin: RuntimeImagePin) -> Iterator[Any]:
    """The `org.opencontainers.image.revision` label of each platform of the image at pin.digest, one by one."""
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
        yield labels.get("org.opencontainers.image.revision")


def verify_source_labels(pin: RuntimeImagePin) -> None:
    for revision in _platform_revisions(pin):
        if revision != pin.source_revision:
            raise RuntimeImagePinError("source_revision_mismatch")


def registry_source_revision(repository: str, digest: str) -> str:
    """The commit the image at this digest was built from; both platforms must say the same."""
    asked = RuntimeImagePin("0.0.0", repository, digest, "0" * 40)
    revisions = set(_platform_revisions(asked))
    if len(revisions) != 1:
        raise RuntimeImagePinError("source_revision_inconsistent")
    revision = revisions.pop()
    if not isinstance(revision, str) or not COMMIT_RE.fullmatch(revision):
        raise RuntimeImagePinError("source_revision_invalid")
    return revision


def publish_release_tag(pin: RuntimeImagePin, claim: str) -> str:
    # Il claim e' valido solo dentro il workflow Release, la cui concurrency
    # group e' il medesimo ref. Questo rende seriale la finestra registry
    # check->create->readback; il post-check resta la prova dell'effetto.
    if claim != f"refs/tags/v{pin.release_version}":
        raise RuntimeImagePinError("release_claim_invalid")
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
    update = subparsers.add_parser(
        "update",
        help="point the manifest and every consumer at a new image (run before the release commit)",
    )
    update.add_argument("--root", type=Path, default=Path.cwd())
    update.add_argument("--digest", help="the multi-architecture index digest, sha256:...")
    update.add_argument("--source-revision", help="the commit the image was built from")
    update.add_argument(
        "--from-registry",
        action="store_true",
        help="take the digest of the `master` tag and the commit from the image's own label",
    )
    update.add_argument("--release-version", help="default: the version of package.json")
    publish = subparsers.add_parser("publish")
    publish.add_argument("--claim", required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        manifest = args.manifest
        if not manifest.is_absolute() and args.command == "verify-tree":
            manifest = args.root / manifest
        if args.command == "update":
            # the old manifest is what is being replaced: it need not be readable
            if args.from_registry == bool(args.digest):
                raise RuntimeImagePinError("update_source_ambiguous")
            digest = args.digest
            revision = args.source_revision
            if args.from_registry:
                repository = "ghcr.io/leopu00/jht"
                digest = registry_tag_digest(
                    RuntimeImagePin("0.0.0", repository, "sha256:" + "0" * 64, "0" * 40), "master"
                )
                if digest is None:
                    raise RuntimeImagePinError("tag_absent")
                found = registry_source_revision(repository, digest)
                if revision is not None and revision != found:
                    raise RuntimeImagePinError("source_revision_mismatch")
                revision = found
            elif revision is None:
                raise RuntimeImagePinError("update_source_ambiguous")
            done = update_tree(args.root, digest, revision, args.release_version, args.manifest)
            print(f"runtime-image-pin result=pass code=tree_updated image={done.image_ref} revision={done.source_revision}")
            return 0
        pin = load_manifest(manifest)
        if args.command == "show":
            print(
                pin.image_ref if args.field == "image_ref" else getattr(pin, args.field)
            )
        elif args.command == "verify-tree":
            verified = verify_tree(args.root, args.version, args.manifest)
            find_stray_pins(args.root, verified)
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
            code = publish_release_tag(pin, args.claim)
            print(f"runtime-image-pin result=pass code={code}")
        return 0
    except RuntimeImagePinError as exc:
        print(f"runtime-image-pin result=fail code={exc.code}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
