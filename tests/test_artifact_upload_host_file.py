"""`jht artifact upload FILE`: the CV is a file of the person on the host, and the folder it goes into belongs to the container.

On Linux, as a user with uid 1000, `allegati/` is owned by the container's user (1001:700) and the CLI inside the container
cannot even see the host path: the upload died with ENOENT. The host wrapper reads the file with the person's own rights and
hands the bytes over on stdin; nothing is written by the host, so nobody needs sudo.
"""

from __future__ import annotations

import base64
import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest
from test_desktop_chat_wrapper import _runtime

ROOT = Path(__file__).resolve().parents[1]
JHT = ROOT / "cli" / "bin" / "jht.js"
PDF = b"%PDF-1.4\n1 0 obj <<>> endobj\nstartxref\n0\n%%EOF\n"
LIMIT = 10 * 1024 * 1024


def _run(tmp_path: Path, *args: str) -> tuple[subprocess.CompletedProcess, list[str], Path]:
    wrapper, env, log = _runtime(tmp_path)
    env["JHT_TEST_RUNTIME_READY"] = "1"
    copy = tmp_path / "stdin-copy"
    env["JHT_TEST_STDIN_COPY"] = str(copy)
    done = subprocess.run([str(wrapper), *args], env=env, text=True, capture_output=True, timeout=20, check=False)
    return done, log.read_text(encoding="utf-8").splitlines(), copy


def _uploads(calls: list[str]) -> list[str]:
    return [line for line in calls if "artifact upload" in line]


def _sub(tmp_path: Path, name: str) -> Path:
    path = tmp_path / name
    path.mkdir()
    return path


def _file(folder: Path, content: bytes = PDF, name: str = "cv.pdf") -> Path:
    path = folder / name
    path.write_bytes(content)
    return path


def test_the_cv_goes_to_the_attested_container_on_stdin_with_its_name(tmp_path: Path):
    source = _file(tmp_path)
    done, calls, copy = _run(tmp_path, "artifact", "upload", str(source), "--json")
    assert done.returncode == 0, done.stderr
    (call,) = _uploads(calls)
    assert call.startswith("docker exec -i aaaaaaaaaaaa node ") and call.endswith("artifact upload --stdin --name cv.pdf --json")
    assert str(source) not in call, "the container is never given a host path"
    assert copy.read_bytes() == PDF


def test_a_folder_the_person_cannot_write_is_no_obstacle(tmp_path: Path):
    # the CV sits in a read-only folder, as a file of someone else's would: the wrapper only reads it
    folder = _sub(tmp_path, "sola-lettura")
    source = _file(folder)
    folder.chmod(0o555)
    try:
        done, calls, copy = _run(tmp_path, "artifact", "upload", str(source))
    finally:
        folder.chmod(0o755)
    assert done.returncode == 0, done.stderr
    assert len(_uploads(calls)) == 1 and copy.read_bytes() == PDF


def test_a_file_of_exactly_ten_mib_goes_and_one_byte_more_does_not(tmp_path: Path):
    ok = _file(tmp_path, b"a" * LIMIT, "limit.pdf")
    done, calls, copy = _run(tmp_path, "artifact", "upload", str(ok))
    assert done.returncode == 0 and len(_uploads(calls)) == 1 and copy.stat().st_size == LIMIT

    over = _sub(tmp_path, "over")
    big = _file(over, b"a" * (LIMIT + 1), "big.pdf")
    done, calls, _ = _run(over, "artifact", "upload", str(big))
    assert done.returncode == 1 and "10 MB" in done.stderr
    assert _uploads(calls) == []


def test_a_missing_file_or_a_link_never_reaches_the_container(tmp_path: Path):
    done, calls, _ = _run(tmp_path, "artifact", "upload", str(tmp_path / "missing.pdf"))
    assert done.returncode == 1 and "file regolare" in done.stderr
    assert _uploads(calls) == []

    other = _sub(tmp_path, "link")
    link = other / "link.pdf"
    link.symlink_to(_file(other, PDF, "real.pdf"))
    done, calls, _ = _run(other, "artifact", "upload", str(link))
    assert done.returncode == 1 and "link" in done.stderr
    assert _uploads(calls) == []


@pytest.mark.parametrize(
    "args",
    (
        ("artifact", "upload", "a.pdf", "b.pdf"),
        ("artifact", "upload", "a.pdf", "--nope"),
    ),
)
def test_a_wrong_ask_answers_2_and_runs_nothing(tmp_path: Path, args: tuple):
    done, calls, _ = _run(tmp_path, *args)
    assert done.returncode == 2, done.stderr
    assert _uploads(calls) == []


def test_help_and_the_other_verbs_keep_going_to_the_cli_unchanged(tmp_path: Path):
    done, calls, _ = _run(tmp_path, "artifact", "upload", "--help")
    assert done.returncode == 0, done.stderr
    assert any(line.endswith("artifact upload --help") for line in calls)
    assert all("--stdin" not in line for line in calls)

    done, calls, _ = _run(_sub(tmp_path, "fetch"), "artifact", "fetch", "/jht_user/cv/cv.pdf")
    assert done.returncode == 0, done.stderr
    assert any(line.endswith("artifact fetch /jht_user/cv/cv.pdf") for line in calls)


# ── the CLI inside the container: bytes on stdin, the name on the command line ────────────────

def _cli(area: Path, data: bytes, *args: str) -> subprocess.CompletedProcess:
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed")
    # a PATH without docker: the skill runs from the checkout, against the folder given by JHT_ARTIFACT_ROOT
    bin_dir = area / "bin"
    bin_dir.mkdir(exist_ok=True)
    if not (bin_dir / "node").exists():
        (bin_dir / "node").symlink_to(node)
    env = {"PATH": str(bin_dir) + os.pathsep + "/usr/bin:/bin", "HOME": str(area), "JHT_ARTIFACT_ROOT": str(area / "data"), "NO_COLOR": "1"}
    (area / "data" / "allegati").mkdir(parents=True, exist_ok=True)
    return subprocess.run([node, str(JHT), "artifact", "upload", *args], input=data, env=env, capture_output=True, timeout=60, check=False)


def test_the_cli_writes_the_bytes_it_is_given_under_the_name_it_is_given(tmp_path: Path):
    done = _cli(tmp_path, PDF, "--stdin", "--name", "cv.pdf", "--json")
    assert done.returncode == 0, done.stderr
    assert json.loads(done.stdout)["path"] == "/jht_user/allegati/cv.pdf"
    assert (tmp_path / "data" / "allegati" / "cv.pdf").read_bytes() == PDF


def test_the_cli_keeps_the_name_a_plain_file_name_and_the_extension_list(tmp_path: Path):
    done = _cli(tmp_path, PDF, "--stdin", "--name", "../../etc/cv.pdf")
    assert done.returncode == 0, done.stderr
    assert [p.name for p in (tmp_path / "data" / "allegati").iterdir()] == ["cv.pdf"]

    done = _cli(tmp_path, b"x", "--stdin", "--name", "payload.exe")
    assert done.returncode != 0
    assert [p.name for p in (tmp_path / "data" / "allegati").iterdir()] == ["cv.pdf"]


def test_the_cli_refuses_stdin_without_a_name_or_with_a_path_and_a_missing_path_without_stdin(tmp_path: Path):
    assert _cli(tmp_path, PDF, "--stdin").returncode == 2
    assert _cli(tmp_path, PDF, "--stdin", "--name", "cv.pdf", "other.pdf").returncode == 2
    assert _cli(tmp_path, b"").returncode == 2
    assert list((tmp_path / "data" / "allegati").iterdir()) == []


def test_the_cli_refuses_more_than_ten_mib_on_stdin(tmp_path: Path):
    done = _cli(tmp_path, b"a" * (LIMIT + 1), "--stdin", "--name", "big.pdf")
    assert done.returncode == 2 and b"10 MB" in done.stderr
    assert list((tmp_path / "data" / "allegati").iterdir()) == []
