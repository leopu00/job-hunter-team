# 0006 — User chooses the container runtime on macOS (Colima or Docker Desktop)

**Status:** Accepted
**Date:** 2026-06-20
**Supersedes:** [0001](./0001-colima-not-docker-desktop.md)

> **Preparation update — 2026-08-20.** `--runtime=podman` is now an explicit
> macOS preview path. It does not change this ADR's default: Colima remains the
> automatic choice, is never stopped or removed by the Podman path, and remains
> available as rollback until the macOS lifecycle probe is complete. Returning
> to the default publishes an attested `docker` selection fail-closed. The
> private JHT adapter remains inert and no `docker` executable is removed.

## Context

ADR-0001 mandated **Colima** as the only container runtime on macOS, because
it is FOSS, headless, and 100% scriptable — ideal for the "Install everything"
button in the DMG. Windows uses Docker Desktop, Linux uses the native Engine.

Two things changed in practice:

1. **Docker Desktop and Colima are distinct apps with their own Linux VM.**
   `docker` (the CLI) is the same binary in both — it just talks to a different
   daemon socket (`docker context`). Running both at once means **two VMs, double
   RAM, and confusion over which context is active**. A user who already has
   Docker Desktop for other work and gets Colima force-installed on top hits
   exactly this mess.

2. **Windows is the primary target**, and it already uses Docker Desktop.
   Forcing a *different* runtime on macOS creates a discrepancy (two mental
   models, two support paths) for no benefit when the user already has Docker.

The decision surface is **macOS-only**: Windows has no Colima (Lima/Colima run
on macOS and Linux, not Windows), and on Linux the Engine is native in the
background — neither needs a choice.

## Decision

On **macOS**, let the **user choose** the runtime, with a smart default:

- **Detect-first.** If any working Docker daemon already responds
  (`docker info` ok — Docker Desktop, an existing Colima, OrbStack, …), **use
  it**. Never install a second runtime on top.
- **If nothing is present**, offer two options in the desktop wizard:
  - 🟢 **Colima** *(recommended / default)* — we install and start it; headless,
    lightweight, zero management for the user.
  - 🟣 **Podman** *(preview / explicit flag only)* — a dedicated JHT machine and
    attested compatibility shim are prepared without changing or deleting
    Colima. It is not the automatic default before macOS E2E.
  - 🔵 **Docker Desktop** — the user installs and starts it; we never manage it,
    it must be running when the team runs.
- The choice is **persisted** (desktop preference plus the protected host-runtime
  selection; CLI: `--runtime` flag). Colima ↔ Docker Desktop remains a desktop
  preference; crossing the Podman/Docker boundary is installer-only because the
  desktop is read-only over the protected host runtime. Switching is safe for
  data: the DB/config/CVs live in host
  bind-mounts (`~/.jht`, `~/Documents/Job Hunter Team`) and survive a runtime
  change. Podman is shown only when the installer-created adapter, machine
  marker and integrity hashes are valid. The installer verifies the destination
  runtime before switching away and leaves that private adapter inert;
  opting into Podman again requires rerunning `--runtime=podman`.

CLI install (`curl | bash`) is non-interactive, so there the "question" is
**detect-first + `--runtime` flag** (default `colima`); the interactive choice
lives in the **desktop wizard**, which is the non-technical path it is meant for.

Windows (Docker Desktop) and Linux (native Engine) are unchanged.

## Consequences

- ✅ No more double-VM clash for users who already run Docker Desktop on macOS
- ✅ One mental model available across Mac + Windows for users who want it
- ✅ Colima default preserves the silent "install everything" flow for newcomers
- ✅ Data survives a runtime switch (host bind-mounts), at the cost of one re-pull
- ⚠️ More branches to maintain on macOS (two runtimes instead of one)
- ⚠️ The Docker Desktop path is **not** silently installable (EULA + admin +
  open the GUI once) — same friction we already accept on Windows. Mitigated by
  detect-first (we only install when nothing exists) and by keeping Colima as
  the recommended default.

## Alternatives considered

- **Keep Colima-only (ADR-0001)** — rejected. Causes the double-VM clash for the
  growing set of macOS users who already have Docker Desktop.
- **Switch macOS to Docker Desktop-only (mirror Windows)** — rejected. Loses the
  silent install for non-technical newcomers; forces a ~2.5 GB GUI runtime on
  users who would be fine with headless Colima.
- **OrbStack as the macOS default** — noted but rejected as default. Lighter and
  faster than Docker Desktop and silent-installable, but not FOSS (free only for
  personal use) — unfit as a forced default. Left as a future option if we ever
  want silent install + Docker-Desktop-class UX.
