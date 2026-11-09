#!/usr/bin/env python3
"""optional_libs.py — a Python library that is NOT in the image, installed the first time something needs it.

The Google Drive client (`google-api-python-client`) is ~100 MB and one script uses it (db_to_drive.py): shipping it in the image
made every first setup download it. `ensure(...)` installs it in the user lane (`jht-install py`, which is `uv pip install --user`
into $PYTHONUSERBASE, the one store the team uses for extras) when the import fails, and says plainly what to do when it cannot
(no network, the egress proxy refusing, no room).

    from optional_libs import ensure, GOOGLE_DRIVE
    ensure(*GOOGLE_DRIVE, "Google Drive")

`module` and `requirement` may each be one name or several: the library is considered there when EVERY module imports, and a
missing one installs the whole set of requirements in one go.
"""
from __future__ import annotations

import importlib
import importlib.util
import shutil
import site
import subprocess
import sys

INSTALL_SECONDS = 300

# The Google integration (T315: nothing optional in the initial image). Pinned like the image's own requirements were; protobuf
# keeps the pin raised by hand for an advisory (the Drive client pulls it in). (modules to import, requirements to install)
_GOOGLE_BASE = ("google-auth==2.56.2", "google-auth-oauthlib==1.4.0")
GOOGLE_DRIVE = (("google.oauth2", "google_auth_oauthlib", "googleapiclient"),
                (*_GOOGLE_BASE, "google-api-python-client==2.198.0", "protobuf==6.33.5"))
GOOGLE_SHEETS = (("google.oauth2", "gspread"), (*_GOOGLE_BASE, "gspread==6.2.1"))


def _importable(module: str) -> bool:
    importlib.invalidate_caches()
    try:
        return importlib.util.find_spec(module) is not None
    except (ImportError, ValueError):
        return False


def _installer(requirements: tuple[str, ...]) -> list[str]:
    """The team's own way first (`jht-install py`), then the plain tools it falls back to."""
    if shutil.which("jht-install"):
        return ["jht-install", "py", *requirements]
    if shutil.which("uv"):
        return ["uv", "pip", "install", "--user", *requirements]
    return [sys.executable, "-m", "pip", "install", "--user", *requirements]


def _names(value) -> tuple[str, ...]:
    return (value,) if isinstance(value, str) else tuple(value)


def ensure(module, requirement, what: str, *, run=subprocess.run, importable=_importable, out=sys.stderr) -> None:
    """Return when every `module` can be imported; install the `requirement`s first if one cannot. Exit 2 with a plain message if that fails."""
    modules, requirements = _names(module), _names(requirement)
    if all(importable(name) for name in modules):
        return
    needed = ", ".join(requirements)
    print(f"{what} needs {needed}, which is not in the image: installing it now (once, from the Python index)...", file=out)
    try:
        done = run(_installer(requirements), capture_output=True, text=True, timeout=INSTALL_SECONDS, check=False)
        failed = done.returncode != 0
        detail = ((done.stderr or "") + (done.stdout or "")).strip().splitlines()[-1:] or [""]
    except (OSError, subprocess.SubprocessError) as exc:
        failed, detail = True, [type(exc).__name__]
    if not failed:
        try:
            site.addsitedir(site.getusersitepackages())  # the user store may not have existed when Python started
        except Exception:
            pass
        failed = not all(importable(name) for name in modules)
    if failed:
        print(f"{what} cannot be used now: {needed} could not be installed ({detail[0][:200]}). "
              "It is downloaded from the Python index, so it needs the network: check the connection and run the command again.", file=out)
        raise SystemExit(2)
    print(f"{what}: {needed} installed.", file=out)
