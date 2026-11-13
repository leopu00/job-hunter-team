"""Since 0.4 install.sh runs JHT only on Podman, and never on top of a Docker install.

The marker container-runtime says which engine holds the container and its
volumes. Podman is the default and the only choice; --runtime for an engine of
the past (colima, docker, docker-desktop, orbstack) is refused before anything.
A computer that runs JHT on Docker (marker docker, or a completed install
without the marker, as the Docker path left it) is refused with its own exit
and words that say what stays (~/.jht and the documents) and what must be given
again (the API key, the mail password, the Telegram tokens live in Docker's
volumes), and the three steps to move.
"""

import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
INSTALL = ROOT / "scripts" / "install.sh"


def keep(tmp_path: Path, marker: str | None, *args: str, os_name: str = "macos",
         link: bool = False, files: tuple[str, ...] = (), env: dict[str, str] | None = None,
         home_files: dict[str, str] | None = None) -> subprocess.CompletedProcess:
    runtime = tmp_path / "runtime"
    runtime.mkdir(exist_ok=True)
    for name in files:
        (runtime / name).write_text("synthetic\n", encoding="utf-8")
    if marker is not None:
        target = runtime / "container-runtime"
        if link:
            real = tmp_path / "elsewhere"
            real.write_text(marker + "\n", encoding="utf-8")
            target.symlink_to(real)
        else:
            target.write_text(marker + "\n", encoding="utf-8")
    script = (
        f'JHT_INSTALLER_SOURCE_ONLY=1 . "{INSTALL}" "$@"\n'
        f"OS={os_name}\n"
        "keep_chosen_runtime\n"
        'printf "choice=%s\\n" "$RUNTIME_CHOICE"\n'
    )
    home = tmp_path / "home"
    home.mkdir(exist_ok=True)
    for name, text in (home_files or {}).items():
        (home / name).parent.mkdir(parents=True, exist_ok=True)
        if text.endswith("/"):
            (home / name).mkdir(exist_ok=True)
        else:
            (home / name).write_text(text, encoding="utf-8")
    return subprocess.run(
        ["bash", "-c", script, "install.sh", *args],
        env={"PATH": "/usr/bin:/bin", "HOME": str(home), "JHT_RUNTIME_DIR": str(runtime), **(env or {})},
        capture_output=True, text=True, timeout=30,
    )


def choice(result: subprocess.CompletedProcess) -> str:
    assert result.returncode == 0, result.stderr
    return re.search(r"^choice=(.*)$", result.stdout, re.M).group(1)


def test_a_podman_rerun_without_runtime_stays_podman(tmp_path):
    assert choice(keep(tmp_path, "podman")) == "podman"


@pytest.mark.parametrize("os_name", ["macos", "linux"])
@pytest.mark.parametrize("args", [(), ("--runtime", "podman"), ("--runtime=auto",)])
def test_a_new_computer_gets_podman(tmp_path, os_name, args):
    assert choice(keep(tmp_path, None, *args, os_name=os_name)) == "podman"


@pytest.mark.parametrize("engine", ["colima", "docker", "docker-desktop", "orbstack"])
def test_an_engine_of_the_past_is_refused_before_anything(tmp_path, engine):
    result = keep(tmp_path, None, "--runtime", engine)
    assert result.returncode == 2
    assert "choice=" not in result.stdout
    assert f"runtime_not_supported: --runtime {engine}" in result.stderr
    assert "only on Podman" in result.stderr and "without --runtime" in result.stderr
    assert not (tmp_path / "runtime" / "container-runtime").exists()


def refused_on_docker(result: subprocess.CompletedProcess) -> None:
    assert result.returncode == 85  # its own exit, which the app maps (onboarding.rs)
    assert "choice=" not in result.stdout
    assert result.stderr.startswith("JHT_ERROR runtime_change_requires_migration\n")
    text = " ".join(result.stderr.split())
    assert "runs JHT on Docker" in text and "nothing was changed" in text
    # what stays, what has to be given again, and the steps
    assert "~/.jht" in text and "~/Documents/Job Hunter Team" in text
    assert "API key" in text and "mail password" in text and "Telegram tokens" in text
    assert text.index("jht uninstall --confirm") < text.index("run this installer again") < text.index("jht setup")


@pytest.mark.parametrize("args", [(), ("--runtime", "podman")])
def test_a_mac_on_docker_is_refused_and_told_what_stays(tmp_path, args):
    result = keep(tmp_path, "docker", *args)
    refused_on_docker(result)
    assert (tmp_path / "runtime" / "container-runtime").read_text(encoding="utf-8") == "docker\n"


# A completed install without the marker (.runtime-integrity, published last) is Docker:
# the Docker path of Linux never wrote the marker, nor did a Mac before it.
@pytest.mark.parametrize("os_name", ["linux", "macos"])
@pytest.mark.parametrize("args", [(), ("--runtime", "podman")])
def test_a_completed_install_without_the_marker_is_docker_and_refused(tmp_path, os_name, args):
    result = keep(tmp_path, None, *args, os_name=os_name,
                  files=("docker-compose.yml", ".runtime-integrity"))
    refused_on_docker(result)
    assert not (tmp_path / "runtime" / "container-runtime").exists()


@pytest.mark.parametrize("how", ["host_env", "locale"])
def test_the_refusal_is_said_in_italian_to_an_italian_person(tmp_path, how):
    home_files = {".jht/host.env": "JHT_HOST_TYPE=local\nJHT_LANG=it\n"} if how == "host_env" else {}
    env = {} if how == "host_env" else {"LANG": "it_IT.UTF-8"}
    result = keep(tmp_path, "docker", home_files=home_files, env=env)
    assert result.returncode == 85
    assert result.stderr.startswith("JHT_ERROR runtime_change_requires_migration\n")  # the code stays the same for the app
    text = " ".join(result.stderr.split())
    assert "questo computer fa girare JHT su Docker" in text and "non e' stato cambiato niente" in text
    assert "~/.jht" in text and "~/Documents/Job Hunter Team" in text
    assert "chiave API" in text and "password della posta" in text and "token di Telegram" in text
    assert text.index("jht uninstall --confirm") < text.index("rilancia questo installer") < text.index("jht setup")


def test_a_language_that_is_not_italian_gets_english(tmp_path):
    result = keep(tmp_path, "docker", env={"LANG": "de_DE.UTF-8"})
    assert "this computer runs JHT on Docker" in result.stderr


def test_the_colima_jht_started_is_named_with_the_command_that_removes_it(tmp_path):
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    (runtime / "colima-started").write_text("colima\nwork\n", encoding="utf-8")
    result = keep(tmp_path, "docker")
    text = " ".join(result.stderr.split())
    assert result.returncode == 85
    assert "Colima virtual machine JHT created (profile work)" in text and "colima delete -p work" in text
    assert "-p default" not in text


def test_without_the_marker_the_default_profile_is_named_only_when_it_is_there_and_only_conditionally(tmp_path):
    with_default = keep(tmp_path, "docker", home_files={".colima/default/": "/"})
    text = " ".join(with_default.stderr.split())
    assert "If you installed Colima only for JHT" in text and "colima delete -p default" in text
    assert "If you use Colima for other things, leave it." in text
    other = tmp_path / "other"
    other.mkdir()
    without = keep(other, "docker")
    assert without.returncode == 85 and "colima delete" not in without.stderr


def test_a_linux_server_on_docker_is_not_told_about_colima(tmp_path):
    result = keep(tmp_path, None, os_name="linux", files=("docker-compose.yml", ".runtime-integrity"),
                  home_files={".colima/default/": "/"})
    assert result.returncode == 85 and "colima" not in result.stderr.lower().replace("(colima, docker desktop", "")


def test_a_marker_that_is_a_link_or_names_a_strange_profile_names_nothing(tmp_path):
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    (runtime / "colima-started").write_text("colima\n-rf\n", encoding="utf-8")
    assert "colima delete" not in keep(tmp_path, "docker").stderr


def test_a_first_podman_install_stopped_half_way_may_run_again(tmp_path):
    # the compose is downloaded before the Podman marker is written; the manifest comes last
    result = keep(tmp_path, None, os_name="linux", files=("docker-compose.yml",))
    assert choice(result) == "podman"


def test_linux_on_rootless_podman_keeps_podman_on_a_rerun(tmp_path):
    assert choice(keep(tmp_path, "podman", os_name="linux")) == "podman"


def test_an_unsafe_or_unknown_marker_stops_the_installer(tmp_path):
    linked = keep(tmp_path, "podman", link=True)
    assert linked.returncode == 1 and "Unsafe JHT runtime selection marker" in linked.stderr
    other = tmp_path / "other"
    other.mkdir()
    unknown = keep(other, "colima")
    assert unknown.returncode == 1 and "Invalid JHT runtime selection marker" in unknown.stderr


def test_main_settles_the_runtime_before_anything_is_installed():
    text = INSTALL.read_text(encoding="utf-8")
    main = re.search(r"^main\(\) \{\n.*?^\}\n", text, re.S | re.M).group(0)
    assert main.index("keep_chosen_runtime") < main.index("header")
    assert main.index("keep_chosen_runtime") < main.index("main_docker")
    # Nothing publishes a docker marker any more.
    assert "printf 'docker\\n'" not in text


def test_the_published_copy_and_the_desktop_digest_follow_install_sh():
    import hashlib
    assert (ROOT / "web" / "public" / "install.sh").read_bytes() == INSTALL.read_bytes()
    digest = (ROOT / "desktop" / "src-tauri" / "installer.sha256").read_text(encoding="utf-8").strip()
    assert digest == hashlib.sha256(INSTALL.read_bytes()).hexdigest()


def test_at_a_terminal_the_refusal_says_only_the_sentence(tmp_path):
    # the marker is the app's (JHT_MACHINE_OUTPUT=1, or a pipe): a person at a terminal reads the sentence, with the same exit
    result = keep(tmp_path, "docker", env={"JHT_MACHINE_OUTPUT": "0"})
    assert result.returncode == 85
    assert "JHT_ERROR" not in result.stderr + result.stdout
    assert "runs JHT on Docker" in " ".join(result.stderr.split())
