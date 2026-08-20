# 0008 — Evaluate Podman behind a `docker` shim, not by rewriting call sites

**Status:** Proposed — implementation proven on an existing Windows host; clean-machine publication gate open
**Date:** 2026-08-17
**Extends:** [0006](./0006-user-choice-container-runtime-macos.md)
**Revisits:** [0001](./0001-colima-not-docker-desktop.md) § Alternatives considered

## Context

The container runtime is a technical dependency the installer imposes on
non-technical users, and on Windows it contains **one step we cannot take for
them**. ADR-0006 states this among its accepted consequences: the Docker Desktop
path *"is **not** silently installable (EULA + admin + open the GUI once)"*, and
`docs/guides/QUICKSTART.md` describes what we do instead — we *verify* Docker
Desktop is running. That step sits at the top of the install funnel, which is
where users are lost.

Podman was already rejected once, in ADR-0001 (2026-04-16), on macOS grounds: a
more fragmented ecosystem and a `docker`-CLI compatibility layer judged not mature
enough. **That verdict is orphaned.** ADR-0001 is superseded by ADR-0006, and
ADR-0006 does not revisit Podman — so the rejection was neither confirmed nor
re-argued, it simply stayed inside the document that was superseded. There is no
rejection in force to respect: there is an expired judgement about a four-month-old
version, which must be re-measured rather than inherited or dismissed.

The measurement that constrains the shape of any answer: **348 literal
`docker <verb>` call sites** in code, and **zero indirection** — no `DOCKER_BIN`,
no `CONTAINER_RUNTIME`, and the only runtime switch (`--runtime` in
`install.sh`) accepts `colima|docker-desktop` and is macOS-only. Crucially, none
of those call sites links a library: they invoke a binary **by name**, resolved
through `PATH` — including the Godot app, which drives the container with
`OS.execute("docker", …)`. Full analysis and the per-area breakdown:
[`2026-08-17-ticket-container-runtime-podman.md`](../internal/roadmap/2026-08-17-ticket-container-runtime-podman.md).

## Decision

*Proposed — not in force until the direttore accepts it.*

1. **Podman is evaluated behind a `docker` shim first** (`podman-docker` +
   socket), with **zero modifications to the 348 call sites**. Because every call
   site resolves a binary name through `PATH`, the shim is the cheapest possible
   probe of the exact property ADR-0001 doubted — the maturity of the
   compatibility layer. Evaluating it by writing an abstraction first would spend
   the expensive work before knowing whether the cheap path holds.
2. **The ADR-0001 rejection is declared expired, not overturned.** Podman is not
   adopted here and not re-rejected here; what is decided is that its status is
   *unmeasured*, and that the measurement is the next step.
3. **Adoption requires one specific proof:** a clean Windows machine, the complete
   install chain with **no interactive step** through to `jht team start`, on the
   shim alone. Windows is where the entire gain lives; a result from macOS or Linux
   does not stand in for it.
4. **A runtime abstraction (`DOCKER_BIN` / `CONTAINER_RUNTIME`) is deferred** and
   is not a prerequisite. It becomes the right work only if the answer to «replace
   Docker, or also support Podman?» is *also support* — that question is open and
   belongs to the direttore.
5. **What Podman does not solve is recorded here, so it is not rediscovered as a
   disappointment:** WSL2 remains on Windows (`podman machine` *is* a WSL2
   distribution), so the UAC-plus-reboot step does not disappear; on macOS the gain
   is near-zero because Colima already installs silently; and
   `restart: unless-stopped` becomes our own systemd work, because Podman has no
   daemon to restart containers — on a VPS that works overnight, that line is the
   difference between a team that comes back and one that does not.

## Consequences

- ✅ The cheap experiment runs before the expensive refactor, and it tests the one
  property that would invalidate the refactor anyway.
- ✅ Windows install becomes fully scriptable **if** the shim holds: silent client
  install plus `podman machine init --now`, with no licence to accept and no GUI to
  open once.
- ✅ Docker Desktop's paid-subscription threshold stops being a term our users
  inherit from us; Podman is Apache 2.0. This is consistent with using code
  transparency as the trust signal instead of code signing.
- ✅ Rootless by default removes `usermod -aG docker` on Linux — worth stating in
  the FAQ, on a product whose agents run with `--dangerously-skip-permissions`
  inside the container.
- ⚠️ A shim moves failure from build time to **runtime, inside the product**. The
  surface to exercise is the whole lifecycle, not a file, and `docker compose` (88
  call sites) is a different implementation under Podman.
- ✅ The runtime proof was executed on 2026-08-20 on Windows with Podman 6.0.2
  rootless (WSL provider) and Docker Compose 5.1.2. The remaining publication
  gate is repetition from a clean Windows account/machine, not runtime discovery.

### Evaluation update — 2026-08-20

The Windows harness now exists at
[`scripts/podman-windows-probe.ps1`](../../scripts/podman-windows-probe.ps1).
It creates a temporary native `docker.exe` shim, because a shell alias would not
exercise Godot's `OS.execute("docker", …)` path. Installation of the user-scope
Podman CLI and Compose provider, and creation of the rootless WSL machine, remain
explicit opt-ins. The harness exercises the production Compose workload, bind
mounts, named volumes, host-name resolution and restart, with isolated data and
scoped cleanup.

The shim itself is compiled and executed by automated tests on Windows PowerShell
5.1 and PowerShell 7. The running lifecycle now passes as well: Compose config,
create, bind writes in both directions, named volumes, HTTPS egress, restart and
cleanup. A branch image then started the standard JHT core with Codex 0.147.0.
Observed process arguments and TUI banners proved both role aliases:
`gpt-5.6-terra` and `gpt-5.6-sol`, with the configured effort retained. The
Assistente and Capitano returned the requested probes `PODMAN-TERRA-OK` and
`PODMAN-SOL-OK`; `jht team status` reported Assistente, Capitano, Mentor and
Sentinella active. The final reboot proof repeated this on the installed runtime:
the watchdog restored all four roles and the two agents returned
`PODMAN-TERRA-FINAL-OK` and `PODMAN-SOL-FINAL-OK`.

Two Windows-specific adaptations were required and are now part of the path:

1. Compose uses host networking because Netavark 2.0.0 failed to create a custom
   nftables bridge in this rootless WSL machine. JHT publishes no ports, so this
   does not widen an exposed service surface.
2. Compose uses `keep-id:uid=1001,gid=1001`. The migration helper also round-trips
   legacy Docker-created DrvFS nodes whose Linux UID is unmapped, retaining a
   recoverable backup. The atomic private-config writer treats `chmod` as
   best-effort on v9fs/DrvFS while the Windows owner-only ACL remains authoritative.

On the managed test network, WSL TCP egress was blocked by Forcepoint. An
installed system-level service therefore exposes a localhost-only HTTP/CONNECT
proxy inside the Podman machine and opens the outbound socket through a native
Windows interop connector. System-level services also run the rootless Podman API
as `user` with `cgroupfs` and start/stop the JHT container. This deliberately
avoids the WSL cross-distribution `user@1000.service` cgroup collision observed
during reboot testing. A named-machine stop/start completed with PID1's clean
`shutdown complete`, restored API/proxy/container, and left the container at
exit 0. Both image pull and `podman build --network host` passed through the
proxy.

The durable migration entry point is
[`scripts/enable-podman-windows-runtime.ps1`](../../scripts/enable-podman-windows-runtime.ps1).
It publishes an attested native `docker.exe`, the Compose override, runtime and
machine markers, persistent network/API/container services, and keeps all
existing product call sites unchanged. This is adoption evidence for the measured
host, but the ADR remains **Proposed** until the same chain is repeated from a
clean Windows machine.

### macOS preparation — 2026-08-20

The canonical installer now accepts explicit `--runtime=podman` on macOS while
keeping Colima as its unchanged default. The preparation path creates a named
rootless `jht-podman` machine and an attested JHT-scoped `docker` shim; it does
not stop, delete or uninstall Colima, nor change another Podman connection's
default. The desktop exposes Podman only when that JHT adapter, its machine
marker and their manifest hashes validate. A normal/Colima/Docker Desktop
install publishes the protected `docker` selection fail-closed and leaves the
private JHT shim inert; re-entering the preview requires another explicit
Podman install.
This is scaffolding, not adoption evidence: Compose, bind mounts, restart
behavior and clean-machine installation still require macOS E2E on both Apple
Silicon and Intel before this ADR can promote Podman there.

## Alternatives considered

- **Adopt Podman by introducing the abstraction first (`DOCKER_BIN` everywhere)** —
  rejected as the opening move. It spends work on 348 call sites, of which 157 are
  in `scripts/` and 102 in GDScript — both outside the perimeter our tests cover —
  before knowing whether the compatibility layer holds at all. Correct work *if*
  the goal turns out to be supporting several runtimes.
- **Inherit the ADR-0001 rejection and close the question** — rejected. The
  judgement is four months old, was made on macOS grounds, and lives in a
  superseded document; and macOS is precisely the platform where Podman would gain
  us the least. Reusing that verdict would answer a Windows question with a macOS
  measurement.
- **Keep Docker and attack the friction elsewhere (bundle a runtime, push users to
  the VPS path)** — not rejected, and deliberately out of scope here. The VPS
  execution mode already removes the local dependency entirely, and it remains the
  recommended path; this ADR is about the Local-PC path, which is the one where the
  runtime is the user's problem.
- **OrbStack** — already noted and rejected as a default in ADR-0006: not FOSS
  (free for personal use only), therefore unfit as a forced default. Unchanged.
