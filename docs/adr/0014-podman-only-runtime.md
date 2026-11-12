# 0014 — Podman is the only container engine of the CLI on macOS and Linux

**Status:** Accepted
**Date:** 2026-11-12
**Supersedes:** [0006](./0006-user-choice-container-runtime-macos.md)

## Context

0.4 ships one path: the desktop app on a Mac runs the team in a dedicated
rootless Podman machine, a VPS on rootless Podman. The CLI installer still
defaulted to Colima on a Mac and to Docker Engine on Linux, and accepted Docker
Desktop: three more engines to install, start after a reboot, test and explain,
and a CLI install that the app had to adopt instead of sharing its path.

## Decision

`install.sh` installs and accepts only Podman (a machine on macOS, rootless on
Linux), with or without `--runtime podman`. `--runtime colima`, `docker`,
`docker-desktop` and `orbstack` are refused (`runtime_not_supported`, exit 2).
The wrapper no longer starts Colima or Docker Desktop.

A computer that already runs the team on Docker (container-runtime marker
`docker`, or a completed install without the marker) is refused before anything
changes (`runtime_change_requires_migration`, exit 85). Volumes are not moved
between engines: the message says what stays (`~/.jht`, `~/Documents/Job Hunter
Team`), what has to be given again (the API key, the mail password, the Telegram
tokens kept in Docker's volumes) and the way: `jht uninstall --confirm`, the
installer again, `jht setup`.

## Consequences

- One engine to test and document; the app and the CLI share the same install.
- A 0.3.x user on Docker keeps their data but types the API key and the other
  secrets again after moving. `jht uninstall` still cleans a Docker install
  (containers, volumes, the Colima the installer had started).
- Homebrew remains required on a Mac: the official Podman package has no
  podman-compose.

## Alternatives considered

- **Keep Colima as the CLI default.** Rejected: a second engine for the same
  product, and a team the app cannot share without adoption.
- **Move the Docker volumes to Podman automatically.** Rejected for 0.4: the
  secrets volumes would have to be read out of one engine and written into
  another; a manual re-entry of three secrets is safer than a half-done copy.
