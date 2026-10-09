"""The Podman machine configuration file the wrapper reads before using it.

The wrapper refuses a JHT Podman machine that mounts more of the Mac than
~/.jht and ~/Documents/Job Hunter Team. It reads the machine's own JSON
(`$XDG_CONFIG_HOME/containers/podman/machine/<provider>/<name>.json`), the
same file `podman machine init` writes. Fixtures that run the wrapper with
the Podman runtime write that file here, in the shape Podman 6.1 writes it
(compact JSON, `Mounts` with `Source`/`Target`), and point XDG_CONFIG_HOME at
the fixture home so a runner's own XDG_CONFIG_HOME is never read.
"""

from __future__ import annotations

import json
from pathlib import Path

# The default mounts of `podman machine init` on macOS, as measured on
# 08/10/2026 on Podman 6.1.3 (applehv).
MACOS_DEFAULT_SOURCES = ("/Users", "/private", "/var/folders")


def _host_kernel(host_kernel: str | None) -> str:
    if host_kernel is None:
        import platform

        host_kernel = platform.system()
    return host_kernel


def _write_uname(bin_dir: Path, kernel: str) -> None:
    uname = bin_dir / "uname"
    uname.write_text(f"#!/bin/sh\nprintf '%s\\n' {kernel}\n", encoding="utf-8")
    uname.chmod(0o700)


def _write_stat_adapter(bin_dir: Path) -> None:
    """Answer both the BSD (`-f '%u %Lp'`) and GNU (`-c '%u %a'`) probes."""
    stat = bin_dir / "stat"
    stat.write_text(
        """#!/usr/bin/env python3
import os
import sys

if len(sys.argv) == 4 and sys.argv[1:3] in (["-f", "%u %Lp"], ["-c", "%u %a"]):
    metadata = os.stat(sys.argv[3], follow_symlinks=False)
    print(f"{metadata.st_uid} {metadata.st_mode & 0o777:o}")
    raise SystemExit(0)
os.execv("/usr/bin/stat", ["stat", *sys.argv[1:]])
""",
        encoding="utf-8",
    )
    stat.chmod(0o700)


def write_macos_host_tools(bin_dir: Path, *, host_kernel: str | None = None) -> None:
    """Emulate macOS tools only when the test host is not already macOS.

    The Python ``stat`` adapter is intentionally absent on a Mac: the wrapper
    calls ``stat`` many times while attesting its runtime, and starting a
    Python interpreter for every native probe more than doubles this suite.
    """
    if _host_kernel(host_kernel) == "Darwin":
        return
    _write_uname(bin_dir, "Darwin")
    _write_stat_adapter(bin_dir)


def write_linux_host_tools(bin_dir: Path, *, host_kernel: str | None = None) -> None:
    """Make the wrapper see Linux; emulate GNU ``stat`` only off Linux.

    The wrapper's Linux branch probes ``stat -c '%u %a'``, which the BSD
    ``stat`` of a macOS runner rejects: there the adapter answers it.
    """
    _write_uname(bin_dir, "Linux")
    if _host_kernel(host_kernel) != "Linux":
        _write_stat_adapter(bin_dir)


def jht_mount_sources(home: Path) -> tuple[str, str]:
    return (str(home / ".jht"), str(home / "Documents" / "Job Hunter Team"))


def write_machine_config(
    home: Path,
    env: dict[str, str],
    *,
    machine: str = "jht-podman",
    sources: tuple[str, ...] | None = None,
    provider: str = "applehv",
) -> Path:
    """Write the machine config (confined by default) and set XDG_CONFIG_HOME."""
    config_home = home / ".config"
    env["XDG_CONFIG_HOME"] = str(config_home)
    mounts = [
        {
            "OriginalInput": "",
            "ReadOnly": False,
            "Source": source,
            "Tag": f"{index:036x}",
            "Target": source,
            "Type": "virtiofs",
            "VSockNumber": None,
        }
        for index, source in enumerate(jht_mount_sources(home) if sources is None else sources)
    ]
    path = config_home / "containers" / "podman" / "machine" / provider / f"{machine}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"Created": "2026-10-08T00:00:00Z", "Mounts": mounts, "Name": machine},
                   separators=(",", ":")),
        encoding="utf-8",
    )
    return path
