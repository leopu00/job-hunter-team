"""H-08: automatic, read-only guard for Supabase migration history."""

from __future__ import annotations

import importlib.util
import os
import shutil
import socket
import subprocess
import sys
import time
import uuid
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
GATE_PATH = ROOT / "scripts/migration_gate.py"
WRAPPER = ROOT / "scripts/check-linked-migration-history.sh"


def _load_gate():
    spec = importlib.util.spec_from_file_location("migration_gate", GATE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load migration gate")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


gate = _load_gate()


def _git(repo: Path, *args: str) -> str:
    return subprocess.check_output(["git", "-C", repo, *args], text=True).strip()


def _commit(repo: Path, message: str) -> str:
    subprocess.run(["git", "-C", repo, "add", "."], check=True)
    subprocess.run(
        [
            "git",
            "-C",
            repo,
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "user.name=Migration Gate",
            "-c",
            "user.email=migration-gate@example.invalid",
            "commit",
            "-qm",
            message,
        ],
        check=True,
    )
    return _git(repo, "rev-parse", "HEAD")


def _repo(tmp_path: Path, migrations: dict[str, str]) -> tuple[Path, str]:
    repo = tmp_path / "repo"
    directory = repo / "supabase/migrations"
    directory.mkdir(parents=True)
    subprocess.run(["git", "init", "-q", repo], check=True)
    for name, sql in migrations.items():
        (directory / name).write_text(sql, encoding="utf-8")
    return repo, _commit(repo, "base")


def _codes(issues) -> set[str]:
    return {issue.code for issue in issues}


def test_clean_additive_sequence_and_cross_ref_number_collision(tmp_path: Path):
    repo, base = _repo(tmp_path, {"001_base.sql": "CREATE TABLE one(id int);\n"})
    migration = repo / "supabase/migrations/002_feature.sql"
    migration.write_text("ALTER TABLE one ADD COLUMN label text;\n", encoding="utf-8")
    head = _commit(repo, "head")

    issues, base_count, head_count, new_count = gate.compare_git(repo, base, head, [])
    assert issues == []
    assert (base_count, head_count, new_count) == (1, 2, 1)

    subprocess.run(["git", "-C", repo, "branch", "other", base], check=True)
    subprocess.run(["git", "-C", repo, "switch", "-q", "other"], check=True)
    (repo / "supabase/migrations/002_other.sql").write_text(
        "CREATE TABLE collision(id int);\n", encoding="utf-8"
    )
    other = _commit(repo, "parallel migration")
    subprocess.run(["git", "-C", repo, "switch", "-q", "master"], check=True)

    issues, *_ = gate.compare_git(repo, base, head, [other])
    assert "cross_number" in _codes(issues)


def test_cross_refs_detect_path_and_blob_identity_conflicts(tmp_path: Path):
    repo, base = _repo(tmp_path, {"001_base.sql": "SELECT 1;\n"})
    candidate = repo / "supabase/migrations/002_feature.sql"
    candidate.write_text("SELECT 'candidate';\n", encoding="utf-8")
    head = _commit(repo, "candidate")

    subprocess.run(["git", "-C", repo, "branch", "path-conflict", base], check=True)
    subprocess.run(["git", "-C", repo, "switch", "-q", "path-conflict"], check=True)
    candidate.write_text("SELECT 'different';\n", encoding="utf-8")
    path_conflict = _commit(repo, "path conflict")

    subprocess.run(["git", "-C", repo, "switch", "-q", "master"], check=True)
    candidate_body = candidate.read_bytes()
    subprocess.run(["git", "-C", repo, "branch", "blob-conflict", base], check=True)
    subprocess.run(["git", "-C", repo, "switch", "-q", "blob-conflict"], check=True)
    (repo / "supabase/migrations/002_feature.sql").unlink(missing_ok=True)
    (repo / "supabase/migrations/002_other.sql").write_bytes(candidate_body)
    blob_conflict = _commit(repo, "blob conflict")
    subprocess.run(["git", "-C", repo, "switch", "-q", "master"], check=True)

    issues, *_ = gate.compare_git(repo, base, head, [path_conflict, blob_conflict])
    assert "cross_path" in _codes(issues)
    assert "cross_blob" in _codes(issues)


@pytest.mark.parametrize(
    ("mutation", "expected"),
    [
        ("modify", "immutable_modified"),
        ("delete", "immutable_deleted"),
        ("rename", "immutable_deleted"),
        ("copy", "historical_blob_reused"),
    ],
)
def test_base_migrations_are_immutable_even_for_byte_identical_moves(
    tmp_path: Path, mutation: str, expected: str
):
    repo, base = _repo(tmp_path, {"001_base.sql": "CREATE TABLE one(id int);\n"})
    original = repo / "supabase/migrations/001_base.sql"
    if mutation == "modify":
        original.write_text("CREATE TABLE one(id bigint);\n", encoding="utf-8")
    elif mutation == "delete":
        original.unlink()
    elif mutation == "rename":
        original.rename(repo / "supabase/migrations/002_base.sql")
    else:
        (repo / "supabase/migrations/002_copy.sql").write_bytes(original.read_bytes())
    head = _commit(repo, mutation)

    issues, *_ = gate.compare_git(repo, base, head, [])
    assert expected in _codes(issues)


def test_exact_base_not_merge_base_rejects_a_branch_behind(tmp_path: Path):
    repo, old = _repo(tmp_path, {"001_base.sql": "SELECT 1;\n"})
    (repo / "supabase/migrations/002_base.sql").write_text("SELECT 2;\n")
    current_base = _commit(repo, "base advanced")

    issues, *_ = gate.compare_git(repo, current_base, old, [])
    assert _codes(issues) == {"history_not_ancestor"}


def _linked_table(local: list[str], remote: list[str]) -> str:
    rows = ["Local | Remote | Time (UTC)", "------|--------|-----------"]
    for index in range(max(len(local), len(remote))):
        left = local[index] if index < len(local) else ""
        right = remote[index] if index < len(remote) else ""
        rows.append(f"{left} | {right} | synthetic")
    return "\n".join(rows) + "\n"


def _fake_supabase(tmp_path: Path, stdout: str, stderr: str = "", code: int = 0):
    binary = tmp_path / "bin/supabase"
    binary.parent.mkdir()
    binary.write_text(
        "#!/usr/bin/env python3\n"
        "import os, sys\n"
        "open(os.environ['FAKE_ARGV'], 'w').write('\\n'.join(sys.argv[1:]))\n"
        f"sys.stdout.write({stdout!r})\n"
        f"sys.stderr.write({stderr!r})\n"
        f"raise SystemExit({code})\n",
        encoding="utf-8",
    )
    binary.chmod(0o755)
    return binary.parent


def _run_wrapper(
    tmp_path: Path, stdout: str, stderr: str = "", code: int = 0, xtrace=False
):
    argv_log = tmp_path / "argv"
    fake_bin = _fake_supabase(tmp_path, stdout, stderr, code)
    env = {
        **os.environ,
        "PATH": f"{fake_bin}{os.pathsep}{os.environ['PATH']}",
        "FAKE_ARGV": str(argv_log),
    }
    argv = ["bash"]
    if xtrace:
        argv.append("-x")
    argv.append(str(WRAPPER))
    result = subprocess.run(argv, text=True, capture_output=True, env=env, check=False)
    return result, argv_log.read_text(encoding="utf-8")


def test_linked_wrapper_uses_only_read_only_argv_and_accepts_exact_history(
    tmp_path: Path,
):
    versions = gate._local_versions(ROOT)
    result, argv = _run_wrapper(tmp_path, _linked_table(versions, versions))

    assert result.returncode == 0
    assert "status=pass stage=linked" in result.stdout
    assert argv.splitlines() == ["migration", "list", "--linked", "--output", "json"]
    assert not ({"repair", "push", "db-url", "link"} & set(argv.splitlines()))


def test_linked_history_fails_when_local_and_remote_diverge_both_ways(tmp_path: Path):
    versions = gate._local_versions(ROOT)
    remote = versions[:-1] + ["20260813000000"]
    result, _ = _run_wrapper(tmp_path, _linked_table(versions, remote))

    assert result.returncode == 1
    assert "history_diverged" in result.stdout
    assert "local_only=1" in result.stdout
    assert "remote_only=1" in result.stdout


@pytest.mark.parametrize("xtrace", [False, True])
def test_linked_wrapper_never_exposes_raw_cli_output_or_diagnostics(
    tmp_path: Path, xtrace: bool
):
    secret = "synthetic-token@private-host.invalid/session/private/path"
    result, _ = _run_wrapper(
        tmp_path,
        f"unparseable {secret}\n",
        f"connection failed: {secret}\n",
        xtrace=xtrace,
    )
    rendered = result.stdout + result.stderr

    assert result.returncode == 1
    assert secret not in rendered
    assert "linked_output_invalid" in rendered


def test_linked_wrapper_sanitizes_cli_failure(tmp_path: Path):
    secret = "synthetic-token@private-host.invalid/session/private/path"
    result, _ = _run_wrapper(tmp_path, secret, secret, code=7)
    rendered = result.stdout + result.stderr

    assert result.returncode == 1
    assert secret not in rendered
    assert (
        rendered.strip()
        == "migration_gate status=fail stage=linked codes=linked_cli_failed:1"
    )


@pytest.fixture(scope="module")
def postgres16_url():
    configured = os.environ.get("JHT_TEST_POSTGRES_URL")
    if configured:
        yield configured
        return
    if not shutil.which("docker") or not shutil.which("psql"):
        pytest.skip("PostgreSQL 16 locale non disponibile")
    if subprocess.run(
        ["docker", "image", "inspect", "postgres:16-alpine"], capture_output=True
    ).returncode:
        pytest.skip("immagine postgres:16-alpine non disponibile")
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    name = "jht-migration-gate-" + uuid.uuid4().hex[:10]
    started = subprocess.run(
        [
            "docker",
            "run",
            "--detach",
            "--rm",
            "--name",
            name,
            "-e",
            "POSTGRES_PASSWORD=synthetic-test-only",
            "-p",
            f"127.0.0.1:{port}:5432",
            "postgres:16-alpine",
        ],
        capture_output=True,
        check=False,
    )
    if started.returncode:
        pytest.fail("PostgreSQL 16 disposable non avviabile")
    try:
        url = f"postgresql://postgres:synthetic-test-only@127.0.0.1:{port}/postgres"
        for _ in range(200):
            if (
                subprocess.run(
                    ["psql", "-X", "--dbname", url, "-c", "SELECT 1"],
                    capture_output=True,
                ).returncode
                == 0
            ):
                break
            time.sleep(0.1)
        else:
            pytest.fail("PostgreSQL 16 disposable non ready")
        yield url
    finally:
        subprocess.run(["docker", "stop", name], capture_output=True, check=False)


def test_new_migrations_run_in_order_on_real_postgresql_16(
    tmp_path: Path, postgres16_url: str, monkeypatch, capsys
):
    repo, base = _repo(
        tmp_path,
        {
            "001_base.sql": "CREATE TABLE public.sequence_probe(id integer PRIMARY KEY);\n"
        },
    )
    (repo / "supabase/migrations/002_depends_on_base.sql").write_text(
        "ALTER TABLE public.sequence_probe ADD COLUMN body text NOT NULL DEFAULT '';\n"
        "INSERT INTO public.sequence_probe(id, body) VALUES (1, 'applied');\n",
        encoding="utf-8",
    )
    head = _commit(repo, "new migration")
    monkeypatch.setenv("JHT_TEST_POSTGRES_URL", postgres16_url)

    result = gate.main(["pg16", "--repo", str(repo), "--base", base, "--head", head])

    assert result == 0
    assert "status=pass stage=pg16" in capsys.readouterr().out


def test_real_project_history_builds_before_a_new_migration_on_pg16(
    tmp_path: Path, postgres16_url: str, monkeypatch, capsys
):
    repo = tmp_path / "full-history"
    directory = repo / "supabase/migrations"
    directory.mkdir(parents=True)
    subprocess.run(["git", "init", "-q", repo], check=True)
    current = sorted((ROOT / "supabase/migrations").glob("[0-9][0-9][0-9]_*.sql"))
    for source in current:
        (directory / source.name).write_bytes(source.read_bytes())
    base = _commit(repo, "real base")
    next_number = int(current[-1].name[:3]) + 1
    (directory / f"{next_number:03d}_gate_probe.sql").write_text(
        "CREATE TABLE public.h08_pg16_probe(id integer PRIMARY KEY);\n",
        encoding="utf-8",
    )
    head = _commit(repo, "probe migration")
    monkeypatch.setenv("JHT_TEST_POSTGRES_URL", postgres16_url)

    result = gate.main(["pg16", "--repo", str(repo), "--base", base, "--head", head])

    assert result == 0
    output = capsys.readouterr().out
    assert f"base={len(current)} new=1 applied=1" in output


def test_pg16_gate_rejects_non_loopback_without_exposing_target(
    tmp_path: Path, monkeypatch, capsys
):
    repo, base = _repo(tmp_path, {"001_base.sql": "SELECT 1;\n"})
    (repo / "supabase/migrations/002_new.sql").write_text("SELECT 2;\n")
    head = _commit(repo, "new")
    secret = "synthetic-token@private-host.invalid"
    monkeypatch.setenv("JHT_TEST_POSTGRES_URL", f"postgresql://{secret}/private")

    result = gate.main(["pg16", "--repo", str(repo), "--base", base, "--head", head])
    output = capsys.readouterr().out

    assert result == 1
    assert "postgres_unavailable" in output
    assert secret not in output


def test_ci_runs_git_and_real_pg16_gates_with_full_history_checkout():
    workflow = (ROOT / ".github/workflows/test.yml").read_text(encoding="utf-8")
    assert "migration-gate:" in workflow
    section = workflow.split("  migration-gate:", 1)[1].split("\n  pytest:", 1)[0]
    assert "postgres:16-alpine" in section
    assert "fetch-depth: 0" in section
    assert "migration_gate.py git" in section
    assert "--fetch-remote origin" in section
    assert "migration_gate.py pg16" in section
    assert "JHT_TEST_POSTGRES_URL" in section
