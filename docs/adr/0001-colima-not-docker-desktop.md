# 0001 — Use Colima (not Docker Desktop) for agent isolation on macOS

**Status:** Accepted
**Date:** 2026-04-16

## Context

JHT agents run with elevated filesystem privileges (`--dangerously-skip-permissions`) so that they can read CVs, generate PDFs, and manage local state. For public distribution this is unacceptable as a default — a non-technical user installing a `.dmg` can't evaluate what agents are doing on their machine.

A container is the minimum safety net: bind-mount only `~/.jht` (hidden) and `~/Documents/Job Hunter Team` (visible), hide everything else.

The question is **which container runtime on macOS**.

## Decision

Use **Colima** as the Docker runtime on macOS. Install it via `brew install colima docker` (or a bundled pkg fallback in the DMG).

## Consequences

- ✅ FOSS (Apache 2.0) — no licensing or EULA friction for end users
- ✅ Headless daemon — no GUI to open, no "accept terms" popup
- ✅ 100% scriptable — installs silently from the DMG post-install script
- ✅ Exposes the same `docker` CLI — zero changes to the rest of the runtime code
- ⚠️ One more moving part on macOS only — Linux/Windows use their native docker.io

## Alternatives considered

- **Docker Desktop** — rejected. Requires the user to open the app, accept EULA, grant admin password. Unusable as a default for non-technical users and not fully scriptable.
- **Podman Desktop** — rejected. More fragmented ecosystem on macOS, compatibility layer for `docker` CLI not as mature.
- **Native, no container** — rejected as default. Acceptable as opt-out (`--no-docker`) for expert users or dedicated machines.
