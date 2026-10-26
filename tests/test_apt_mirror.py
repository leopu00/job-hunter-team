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

# What else the runner's apt reads: the repositories whose path starts with /ubuntu are not the Ubuntu archive.
# microsoft-prod.list sorts BEFORE ubuntu.sources and the mirror list, as on the runner: the first run with
# the script took Microsoft's host for the Ubuntu mirror, rewrote it, and apt-get update exited 100 in three jobs.
OTHERS = {
    "microsoft-prod.list": "deb [arch=amd64,arm64,armhf signed-by=/usr/share/keyrings/microsoft-prod.gpg] https://packages.microsoft.com/ubuntu/24.04/prod noble main\n",
    "azure-cli.sources": "Types: deb\nURIs: https://packages.microsoft.com/repos/azure-cli/\nSuites: noble\nComponents: main\n",
    "github-cli.list": "deb [arch=amd64 signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main\n",
    "toolchain.list": "deb https://ppa.launchpadcontent.net/ubuntu-toolchain-r/test/ubuntu noble main\n",
}


def _apt(tmp_path: Path) -> Path:
    """A copy of the runner's layout: deb822 Ubuntu sources that read the mirror list, the list, and other repositories."""
    apt = tmp_path / "apt"
    (apt / "sources.list.d").mkdir(parents=True)
    (apt / "sources.list").write_text("# see /etc/apt/sources.list.d/ubuntu.sources\n", encoding="utf-8")
    (apt / "sources.list.d" / "ubuntu.sources").write_text(
        "Types: deb\nURIs: mirror+file:/etc/apt/apt-mirrors.txt\nSuites: noble noble-updates noble-backports\nComponents: main universe\n",
        encoding="utf-8",
    )
    for name, text in OTHERS.items():
        (apt / "sources.list.d" / name).write_text(text, encoding="utf-8")
    (apt / "apt-mirrors.txt").write_text(
        f"{AZURE_HTTP}/\tpriority:1\n{CANON}/\tpriority:2\nhttps://security.ubuntu.com/ubuntu/\tpriority:3\n", encoding="utf-8"
    )
    return apt


def _curl(tmp_path: Path, speeds: dict[str, int | None], no_index: str = "") -> tuple[Path, Path]:
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
        f'case "$last" in */InRelease) case "$last" in *"{no_index}"*) exit 22;; esac; exit 0;; esac\n'
        f'while read -r mirror bps; do\n'
        '  case "$last" in "$mirror"/*) [ "$bps" = fail ] && exit 22; printf "%s.000" "$bps"; exit 0;; esac\n'
        f'done <<EOF\n{table}\nEOF\n'
        "exit 22\n",
        encoding="utf-8",
    )
    curl.chmod(curl.stat().st_mode | stat.S_IEXEC)
    return bin_dir, log


def _run(tmp_path: Path, speeds: dict[str, int | None], apt: Path | None = None, no_index: str = "", codename: str = "noble"):
    apt = apt or _apt(tmp_path)
    bin_dir, log = _curl(tmp_path, speeds, no_index or "/dists/none-will-match/")
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}", "APT_DIR": str(apt), "APT_RELEASE_CODENAME": codename}
    result = subprocess.run(["sh", str(SCRIPT)], capture_output=True, text=True, env=env)
    asked = log.read_text(encoding="utf-8").split() if log.exists() else []
    probes = [url.split("/pool/")[0] for url in asked if "/pool/" in url]
    return result, apt, probes


def _text(apt: Path) -> str:
    return "".join(path.read_text(encoding="utf-8") for path in sorted(apt.rglob("*")) if path.is_file())


def _others_untouched(apt: Path) -> bool:
    return all((apt / "sources.list.d" / name).read_text(encoding="utf-8") == text for name, text in OTHERS.items())


def test_a_fast_default_mirror_is_kept_and_nothing_else_is_asked(tmp_path):
    apt = _apt(tmp_path)
    before = _text(apt)
    result, apt, probes = _run(tmp_path, {AZURE_HTTP: FAST, AZURE: 0, CANON: FAST, KERNEL: FAST}, apt=apt)
    assert result.returncode == 0, result.stderr
    assert probes == [AZURE_HTTP], "the mirror in use is measured as apt reaches it (http), and nothing else is asked"
    assert _text(apt) == before
    assert "keeping" in result.stdout


def test_a_slow_default_mirror_is_replaced_and_only_the_ubuntu_archive_is_touched(tmp_path):
    result, apt, probes = _run(tmp_path, {AZURE_HTTP: SLOW, CANON: FAST, KERNEL: FAST})
    assert result.returncode == 0, result.stderr
    assert probes == [AZURE_HTTP, CANON], "azure over https is the same host: not asked again; the first fast one wins"
    assert AZURE_HTTP not in _text(apt)
    assert (apt / "apt-mirrors.txt").read_text(encoding="utf-8").startswith(f"{CANON}/\tpriority:1\n")
    assert _others_untouched(apt), "Microsoft's, GitHub's and the PPA's repositories are not the Ubuntu archive"
    assert f"switched {AZURE_HTTP} -> {CANON}" in result.stdout


def test_microsoft_repository_sorting_before_the_ubuntu_sources_is_never_taken_for_the_mirror(tmp_path):
    """The run that broke three jobs: the first /ubuntu in the files was packages.microsoft.com."""
    result, apt, probes = _run(tmp_path, {AZURE_HTTP: SLOW, CANON: FAST})
    assert all("packages.microsoft.com" not in probe for probe in probes), probes
    assert "packages.microsoft.com" not in result.stdout, result.stdout


def test_a_mirror_that_fails_counts_as_slow(tmp_path):
    result, apt, probes = _run(tmp_path, {AZURE_HTTP: None, CANON: None, KERNEL: FAST})
    assert probes == [AZURE_HTTP, CANON, KERNEL]
    assert AZURE_HTTP not in _text(apt)
    assert (apt / "apt-mirrors.txt").read_text(encoding="utf-8").startswith(f"{KERNEL}/\tpriority:1\n")
    assert _others_untouched(apt)


@pytest.mark.parametrize("missing", ["/dists/noble/", "/dists/noble-updates/", "/dists/noble-backports/"])
def test_a_mirror_missing_an_index_apt_reads_changes_nothing(tmp_path, missing):
    apt = _apt(tmp_path)
    before = _text(apt)
    result, apt, _ = _run(tmp_path, {AZURE_HTTP: SLOW, CANON: FAST}, apt=apt, no_index=missing)
    assert result.returncode == 0, result.stderr
    assert _text(apt) == before, "an archive apt cannot read is an apt-get update that exits 100"
    assert "has no index" in result.stdout


def test_without_the_release_name_nothing_changes(tmp_path):
    apt = _apt(tmp_path)
    before = _text(apt)
    result, apt, _ = _run(tmp_path, {AZURE_HTTP: SLOW, CANON: FAST}, apt=apt, codename="")
    assert result.returncode == 0, result.stderr
    assert _text(apt) == before
    assert "release name is unknown" in result.stdout


def test_when_none_is_fast_the_sources_are_left_as_they_are(tmp_path):
    apt = _apt(tmp_path)
    before = _text(apt)
    result, _, probes = _run(tmp_path, {AZURE_HTTP: SLOW, CANON: SLOW, KERNEL: None}, apt=apt)
    assert result.returncode == 0, result.stderr
    assert len(probes) == 3
    assert _text(apt) == before
    assert "left as they are" in result.stdout


def test_sources_that_name_no_ubuntu_archive_are_left_alone(tmp_path):
    apt = tmp_path / "apt"
    (apt / "sources.list.d").mkdir(parents=True)
    (apt / "sources.list.d" / "microsoft-prod.list").write_text(OTHERS["microsoft-prod.list"], encoding="utf-8")
    result, _, probes = _run(tmp_path, {AZURE_HTTP: SLOW, CANON: FAST}, apt=apt)
    assert result.returncode == 0, result.stderr
    assert probes == []
    assert (apt / "sources.list.d" / "microsoft-prod.list").read_text(encoding="utf-8") == OTHERS["microsoft-prod.list"]


def test_without_sources_the_script_does_nothing_and_does_not_fail(tmp_path):
    apt = tmp_path / "empty"
    apt.mkdir()
    result, _, probes = _run(tmp_path, {AZURE_HTTP: FAST}, apt=apt)
    assert result.returncode == 0, result.stderr
    assert probes == []


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
