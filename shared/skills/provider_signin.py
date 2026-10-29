#!/usr/bin/env python3
"""provider_signin.py — the provider's sign-in on the team's home: see it, and take it off.

The desktop app's «Disconnect the account» goes through `jht agent-control provider status|logout`, which runs
this file in the container. What `logout` does is `rm` of the provider's own credential files, which any agent
of the team can already do for itself; the app's confirmation is in the app, not here.

- The provider is never an argument: it is the team's active provider (`jht.config.json`), and only a
  subscription sign-in counts. The files are a CLOSED list per provider, written here. The config only chooses
  among the three lists, it never names a path (an agent can write that file).
- Each file is reached from the home with open(O_NOFOLLOW) of one folder after the other, each relative to the
  folder opened before (`dir_fd`), and removed with unlink relative to the last folder opened: a link anywhere
  on the way, or a folder or a link in place of the file, is left alone and counted, and a folder swapped for a
  link while this runs is not followed either (the folder already open is the one that is used). Never
  recursive, never following a link.
- It answers `authenticated:false` only if nothing of the list is left afterwards, looked at again AFTER the
  unlinks: an agent that was running may write the file back when it renews its token. Anything left is
  `provider_logout_incomplete`, never a «disconnected» that is not true.
- It only removes. The paths that mark a sign-in are read, never written, by the boot check (pid1.js
  `hasProviderCredentials`) and by the onboarding snapshot of the host wrapper; nothing copies them back.
- There is no confirmation here: an agent can run this too, which is `rm` of its own team's files.

Kimi: only the files that hold the sign-in. `.kimi/credentials/kimi-code.json` is where the current CLI writes
it (the marker the boot check looks at); `.kimi/config.json`, `.config/kimi/config.json` and `.kimi/kimi.json`
are the CLI's settings and bookkeeping, not a login, and are never removed.

Prints one JSON line. Exit 0 = ok, 1 = a closed error code, 100 = the form is not `status` or `logout`.
"""
from __future__ import annotations

import json
import os
import stat
import sys

HOME = "/jht_home"

# The credential files of each provider, relative to the home; the first one is the marker of a sign-in.
CREDENTIAL_FILES: dict[str, tuple[str, ...]] = {
    "claude": (".claude/.credentials.json", ".claude/credentials.json", ".config/claude/credentials.json", ".config/claude/auth.json"),
    "codex": (".codex/auth.json", ".codex/credentials.json", ".config/codex/credentials.json"),
    "kimi": (".kimi/credentials/kimi-code.json", ".config/kimi-cli/credentials.json", ".kimi/credentials.json"),
}

# The names the config may hold for each (the vendor's and the CLI's), the same ones the boot check accepts.
PROVIDER_OF = {"claude": "claude", "anthropic": "claude", "codex": "codex", "openai": "codex", "kimi": "kimi", "moonshot": "kimi"}

CONFIG_MAX_BYTES = 1_000_000
_DIR = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


def _locate(home: str, relative: str) -> tuple[str, int, str]:
    """('absent'|'unsafe'|'file', fd of the last folder or -1, name of the file). The caller closes the fd."""
    parts = relative.split("/")
    try:
        fd = os.open(home, os.O_RDONLY | os.O_DIRECTORY)
    except OSError:
        return "unsafe", -1, ""
    try:
        for name in parts[:-1]:
            try:
                info = os.stat(name, dir_fd=fd, follow_symlinks=False)
            except FileNotFoundError:
                return "absent", -1, ""
            except OSError:
                return "unsafe", -1, ""
            if not stat.S_ISDIR(info.st_mode):
                return "unsafe", -1, ""
            try:
                nxt = os.open(name, _DIR, dir_fd=fd)
            except FileNotFoundError:
                return "absent", -1, ""
            except OSError:
                # swapped for a link (or anything else) between the look and the open: not followed
                return "unsafe", -1, ""
            os.close(fd)
            fd = nxt
        try:
            info = os.stat(parts[-1], dir_fd=fd, follow_symlinks=False)
        except FileNotFoundError:
            return "absent", -1, ""
        except OSError:
            return "unsafe", -1, ""
        if not stat.S_ISREG(info.st_mode):
            return "unsafe", -1, ""
        kept, fd = fd, -1
        return "file", kept, parts[-1]
    finally:
        if fd >= 0:
            os.close(fd)


def classify(home: str, relative: str) -> str:
    """'absent' (not there), 'file' (a regular file, every folder on the way a plain one), or 'unsafe' (anything else)."""
    state, fd, _ = _locate(home, relative)
    if fd >= 0:
        os.close(fd)
    return state


def _fail(code: str) -> dict:
    return {"ok": False, "error": code}


def _active_provider(home: str) -> tuple[str | None, str]:
    """(provider, '') or (None, error code): the team's active provider among the closed lists."""
    try:
        with open(os.path.join(home, "jht.config.json"), encoding="utf-8") as handle:
            config = json.loads(handle.read(CONFIG_MAX_BYTES))
    except (OSError, ValueError):
        return None, "provider_unknown"
    name = config.get("active_provider") if isinstance(config, dict) else None
    provider = PROVIDER_OF.get(name.lower()) if isinstance(name, str) else None
    if provider is None:
        return None, "provider_unknown"
    providers = config.get("providers")
    entry = providers.get(name.lower()) if isinstance(providers, dict) else None
    method = entry.get("auth_method") if isinstance(entry, dict) else None
    if (method if method is not None else "subscription") != "subscription":
        return None, "provider_not_subscription"
    return provider, ""


def status(home: str = HOME) -> dict:
    """Signed in = the marker of the active provider is there, in any form."""
    provider, error = _active_provider(home)
    if provider is None:
        return _fail(error)
    return {"ok": True, "provider": provider, "authenticated": classify(home, CREDENTIAL_FILES[provider][0]) != "absent"}


def logout(home: str = HOME, unlink=os.unlink) -> dict:
    """Removes the provider's files and answers the truth: `authenticated:false` only if none of them is left.
    `unlink` is for the tests (an agent writing its file back the moment it is gone)."""
    provider, error = _active_provider(home)
    if provider is None:
        return _fail(error)
    removed = 0
    for relative in CREDENTIAL_FILES[provider]:
        state, fd, name = _locate(home, relative)
        if state != "file":
            continue
        try:
            try:
                unlink(name, dir_fd=fd)
                removed += 1
            except FileNotFoundError:
                pass
            except OSError:
                return _fail("provider_logout_failed")
        finally:
            os.close(fd)
    # After, not before: a running agent may have written its file back.
    if any(classify(home, relative) != "absent" for relative in CREDENTIAL_FILES[provider]):
        return _fail("provider_logout_incomplete")
    return {"ok": True, "provider": provider, "authenticated": False, "removed": removed}


def main(argv: list[str], home: str = HOME) -> int:
    if argv not in (["status"], ["logout"]):
        print(json.dumps(_fail("agent_control_invalid"), separators=(",", ":")))
        return 100
    out = status(home) if argv == ["status"] else logout(home)
    print(json.dumps(out, separators=(",", ":")))
    return 0 if out["ok"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
