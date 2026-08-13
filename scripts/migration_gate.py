#!/usr/bin/env python3
"""Fail-closed guard for the immutable Supabase migration history.

The Git gate is the authority for migration identities: version, repository
path and Git blob must stay a bijection after a migration reaches the base.
The linked-project command deliberately has a smaller claim: Supabase's
``migration list`` exposes versions, not paths or statement checksums.

No command in this module repairs, pushes, links or otherwise writes a remote
database.  The PostgreSQL executor accepts loopback targets only and creates a
random disposable database there.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import secrets
import subprocess
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence
from urllib.parse import unquote, urlparse, urlunparse


ROOT = Path(__file__).resolve().parents[1]
MIGRATION_PREFIX = "supabase/migrations/"
MANIFEST_PATH = "supabase/migration-anchors.v1.json"
MIGRATION_RE = re.compile(
    r"^supabase/migrations/([0-9]{3}|[0-9]{14})_([a-z0-9_]+)\.sql$"
)
HASH_RE = re.compile(r"^[0-9a-f]{40,64}$")
REF_RE = re.compile(r"^[A-Za-z0-9._/-]+$")
ANSI_RE = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")

# Migration 018 rewrites policy expressions and then checks PostgreSQL's
# pretty-printed expression text.  PostgreSQL 16 adds an ``AS uid`` alias, so
# that historical check fails even though migration 025 explicitly replaces
# the same policy definitions.  An already-published migration cannot be
# edited: replay may skip only this exact blob, and only if its replacement is
# present in the base being built.
LEGACY_REPLAY_EXCEPTIONS = {
    "018": ("c42783f0c750c386929d19cc00ca7d33a480a510", "025"),
}


@dataclass(frozen=True)
class Migration:
    version: str
    number: int
    name: str
    path: str
    oid: str

    @property
    def is_anchor(self) -> bool:
        return len(self.version) == 14


@dataclass(frozen=True)
class Issue:
    code: str
    ref: str
    version: str = "none"
    hashes: tuple[str, ...] = ()


class GateInvalid(RuntimeError):
    """Internal failure whose raw diagnostic must never reach public output."""


def _run_git(
    repo: Path, argv: Sequence[str], *, input_bytes: bytes | None = None
) -> bytes:
    completed = subprocess.run(
        ["git", "-C", str(repo), *argv],
        input=input_bytes,
        capture_output=True,
        check=False,
    )
    if completed.returncode:
        raise GateInvalid("git command failed")
    return completed.stdout


def _resolve_commit(repo: Path, ref: str) -> str:
    raw = (
        _run_git(repo, ["rev-parse", "--verify", f"{ref}^{{commit}}"])
        .decode("ascii", "strict")
        .strip()
    )
    if not HASH_RE.fullmatch(raw):
        raise GateInvalid("invalid commit identity")
    return raw


def _safe_ref(ref: str) -> str:
    return ref if REF_RE.fullmatch(ref) else "invalid-ref"


def inventory(repo: Path, ref: str) -> tuple[list[Migration], list[Issue]]:
    commit = _resolve_commit(repo, ref)
    raw = _run_git(
        repo,
        ["ls-tree", "-r", "-z", commit, "--", MIGRATION_PREFIX.rstrip("/")],
    )
    migrations: list[Migration] = []
    issues: list[Issue] = []
    for record in raw.split(b"\0"):
        if not record:
            continue
        try:
            metadata, path_bytes = record.split(b"\t", 1)
            mode, object_type, oid = metadata.decode("ascii").split(" ", 2)
            path = path_bytes.decode("utf-8", "strict")
        except (ValueError, UnicodeDecodeError):
            issues.append(Issue("invalid_tree", _safe_ref(ref)))
            continue
        match = MIGRATION_RE.fullmatch(path)
        if mode != "100644" or object_type != "blob" or not HASH_RE.fullmatch(oid):
            issues.append(Issue("invalid_tree", _safe_ref(ref), hashes=(oid,)))
        elif not match:
            issues.append(Issue("invalid_path", _safe_ref(ref), hashes=(oid,)))
        else:
            version = match.group(1)
            migrations.append(
                Migration(version, int(version), match.group(2), path, oid)
            )
    return sorted(migrations, key=lambda item: (item.number, item.path)), issues


def _tree_blob(repo: Path, ref: str, path: str) -> tuple[str, bytes] | None:
    commit = _resolve_commit(repo, ref)
    raw = _run_git(repo, ["ls-tree", "-z", commit, "--", path])
    records = [record for record in raw.split(b"\0") if record]
    if not records:
        return None
    if len(records) != 1:
        raise GateInvalid("ambiguous tree path")
    try:
        metadata, actual_path = records[0].split(b"\t", 1)
        mode, object_type, oid = metadata.decode("ascii").split(" ", 2)
    except (ValueError, UnicodeDecodeError):
        raise GateInvalid("invalid tree record") from None
    if (
        actual_path.decode("utf-8", "strict") != path
        or mode != "100644"
        or object_type != "blob"
        or not HASH_RE.fullmatch(oid)
    ):
        raise GateInvalid("invalid tree blob")
    return oid, _run_git(repo, ["cat-file", "blob", oid])


def _json_without_duplicate_keys(raw: bytes) -> object:
    def object_pairs(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise GateInvalid("duplicate manifest key")
            result[key] = value
        return result

    if len(raw) > 1024 * 1024:
        raise GateInvalid("manifest too large")
    try:
        return json.loads(raw.decode("utf-8", "strict"), object_pairs_hook=object_pairs)
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise GateInvalid("invalid manifest JSON") from None


def _comment_only_sql(raw: bytes) -> bool:
    """Accept whitespace and PostgreSQL line/nested block comments only."""

    try:
        text = raw.decode("utf-8", "strict")
    except UnicodeDecodeError:
        return False
    index = 0
    length = len(text)
    while index < length:
        if text[index].isspace():
            index += 1
            continue
        if text.startswith("--", index):
            newline = text.find("\n", index + 2)
            index = length if newline < 0 else newline + 1
            continue
        if text.startswith("/*", index):
            depth = 1
            index += 2
            while index < length and depth:
                if text.startswith("/*", index):
                    depth += 1
                    index += 2
                elif text.startswith("*/", index):
                    depth -= 1
                    index += 2
                else:
                    index += 1
            if depth:
                return False
            continue
        return False
    return True


ANCHOR_KEYS = {
    "version",
    "path",
    "blob_sha256",
    "canonical_versions",
    "remote_name",
    "statement_md5",
}


def _validate_anchor_records(
    raw_manifest: bytes | None,
    migrations: Sequence[Migration],
    ref: str,
    read_bytes,
) -> tuple[dict[str, dict[str, object]], list[Issue]]:
    anchors = {
        migration.version: migration for migration in migrations if migration.is_anchor
    }
    canonical = {
        migration.version for migration in migrations if not migration.is_anchor
    }
    if raw_manifest is None:
        if anchors:
            return {}, [Issue("anchor_manifest_missing", _safe_ref(ref))]
        return {}, []
    try:
        document = _json_without_duplicate_keys(raw_manifest)
    except GateInvalid:
        return {}, [Issue("anchor_manifest_invalid", _safe_ref(ref))]
    if (
        not isinstance(document, dict)
        or set(document) != {"schema_version", "anchors"}
        or document.get("schema_version") != 1
        or not isinstance(document.get("anchors"), list)
    ):
        return {}, [Issue("anchor_manifest_invalid", _safe_ref(ref))]

    records: dict[str, dict[str, object]] = {}
    issues: list[Issue] = []
    for value in document["anchors"]:
        if not isinstance(value, dict) or set(value) != ANCHOR_KEYS:
            issues.append(Issue("anchor_manifest_invalid", _safe_ref(ref)))
            continue
        version = value.get("version")
        path = value.get("path")
        remote_name = value.get("remote_name")
        blob_sha256 = value.get("blob_sha256")
        statement_md5 = value.get("statement_md5")
        mappings = value.get("canonical_versions")
        if (
            not isinstance(version, str)
            or not re.fullmatch(r"[0-9]{14}", version)
            or version in records
            or not isinstance(path, str)
            or not isinstance(remote_name, str)
            or not re.fullmatch(r"[a-z0-9_]+", remote_name)
            or path != f"{MIGRATION_PREFIX}{version}_{remote_name}.sql"
            or not isinstance(blob_sha256, str)
            or not re.fullmatch(r"[0-9a-f]{64}", blob_sha256)
            or not isinstance(statement_md5, str)
            or not re.fullmatch(r"[0-9a-f]{32}", statement_md5)
            or not isinstance(mappings, list)
            or not mappings
            or any(
                not isinstance(mapping, str) or not re.fullmatch(r"[0-9]{3}", mapping)
                for mapping in mappings
            )
            or len(mappings) != len(set(mappings))
            or not set(mappings) <= canonical
        ):
            issues.append(
                Issue(
                    "anchor_manifest_invalid",
                    _safe_ref(ref),
                    (
                        version
                        if isinstance(version, str) and version.isdigit()
                        else "none"
                    ),
                )
            )
            continue
        migration = anchors.get(version)
        if migration is None or migration.path != path or migration.name != remote_name:
            issues.append(Issue("anchor_manifest_mismatch", _safe_ref(ref), version))
            continue
        try:
            anchor_bytes = read_bytes(migration)
        except (GateInvalid, OSError):
            issues.append(Issue("anchor_unreadable", _safe_ref(ref), version))
            continue
        actual_sha256 = hashlib.sha256(anchor_bytes).hexdigest()
        if actual_sha256 != blob_sha256:
            issues.append(
                Issue(
                    "anchor_hash_mismatch",
                    _safe_ref(ref),
                    version,
                    (blob_sha256, actual_sha256),
                )
            )
            continue
        if not _comment_only_sql(anchor_bytes):
            issues.append(
                Issue("anchor_not_noop", _safe_ref(ref), version, (actual_sha256,))
            )
            continue
        records[version] = value

    for version, migration in anchors.items():
        if version not in records and not any(
            issue.version == version for issue in issues
        ):
            issues.append(
                Issue(
                    "anchor_manifest_mismatch",
                    _safe_ref(ref),
                    version,
                    (migration.oid,),
                )
            )
    for version, record in records.items():
        if version not in anchors:
            issues.append(
                Issue(
                    "anchor_manifest_extra",
                    _safe_ref(ref),
                    version,
                    (str(record["blob_sha256"]),),
                )
            )
    return records, issues


def anchor_manifest(
    repo: Path, ref: str, migrations: Sequence[Migration]
) -> tuple[dict[str, dict[str, object]], list[Issue]]:
    manifest_blob = _tree_blob(repo, ref, MANIFEST_PATH)
    raw_manifest = manifest_blob[1] if manifest_blob else None
    return _validate_anchor_records(
        raw_manifest,
        migrations,
        ref,
        lambda migration: _run_git(repo, ["cat-file", "blob", migration.oid]),
    )


def validate_inventory(migrations: Sequence[Migration], ref: str) -> list[Issue]:
    issues: list[Issue] = []
    by_version: dict[str, list[Migration]] = defaultdict(list)
    by_blob: dict[str, list[Migration]] = defaultdict(list)
    for migration in migrations:
        by_version[migration.version].append(migration)
        by_blob[migration.oid].append(migration)
    for version, entries in sorted(by_version.items()):
        if len(entries) > 1:
            issues.append(
                Issue(
                    "number_collision",
                    _safe_ref(ref),
                    version,
                    tuple(entry.oid for entry in entries),
                )
            )
    for oid, entries in sorted(by_blob.items()):
        if len(entries) > 1:
            issues.append(
                Issue(
                    "blob_collision",
                    _safe_ref(ref),
                    entries[0].version,
                    (oid,),
                )
            )
    numbers = sorted(
        {migration.number for migration in migrations if not migration.is_anchor}
    )
    if numbers:
        missing = sorted(set(range(1, numbers[-1] + 1)) - set(numbers))
        issues.extend(
            Issue("sequence_gap", _safe_ref(ref), f"{number:03d}") for number in missing
        )
    return issues


def _is_ancestor(repo: Path, base: str, head: str) -> bool:
    completed = subprocess.run(
        ["git", "-C", str(repo), "merge-base", "--is-ancestor", base, head],
        capture_output=True,
        check=False,
    )
    if completed.returncode not in (0, 1):
        raise GateInvalid("ancestry check failed")
    return completed.returncode == 0


def _remote_refs(repo: Path, remote: str) -> list[str]:
    if not re.fullmatch(r"[A-Za-z0-9._-]+", remote):
        raise GateInvalid("invalid remote")
    fetch = subprocess.run(
        [
            "git",
            "-C",
            str(repo),
            "fetch",
            "--quiet",
            "--no-tags",
            remote,
            f"+refs/heads/*:refs/remotes/{remote}/*",
        ],
        capture_output=True,
        check=False,
    )
    if fetch.returncode:
        raise GateInvalid("remote fetch failed")
    raw = _run_git(
        repo,
        ["for-each-ref", "--format=%(refname)", f"refs/remotes/{remote}/"],
    )
    refs = []
    for line in raw.decode("utf-8", "strict").splitlines():
        if line.endswith("/HEAD"):
            continue
        if not REF_RE.fullmatch(line):
            raise GateInvalid("invalid remote ref")
        refs.append(line)
    return sorted(set(refs))


def compare_git(
    repo: Path,
    base_ref: str,
    head_ref: str,
    cross_refs: Iterable[str],
) -> tuple[list[Issue], int, int, int]:
    base_commit = _resolve_commit(repo, base_ref)
    head_commit = _resolve_commit(repo, head_ref)
    if not _is_ancestor(repo, base_commit, head_commit):
        return (
            [Issue("history_not_ancestor", "HEAD", hashes=(base_commit, head_commit))],
            0,
            0,
            0,
        )

    base, issues = inventory(repo, base_commit)
    head, head_issues = inventory(repo, head_commit)
    issues.extend(head_issues)
    issues.extend(validate_inventory(base, "BASE"))
    issues.extend(validate_inventory(head, "HEAD"))
    base_anchors, base_anchor_issues = anchor_manifest(repo, base_commit, base)
    head_anchors, head_anchor_issues = anchor_manifest(repo, head_commit, head)
    issues.extend(base_anchor_issues)
    issues.extend(head_anchor_issues)
    for version, record in base_anchors.items():
        current = head_anchors.get(version)
        if current != record:
            old_hash = str(record.get("blob_sha256", ""))
            new_hash = str(current.get("blob_sha256", "")) if current else ""
            issues.append(
                Issue(
                    "anchor_manifest_modified",
                    "HEAD",
                    version,
                    tuple(value for value in (old_hash, new_hash) if value),
                )
            )

    base_by_path = {migration.path: migration for migration in base}
    head_by_path = {migration.path: migration for migration in head}
    base_by_blob = {migration.oid: migration for migration in base}
    for path, old in base_by_path.items():
        current = head_by_path.get(path)
        if current is None:
            issues.append(Issue("immutable_deleted", "HEAD", old.version, (old.oid,)))
        elif current.oid != old.oid:
            issues.append(
                Issue("immutable_modified", "HEAD", old.version, (old.oid, current.oid))
            )

    new = [migration for migration in head if migration.path not in base_by_path]
    new_canonical = [migration for migration in new if not migration.is_anchor]
    base_max = max(
        (migration.number for migration in base if not migration.is_anchor), default=0
    )
    expected_new = list(range(base_max + 1, base_max + 1 + len(new_canonical)))
    if [migration.number for migration in new_canonical] != expected_new:
        for migration in new_canonical:
            if migration.number <= base_max:
                issues.append(
                    Issue(
                        "new_version_not_after_base",
                        "HEAD",
                        migration.version,
                        (migration.oid,),
                    )
                )
        if not any(issue.code == "new_version_not_after_base" for issue in issues):
            issues.append(Issue("new_sequence_not_contiguous", "HEAD"))
    for migration in new:
        if migration.oid in base_by_blob:
            issues.append(
                Issue(
                    "historical_blob_reused",
                    "HEAD",
                    migration.version,
                    (migration.oid,),
                )
            )

    for ref in sorted(set(cross_refs)):
        remote, remote_issues = inventory(repo, ref)
        _, remote_anchor_issues = anchor_manifest(repo, ref, remote)
        if remote_issues or remote_anchor_issues:
            issues.append(Issue("cross_ref_invalid", _safe_ref(ref)))
            continue
        by_version: dict[str, list[Migration]] = defaultdict(list)
        by_path = {migration.path: migration for migration in remote}
        by_blob: dict[str, list[Migration]] = defaultdict(list)
        for migration in remote:
            by_version[migration.version].append(migration)
            by_blob[migration.oid].append(migration)
        for migration in new:
            for other in by_version.get(migration.version, []):
                if other.path != migration.path or other.oid != migration.oid:
                    issues.append(
                        Issue(
                            "cross_number",
                            _safe_ref(ref),
                            migration.version,
                            (migration.oid, other.oid),
                        )
                    )
            other = by_path.get(migration.path)
            if other is not None and other.oid != migration.oid:
                issues.append(
                    Issue(
                        "cross_path",
                        _safe_ref(ref),
                        migration.version,
                        (migration.oid, other.oid),
                    )
                )
            for other in by_blob.get(migration.oid, []):
                if other.path != migration.path or other.version != migration.version:
                    issues.append(
                        Issue(
                            "cross_blob",
                            _safe_ref(ref),
                            migration.version,
                            (migration.oid,),
                        )
                    )
    return issues, len(base), len(head), len(new)


def _short_hash(value: str) -> str:
    return value[:12] if HASH_RE.fullmatch(value) else "none"


def emit_issues(stage: str, issues: Sequence[Issue], **counts: int) -> int:
    codes = Counter(issue.code for issue in issues)
    fields = " ".join(f"{key}={value}" for key, value in sorted(counts.items()))
    code_field = ",".join(f"{code}:{count}" for code, count in sorted(codes.items()))
    print(
        f"migration_gate status=fail stage={stage} codes={code_field} {fields}".rstrip()
    )
    for issue in issues:
        hashes = "/".join(_short_hash(value) for value in issue.hashes) or "none"
        print(
            "migration_gate issue={} ref={} version={} hash={}".format(
                issue.code, _safe_ref(issue.ref), issue.version, hashes
            )
        )
    return 1


def command_git(args: argparse.Namespace) -> int:
    repo = Path(args.repo).resolve()
    try:
        refs = list(args.cross_ref)
        if args.fetch_remote:
            refs.extend(_remote_refs(repo, args.fetch_remote))
        issues, base_count, head_count, new_count = compare_git(
            repo, args.base, args.head, refs
        )
    except (GateInvalid, UnicodeError, OSError):
        return emit_issues("git", [Issue("git_unavailable", "none")])
    if issues:
        return emit_issues(
            "git",
            issues,
            base=base_count,
            head=head_count,
            new=new_count,
            refs=len(set(refs)),
        )
    print(
        "migration_gate status=pass stage=git "
        f"base={base_count} head={head_count} new={new_count} refs={len(set(refs))}"
    )
    return 0


def _local_versions(repo: Path) -> list[str]:
    directory = repo / MIGRATION_PREFIX
    migrations: list[Migration] = []
    for path in sorted(directory.iterdir()):
        relative = path.relative_to(repo).as_posix()
        match = MIGRATION_RE.fullmatch(relative)
        if not path.is_file() or match is None:
            raise GateInvalid("invalid local migration path")
        raw = path.read_bytes()
        migrations.append(
            Migration(
                match.group(1),
                int(match.group(1)),
                match.group(2),
                relative,
                hashlib.sha256(raw).hexdigest(),
            )
        )
    versions = [migration.version for migration in migrations]
    if len(versions) != len(set(versions)):
        raise GateInvalid("duplicate local version")
    manifest_path = repo / MANIFEST_PATH
    raw_manifest = manifest_path.read_bytes() if manifest_path.is_file() else None
    _, issues = _validate_anchor_records(
        raw_manifest,
        migrations,
        "WORKTREE",
        lambda migration: (repo / migration.path).read_bytes(),
    )
    if issues:
        raise GateInvalid("invalid worktree anchor manifest")
    return versions


def _parse_linked_table(text: str) -> tuple[list[str], list[str]]:
    clean = ANSI_RE.sub("", text)
    local: list[str] = []
    remote: list[str] = []
    saw_header = False
    for raw_line in clean.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        cells = [cell.strip().strip("`") for cell in re.split(r"[|│]", line)]
        # Glamour's real pretty table has no outer border.  A remote-only row
        # therefore starts with ``| <remote> | <time>``: its leading empty cell
        # is data (the missing local version), not decoration.  Only remove
        # outer Markdown borders when both are present and there are 5 cells.
        if len(cells) >= 5 and not cells[0] and not cells[-1]:
            cells = cells[1:-1]
        if len(cells) < 3:
            raise GateInvalid("unrecognised linked output")
        first, second = cells[0].strip(), cells[1].strip()
        if first.lower() == "local" and second.lower() == "remote":
            saw_header = True
            continue
        if set(first) <= {"-", ":", " "} and set(second) <= {"-", ":", " "}:
            continue
        if not saw_header:
            raise GateInvalid("linked row before header")
        if first and not first.isdigit():
            raise GateInvalid("invalid local version")
        if second and not second.isdigit():
            raise GateInvalid("invalid remote version")
        if not first and not second:
            raise GateInvalid("empty linked row")
        if first:
            local.append(first)
        if second:
            remote.append(second)
    if not saw_header:
        raise GateInvalid("missing linked header")
    if len(local) != len(set(local)) or len(remote) != len(set(remote)):
        raise GateInvalid("duplicate linked version")
    return local, remote


def command_linked(args: argparse.Namespace) -> int:
    try:
        expected_local = _local_versions(Path(args.repo).resolve())
        text = Path(args.input).read_text(encoding="utf-8", errors="strict")
        listed_local, remote = _parse_linked_table(text)
        if set(listed_local) != set(expected_local):
            raise GateInvalid("CLI local inventory differs")
    except (GateInvalid, OSError, UnicodeError):
        return emit_issues("linked", [Issue("linked_output_invalid", "none")])
    local_set = set(expected_local)
    remote_set = set(remote)
    matched = local_set & remote_set
    local_only = local_set - remote_set
    remote_only = remote_set - local_set
    counts = {
        "local": len(local_set),
        "local_only": len(local_only),
        "matched": len(matched),
        "remote": len(remote_set),
        "remote_only": len(remote_only),
    }
    if local_only or remote_only:
        return emit_issues("linked", [Issue("history_diverged", "linked")], **counts)
    fields = " ".join(f"{key}={value}" for key, value in sorted(counts.items()))
    print(f"migration_gate status=pass stage=linked {fields}")
    return 0


def _loopback_urls(raw_url: str, database: str) -> tuple[str, str]:
    parsed = urlparse(raw_url)
    if parsed.scheme not in {"postgres", "postgresql"}:
        raise GateInvalid("unsupported PostgreSQL URL")
    if parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise GateInvalid("PostgreSQL target is not loopback")
    if not parsed.username:
        raise GateInvalid("PostgreSQL user missing")
    admin_path = "/" + (unquote(parsed.path.lstrip("/")) or "postgres")
    admin = urlunparse(parsed._replace(path=admin_path))
    target = urlunparse(parsed._replace(path="/" + database))
    return admin, target


def _psql(
    url: str, sql: bytes, *, tuples: bool = False
) -> subprocess.CompletedProcess[bytes]:
    argv = ["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "--dbname", url]
    if tuples:
        argv.extend(["-A", "-t"])
    return subprocess.run(argv, input=sql, capture_output=True, check=False)


BOOTSTRAP_SQL = b"""
DO $$ BEGIN CREATE ROLE anon NOLOGIN;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE auth.sessions (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, public BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE storage.objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id TEXT, name TEXT
);
CREATE PUBLICATION supabase_realtime;
"""


def _blob(repo: Path, migration: Migration) -> bytes:
    return _run_git(repo, ["cat-file", "blob", migration.oid])


def command_pg16(args: argparse.Namespace) -> int:
    repo = Path(args.repo).resolve()
    try:
        preflight, _, _, _ = compare_git(repo, args.base, args.head, [])
        if preflight:
            return emit_issues("pg16", preflight)
        base, base_issues = inventory(repo, args.base)
        head, head_issues = inventory(repo, args.head)
        if base_issues or head_issues:
            raise GateInvalid("invalid inventory")
        base_paths = {migration.path for migration in base}
        new = [migration for migration in head if migration.path not in base_paths]
        new_anchors = [migration for migration in new if migration.is_anchor]
        new_ddl = [migration for migration in new if not migration.is_anchor]
        if not new:
            print(
                "migration_gate status=pass stage=pg16 "
                f"base={len(base)} new=0 anchors=0 applied=0"
            )
            return 0
        raw_url = os.environ.get("JHT_TEST_POSTGRES_URL", "")
        database = "jht_migration_gate_" + secrets.token_hex(8)
        admin_url, target_url = _loopback_urls(raw_url, database)
        version = _psql(admin_url, b"SHOW server_version_num;", tuples=True)
        if version.returncode or not version.stdout.strip().startswith(b"16"):
            return emit_issues("pg16", [Issue("postgres_not_16", "local")])
        created = _psql(admin_url, f'CREATE DATABASE "{database}";'.encode("ascii"))
        if created.returncode:
            return emit_issues("pg16", [Issue("database_create_failed", "local")])
        apply_issue: Issue | None = None
        applied = 0
        try:
            if _psql(target_url, BOOTSTRAP_SQL).returncode:
                apply_issue = Issue("bootstrap_failed", "local")
            else:
                base_versions = {migration.version: migration for migration in base}
                for migration in base:
                    exception = LEGACY_REPLAY_EXCEPTIONS.get(migration.version)
                    if exception:
                        expected_oid, replacement = exception
                        if (
                            migration.oid != expected_oid
                            or replacement not in base_versions
                        ):
                            apply_issue = Issue(
                                "legacy_exception_invalid",
                                "BASE",
                                migration.version,
                                (migration.oid,),
                            )
                            break
                        continue
                    if _psql(target_url, _blob(repo, migration)).returncode:
                        apply_issue = Issue(
                            "base_apply_failed",
                            "BASE",
                            migration.version,
                            (migration.oid,),
                        )
                        break
                if apply_issue is None:
                    for migration in new:
                        if _psql(target_url, _blob(repo, migration)).returncode:
                            apply_issue = Issue(
                                "new_apply_failed",
                                "HEAD",
                                migration.version,
                                (migration.oid,),
                            )
                            break
                        if not migration.is_anchor:
                            applied += 1
        finally:
            dropped = _psql(
                admin_url,
                f'DROP DATABASE IF EXISTS "{database}" WITH (FORCE);'.encode("ascii"),
            )
        if dropped.returncode:
            return emit_issues("pg16", [Issue("database_cleanup_failed", "local")])
        if apply_issue is not None:
            return emit_issues(
                "pg16",
                [apply_issue],
                anchors=len(new_anchors),
                applied=applied,
                new=len(new_ddl),
            )
    except (GateInvalid, OSError, UnicodeError):
        return emit_issues("pg16", [Issue("postgres_unavailable", "local")])
    print(
        "migration_gate status=pass stage=pg16 "
        f"base={len(base)} new={len(new_ddl)} "
        f"anchors={len(new_anchors)} applied={applied}"
    )
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Validate immutable Supabase migrations"
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    git_parser = subparsers.add_parser("git", help="validate Git migration identities")
    git_parser.add_argument("--repo", default=str(ROOT))
    git_parser.add_argument("--base", required=True)
    git_parser.add_argument("--head", default="HEAD")
    git_parser.add_argument("--cross-ref", action="append", default=[])
    git_parser.add_argument("--fetch-remote")
    git_parser.set_defaults(func=command_git)

    linked = subparsers.add_parser("linked", help="validate captured linked history")
    linked.add_argument("--repo", default=str(ROOT))
    linked.add_argument("--input", required=True)
    linked.set_defaults(func=command_linked)

    pg16 = subparsers.add_parser("pg16", help="apply new migrations on disposable PG16")
    pg16.add_argument("--repo", default=str(ROOT))
    pg16.add_argument("--base", required=True)
    pg16.add_argument("--head", default="HEAD")
    pg16.set_defaults(func=command_pg16)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
