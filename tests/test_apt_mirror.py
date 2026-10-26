"""scripts/ci/apt-mirror.sh: apt is pointed at a mirror that serves a package fast, before a job installs.

Twice the runner's default mirror served the Playwright libraries and the PDF toolchain at 25-50 kB/s
(10 + 20 minutes) and the pytest job was cancelled at its ceiling.  The script is run here against a
copy of apt's folder and a stand-in for curl that answers a speed per mirror; test.yml is read to
pin that every job that installs from apt runs it first.
"""
import os
import stat
import subprocess
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "ci" / "apt-mirror.sh"
TEST_YML = ROOT / ".github" / "workflows" / "test.yml"

# what the runner's sources name today (http), and the candidates the script asks (https first, as it is by default)
AZURE_HTTP = "http://azure.archive.ubuntu.com/ubuntu"
AZURE = "https://azure.archive.ubuntu.com/ubuntu"
CANON = "https://archive.ubuntu.com/ubuntu"
KERNEL = "https://mirrors.edge.kernel.org/ubuntu"
FAST, SLOW = 90_000_000, 40_000


def _apt(tmp_path: Path) -> Path:
    apt = tmp_path / "apt"
    (apt / "sources.list.d").mkdir(parents=True)
    (apt / "sources.list").write_text(f"deb {AZURE_HTTP}/ noble main\n", encoding="utf-8")
    (apt / "sources.list.d" / "ubuntu.sources").write_text(f"URIs: {AZURE_HTTP}/\nSuites: noble\n", encoding="utf-8")
    (apt / "apt-mirrors.txt").write_text(f"{AZURE_HTTP}/\tpriority:1\n", encoding="utf-8")
    return apt


def _curl(tmp_path: Path, speeds: dict[str, int | None]) -> tuple[Path, Path]:
    """A curl that answers the speed of the mirror in the URL (None: the transfer fails) and logs what it was asked."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    log = tmp_path / "asked.txt"
    table = "\n".join(f"{mirror} {'fail' if bps is None else bps}" for mirror, bps in speeds.items())
    curl = bin_dir / "curl"
    curl.write_text(
        "#!/bin/sh\n"
        'for last; do :; done\n'
        f'echo "$last" >> "{log}"\n'
        f'while read -r mirror bps; do\n'
        '  case "$last" in "$mirror"/*) [ "$bps" = fail ] && exit 22; printf "%s.000" "$bps"; exit 0;; esac\n'
        f'done <<EOF\n{table}\nEOF\n'
        "exit 22\n",
        encoding="utf-8",
    )
    curl.chmod(curl.stat().st_mode | stat.S_IEXEC)
    return bin_dir, log


def _run(tmp_path: Path, speeds: dict[str, int | None], apt: Path | None = None):
    apt = apt or _apt(tmp_path)
    bin_dir, log = _curl(tmp_path, speeds)
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}", "APT_DIR": str(apt)}
    result = subprocess.run(["sh", str(SCRIPT)], capture_output=True, text=True, env=env)
    asked = log.read_text(encoding="utf-8").split() if log.exists() else []
    return result, apt, [url.split("/pool/")[0] for url in asked]


def _hosts(apt: Path) -> set[str]:
    text = "".join(path.read_text(encoding="utf-8") for path in [apt / "sources.list", apt / "apt-mirrors.txt", *(apt / "sources.list.d").iterdir()])
    return {mirror for mirror in (AZURE_HTTP, AZURE, CANON, KERNEL) if mirror in text}


def test_a_fast_default_mirror_is_kept_and_nothing_else_is_asked(tmp_path):
    result, apt, asked = _run(tmp_path, {AZURE: FAST, CANON: FAST, KERNEL: FAST})
    assert result.returncode == 0, result.stderr
    assert asked == [AZURE]
    assert _hosts(apt) == {AZURE_HTTP}, "the same host over https is the same mirror: nothing is rewritten for a scheme"
    assert "keeping" in result.stdout


def test_a_slow_default_mirror_is_replaced_in_every_source_apt_reads(tmp_path):
    apt = _apt(tmp_path)
    # the host is text, not a regular expression: a lookalike with another character where the dots are stays
    lookalike = "deb http://azureXarchiveXubuntuXcom/ubuntu/ noble main\n"
    (apt / "sources.list.d" / "other.list").write_text(lookalike, encoding="utf-8")
    result, apt, asked = _run(tmp_path, {AZURE: SLOW, CANON: FAST, KERNEL: FAST}, apt=apt)
    assert (apt / "sources.list.d" / "other.list").read_text(encoding="utf-8") == lookalike
    assert result.returncode == 0, result.stderr
    assert asked == [AZURE, CANON], "the first fast one wins; the rest is not asked"
    assert _hosts(apt) == {CANON}
    assert (apt / "sources.list").read_text(encoding="utf-8") == f"deb {CANON}/ noble main\n"
    assert f"switched {AZURE_HTTP} -> {CANON}" in result.stdout


def test_a_mirror_that_fails_counts_as_slow(tmp_path):
    result, apt, asked = _run(tmp_path, {AZURE: None, CANON: None, KERNEL: FAST})
    assert asked == [AZURE, CANON, KERNEL]
    assert _hosts(apt) == {KERNEL}


def test_when_none_is_fast_the_sources_are_left_as_they_are(tmp_path):
    apt = _apt(tmp_path)
    before = {path: path.read_text(encoding="utf-8") for path in [apt / "sources.list", apt / "apt-mirrors.txt"]}
    result, _, asked = _run(tmp_path, {AZURE: SLOW, CANON: SLOW, KERNEL: None}, apt=apt)
    assert result.returncode == 0, result.stderr
    assert len(asked) == 3
    assert {path: path.read_text(encoding="utf-8") for path in before} == before
    assert "left as they are" in result.stdout


def test_without_sources_the_script_does_nothing_and_does_not_fail(tmp_path):
    apt = tmp_path / "empty"
    apt.mkdir()
    result, _, asked = _run(tmp_path, {AZURE: FAST}, apt=apt)
    assert result.returncode == 0, result.stderr
    assert asked == []


# ---- test.yml: every job that installs from apt runs the script first ---------

def _installs_from_apt(step: dict) -> bool:
    run = step.get("run", "")
    return "apt-get install" in run or "--with-deps" in run


def test_every_job_that_installs_from_apt_picks_its_mirror_first():
    jobs = yaml.load(TEST_YML.read_text(encoding="utf-8"), Loader=yaml.BaseLoader)["jobs"]
    checked = []
    for name, job in jobs.items():
        steps = job.get("steps", [])
        first = next((i for i, step in enumerate(steps) if _installs_from_apt(step)), None)
        if first is None:
            continue
        picked = next((i for i, step in enumerate(steps) if "scripts/ci/apt-mirror.sh" in step.get("run", "")), None)
        assert picked is not None and picked < first, f"{name}: the mirror is chosen after the first apt install (or never)"
        checked.append(name)
    # the jobs known to install from apt today; a new one is covered by the loop above
    assert {"pytest", "agent-harness", "desktop-rust"} <= set(checked), checked


def test_a_step_with_sudo_in_a_matrix_job_runs_on_linux_only():
    """desktop-rust also runs on macOS and Windows: there is no `sudo` (or no apt) on those, and the job went red on Windows."""
    jobs = yaml.load(TEST_YML.read_text(encoding="utf-8"), Loader=yaml.BaseLoader)["jobs"]
    matrix_jobs = [name for name, job in jobs.items() if "os" in job.get("strategy", {}).get("matrix", {})]
    assert "desktop-rust" in matrix_jobs, matrix_jobs
    for name in matrix_jobs:
        for step in jobs[name]["steps"]:
            if "sudo" in step.get("run", ""):
                assert "runner.os == 'Linux'" in step.get("if", ""), f"{name}: step '{step.get('name')}' uses sudo on every OS of the matrix"
