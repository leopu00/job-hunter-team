"""Chiedere aiuto non deve avviare il prodotto (P-07).

Il wrapper chiamava `ensure_up` in cima al catch-all, cioè PRIMA di guardare
cosa avesse chiesto l'utente: `jht --help` scaricava l'immagine (~300 MB) e
creava container e volumi. È il primo comando di chi non ha ancora deciso se
installare, e su una linea a consumo o un disco pieno è un danno vero.

I test girano con un docker FINTO che registra ogni invocazione, così si
distingue «non lo avvia» da «lo ha trovato già avviato» — con Docker acceso
davvero i due casi sono indistinguibili, ed è così che il difetto è passato.
"""

import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
BASH_WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"
POWERSHELL_WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"


def make_docker_spy(tmp_path: Path, *, reachable: bool, container_running: bool):
    """Un docker finto che scrive su un file ogni volta che viene chiamato."""
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir(exist_ok=True)
    log = tmp_path / "docker-calls.log"
    docker = fake_bin / "docker"
    docker.write_text(
        f"""#!/usr/bin/env bash
printf '%s\\n' "$*" >> {log}
case "$1" in
  info) exit {0 if reachable else 1} ;;
  ps)   {'printf "jht\\\\n"' if container_running else 'true'} ;;
  *)    true ;;
esac
""",
        encoding="utf-8",
    )
    docker.chmod(0o755)
    return fake_bin, log


def run_wrapper(args, fake_bin: Path, tmp_path: Path):
    env = {
        "PATH": f"{fake_bin}:/usr/bin:/bin:/usr/sbin:/sbin",
        "HOME": str(tmp_path),
    }
    return subprocess.run(
        ["bash", str(BASH_WRAPPER), *args],
        capture_output=True,
        text=True,
        env=env,
        timeout=60,
    )


def calls(log: Path) -> list[str]:
    return log.read_text(encoding="utf-8").splitlines() if log.exists() else []


def assert_nothing_started(log: Path) -> None:
    started = [c for c in calls(log) if "compose" in c or c.startswith("run ")]
    assert started == [], f"il wrapper ha avviato qualcosa: {started}"


@pytest.mark.parametrize("args", [["--help"], ["-h"], ["help"], []])
def test_help_prints_and_starts_nothing_when_docker_is_unreachable(tmp_path, args):
    fake_bin, log = make_docker_spy(tmp_path, reachable=False, container_running=False)
    res = run_wrapper(args, fake_bin, tmp_path)

    assert res.returncode == 0, res.stderr
    assert "jht" in res.stdout and "jht up" in res.stdout
    assert_nothing_started(log)


@pytest.mark.parametrize("args", [["--help"], []])
def test_help_starts_nothing_when_docker_runs_but_container_is_down(tmp_path, args):
    # Il caso che conta: Docker risponde, il container no. Prima il wrapper
    # faceva `compose up -d` e scaricava l'immagine solo per stampare l'aiuto.
    fake_bin, log = make_docker_spy(tmp_path, reachable=True, container_running=False)
    res = run_wrapper(args, fake_bin, tmp_path)

    assert res.returncode == 0, res.stderr
    assert "jht up" in res.stdout
    assert_nothing_started(log)


def test_subcommand_help_starts_nothing(tmp_path):
    fake_bin, log = make_docker_spy(tmp_path, reachable=True, container_running=False)
    res = run_wrapper(["positions", "--help"], fake_bin, tmp_path)

    assert res.returncode == 0, res.stderr
    assert_nothing_started(log)


def test_version_starts_nothing(tmp_path):
    fake_bin, log = make_docker_spy(tmp_path, reachable=True, container_running=False)
    res = run_wrapper(["--version"], fake_bin, tmp_path)

    assert res.returncode == 0, res.stderr
    assert_nothing_started(log)


def test_a_real_command_still_starts_the_container(tmp_path):
    # Controprova: la correzione non deve aver spento l'avvio dove serve
    # davvero. Senza questo, un wrapper che non avvia MAI nulla passerebbe
    # tutti i test qui sopra.
    fake_bin, log = make_docker_spy(tmp_path, reachable=True, container_running=False)
    run_wrapper(["positions", "list"], fake_bin, tmp_path)

    assert any("compose" in c for c in calls(log)), (
        "un comando vero deve poter avviare il container: " f"{calls(log)}"
    )


def test_both_wrappers_read_before_they_decide():
    """Il difetto era di forma, e la forma va tenuta in entrambi i wrapper."""
    for wrapper in (BASH_WRAPPER, POWERSHELL_WRAPPER):
        text = wrapper.read_text(encoding="utf-8")
        head, _, tail = text.partition("--help")
        assert head, f"{wrapper.name}: nessun ramo per --help"
        # Il ramo informativo deve precedere il catch-all che avvia il
        # container: se torna dopo, il difetto è tornato con lui.
        idx_help = text.index("--help")
        idx_catch_all = max(
            text.rindex("ensure_up") if "ensure_up" in text else -1,
            text.rindex("Ensure-Up") if "Ensure-Up" in text else -1,
        )
        assert idx_help < idx_catch_all, (
            f"{wrapper.name}: il ramo --help non precede più l'avvio del container"
        )
