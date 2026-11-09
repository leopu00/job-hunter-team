#!/usr/bin/env python3
"""optional_libs.py — a Python library that is NOT in the image, installed the first time something needs it.

The Google Drive client (`google-api-python-client`) is ~100 MB and one script uses it (db_to_drive.py): shipping it in the image
made every first setup download it. `ensure(...)` installs it in the user lane (`jht-install py`, which is `uv pip install --user`
into $PYTHONUSERBASE, the one store the team uses for extras) when the import fails, and says plainly what to do when it cannot
(no network, the egress proxy refusing, no room).

    from optional_libs import ensure
    ensure("googleapiclient", "google-api-python-client==2.198.0", "Google Drive")
"""
from __future__ import annotations

import importlib
import importlib.util
import shutil
import site
import subprocess
import sys

INSTALL_SECONDS = 300


def _importable(module: str) -> bool:
    importlib.invalidate_caches()
    try:
        return importlib.util.find_spec(module) is not None
    except (ImportError, ValueError):
        return False


def _installer(requirement: str) -> list[str]:
    """The team's own way first (`jht-install py`), then the plain tools it falls back to."""
    if shutil.which("jht-install"):
        return ["jht-install", "py", requirement]
    if shutil.which("uv"):
        return ["uv", "pip", "install", "--user", requirement]
    return [sys.executable, "-m", "pip", "install", "--user", requirement]


def ensure(module: str, requirement: str, what: str, *, run=subprocess.run, importable=_importable, out=sys.stderr) -> None:
    """Return when `module` can be imported; install `requirement` first if it cannot. Exit 2 with a plain message if that fails."""
    if importable(module):
        return
    print(f"{what} needs {requirement}, which is not in the image: installing it now (once, from the Python index)...", file=out)
    try:
        done = run(_installer(requirement), capture_output=True, text=True, timeout=INSTALL_SECONDS, check=False)
        failed = done.returncode != 0
        detail = ((done.stderr or "") + (done.stdout or "")).strip().splitlines()[-1:] or [""]
    except (OSError, subprocess.SubprocessError) as exc:
        failed, detail = True, [type(exc).__name__]
    if not failed:
        try:
            site.addsitedir(site.getusersitepackages())  # the user store may not have existed when Python started
        except Exception:
            pass
        failed = not importable(module)
    if failed:
        print(f"{what} cannot be used now: {requirement} could not be installed ({detail[0][:200]}). "
              "It is downloaded from the Python index, so it needs the network: check the connection and run the command again.", file=out)
        raise SystemExit(2)
    print(f"{what}: {requirement} installed.", file=out)
