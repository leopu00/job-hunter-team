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
