# Choose where to run Job Hunter Team

Job Hunter Team (JHT) has one containerized team and more than one place to
run it. The desktop application stays on the computer you use, and the
container can run on that same computer or on a Linux host reached over SSH.
The desktop app runs the local container in Podman on macOS (installed with
Homebrew) and in Docker on Linux; on Windows 0.4 it runs in Podman inside WSL,
installed by the app.

This guide compares three deployment paths. It does not compare the native
application with the command-line interface (CLI): those are two ways to
control the same team. See the [Quickstart](QUICKSTART.md) after choosing the
host.

## Decision tree

1. **Do you want the shortest path to a first working team?** Run it on your
   **local PC**. On Windows 0.4 the app installs Podman inside WSL for it;
   WSL must already be enabled.
2. **Do you already have a spare computer that can stay on, and will you use
   it mainly from the same trusted local network?** A **dedicated Linux PC on
   the LAN** can work through the existing SSH transport. This is an advanced
   topology, not a separate guided product path.
3. **Do you want the team to keep running without leaving either computer on?**
   Use a **VPS** that you rent and administer.
4. **Do you need direct desktop control while away from the LAN?** JHT does not
   currently provide discovery, Wake-on-LAN, a VPN, or an SSH tunnel for the
   dedicated-PC path. Use a VPS, or operate your own secure network access.
   Optional cloud sync can show supported mirrored data in the browser, but it
   does not make the remote host reachable over SSH.

If you are unsure, start locally. The desktop app does not move a team between
hosts yet: read [Moving an existing team](#moving-an-existing-team) before
choosing.

## At a glance

| | Local PC | Dedicated PC on the LAN | VPS |
|---|---|---|---|
| **Current product path** | Supported on macOS (Podman) and on Windows 0.4 (Podman inside WSL); Linux (Docker) is built but not tested yet | Existing SSH transport; advanced topology, not separately validated as a guided path | Supported remote runtime on every desktop platform |
| **Where the team runs** | Your everyday computer | A Linux computer you own or control | A Linux virtual server from an infrastructure provider |
| **How the desktop reaches it** | The `jht` command of the local runtime | SSH over your network | SSH over the internet |
| **Must your everyday PC stay on?** | Yes | No; only while you use the desktop | No; only while you use the desktop |
| **What must stay available?** | Your PC, its container runtime and network connection | Dedicated PC, Podman, power and the LAN | VPS, Podman, provider account and network |
| **Where persistent workspace data lives** | On your PC | On the dedicated PC | On the VPS provider's storage |
| **Extra operating work** | Keep the container runtime and the PC healthy | Administer Linux, SSH, Podman, power, updates and backups | Administer Linux, SSH, Podman, provider billing, updates and backups |
| **Cost categories** | Existing hardware, power, internet and AI-provider subscription | Hardware, power, internet, maintenance and AI-provider subscription | VPS service, optional provider add-ons and AI-provider subscription |

The project does not sell the server or AI subscription. Prices vary by
provider, region, taxes, billing period and options, so this guide intentionally
does not quote them. Check the current terms and prices of both providers
before committing. The [provider guide](../about/PROVIDERS.md) explains the
supported AI accounts without turning an old price into a deployment promise.

## Requirements shared by all paths

- **The container is the runtime boundary.** The supported team runs in the
  JHT container. The container publishes no network port; the desktop controls a
  local runtime directly and a remote runtime through SSH.
- **A supported AI-provider subscription is separate.** JHT uses the selected
  provider's official CLI under your account. It does not include or resell
  that subscription.
- **A host choice is not an offline mode.** Agents fetch job information, and
  the selected provider can process prompts, profile or CV context needed for
  the work. Review that provider's current terms and privacy policy.
- **Cloud pairing is optional for a local team and for the CLI.** Without
  it, the team can still run on its host. With it, supported profile, job and
  team records are synchronized to the hosted dashboard. On a host marked as
  a VPS, the interactive CLI wizard offers pairing before provider setup, but
  it can be skipped; a failed `jht cloud login` also leaves provider setup free
  to continue. Pairing can be retried later with the same command. The
  desktop app pairs a new team on a VPS with the Google account you signed in
  with. The dashboard is not a local web server and does not replace the SSH
  connection.
- **Plan for the container image and persistent data.** No universal local disk
  minimum has been measured. Leave room for the image, runtime state, uploaded
  documents and generated application files, and monitor growth on every
  host.

The public [threat model](../security/04-threat-model.md) describes the current
desktop, container, SSH and optional-cloud boundaries.

## Path 1 — Local PC

Choose this when you want the least infrastructure and can leave your computer
awake while the agents work. On Windows 0.4 the team runs in Podman inside WSL.

### What you need

- A supported desktop release: Linux x64, macOS on Apple silicon (M1 and later; Intel
  Macs are not supported in 0.4) or Windows x64.
- On macOS, Homebrew: the app installs Podman with it. On Linux, Docker Engine
  and its Compose plugin installed before you start; the Linux release is
  built, but this setup has not been tested yet. On Windows, WSL enabled: the
  app installs Podman and the rest, and Docker Desktop is not needed.
- About **8 GB of RAM available before starting the team** for comfortable
  local use. This is a measured recommendation, not a universal minimum.
- Enough unmeasured disk headroom for the image and your data.

### Availability and operations

The container uses `restart: unless-stopped`, so it can return after a normal
host reboot once its container runtime is running. On Windows a scheduled task
turns the JHT Podman machine back on when you sign in, and a service in that
machine keeps the team running while the app is closed. The team cannot work
while the computer is powered off or asleep, while its runtime is stopped, or
while its required network services are unavailable. Closing the desktop app
or a CLI terminal does not stop the container; use the documented lifecycle
command when you intend to stop it.

You operate the computer, the container runtime, updates, disk space and
backups. There is no
separate hosting invoice from JHT, but the computer still uses power, internet
and the AI subscription you chose.

### Privacy and data boundary

Runtime state and provider CLI credentials persist under `~/.jht/`; uploaded
and generated documents persist under `~/Documents/Job Hunter Team/`. Anyone
with sufficient access to that computer may be able to reach them. Provider
processing and optional cloud synchronization remain external even though the
workspace is local.

Continue with the [Quickstart](QUICKSTART.md).

## Path 2 — Dedicated PC on the LAN via SSH

Choose this when you already control a spare Linux computer, want the team off
your everyday PC, and are comfortable administering the host yourself.

The current desktop does **not** have a dedicated-PC wizard. Its VPS setup
takes a hostname or IP address, an SSH port and an SSH user and uses OpenSSH,
so the same **VPS server** choice can address a reachable Linux machine on a
LAN. This transport is implemented, but this exact topology has not been
separately validated end to end as a guided release path. Treat it as advanced
operation rather than plug-and-play discovery.

### What you need

- A dedicated x64 Linux host reachable from the desktop over SSH on a trusted
  network.
- Rootless Podman support on that host and enough disk for the image and
  persistent data.
- SSH key authentication, an ed25519 host key, and an OpenSSH client on the
  desktop computer.
- A remote account that is not `root`, with passwordless `sudo` or with
  Podman already prepared for it, as described in the
  [native VPS setup guide](VPS-SETUP-WIZARD.md).
- A Google sign-in in the desktop app, which pairs a new remote team with
  your account.
- Capacity comparable to the local recommendation unless you measure your own
  workload. There is no separate dedicated-PC benchmark or universal minimum
  to quote.

### Availability and operations

The dedicated PC, Podman and the LAN must remain available. Your everyday PC
may be off while the container works, but you need it and a working SSH path
to use the native desktop directly. Closing the desktop does not stop the
remote container.

JHT does not currently discover LAN hosts, wake a sleeping machine, configure
a firewall, or create a VPN or tunnel. Do not expose SSH to the public internet
just to imitate a VPS. If you need access away from home or the office, operate
a secure network path yourself or choose a VPS.

You are responsible for the Linux installation, SSH configuration and host-key
verification, Podman, power, updates, backups and disk monitoring. Existing
hardware may avoid a VPS bill, but it does not remove hardware, electricity,
network or maintenance costs.

### Privacy and data boundary

The workspace and provider CLI credentials live on the dedicated PC. The
desktop keeps the selected SSH private key on the desktop computer and pins the
remote host key before subsequent connections. Traffic between the desktop and
team crosses SSH; calls to the AI provider and optional cloud sync still leave
the dedicated host.

For a fresh host, use the remote controls described in the
[native VPS setup guide](VPS-SETUP-WIZARD.md), applying the limitations above.

## Path 3 — VPS

Choose this when you want a remote host that can remain available without
keeping your own hardware powered on, and you accept the provider bill and
system-administration work.

JHT does not create, bill, suspend, back up or delete a VPS. Provision the
machine with an infrastructure provider first, then connect it through the
native desktop or install through the CLI.

### What you need

- The currently validated baseline: **Ubuntu 24.04 x64, 4 GB total RAM,
  2 vCPU, 80 GB SSD and 2 GB preventive swap**. This is a dedicated-server
  baseline, not a claim that every workload or Linux distribution behaves the
  same way.
- SSH key authentication from your computer, and an ed25519 host key on the
  server. The desktop asks for the SSH port.
- For the desktop app, a normal user that is not `root`, with passwordless
  `sudo` or with rootless Podman already prepared, and a Google sign-in in the
  app for a new team. The CLI path in [VPS-SETUP.md](VPS-SETUP.md) has its own
  requirements.
- Outbound HTTPS for installation, AI-provider authorization, job sources and
  any optional cloud features.
- A supported AI-provider subscription in addition to the VPS account.

### Availability and operations

The container can continue after the desktop closes and uses
`restart: unless-stopped` after normal host restarts. Availability still
depends on the VPS provider, account and billing state, host health, the
container runtime, network access and the services the agents call. “VPS” does not mean managed
by the JHT project.

You choose the provider, region and optional backup products, and you operate
access control, operating-system updates, the container runtime, storage,
monitoring,
recovery and eventual deletion. Ask the provider what shutdown, suspension and
server deletion do to billing and retained data. Check current prices directly;
none are stable enough to embed here.

### Privacy and data boundary

The persistent workspace and provider CLI credentials live on storage managed
by the VPS provider. The desktop connects over SSH with a pinned host key. The
AI provider receives the context required by its CLI, and optional cloud sync
copies supported records to the hosted dashboard. Choose the region, access
controls and backup policy with that data in mind.

Use the [native setup guide](VPS-SETUP-WIZARD.md) or the
[manual CLI guide](VPS-SETUP.md).

## Moving an existing team

The desktop app does not move a team from one host to another yet. What it
does:

- it connects to a team already running on a VPS without reinstalling or
  restarting it;
- with a local profile, it imports the confirmed profile from a VPS into a new
  local setup;
- on a VPS where an earlier installation runs the team with Docker, it does not
  switch the team to Podman: nothing is moved or deleted.

Moving the persistent workspace (`~/.jht` and `~/Documents/Job Hunter Team`)
by hand is outside the guided path and needs its own review. After a move, do
not run both copies as one team. Confirm the new host, data and provider login
before retiring the old host, and delete old copies according to the retention
rules you chose.

## What is not implemented for you

JHT currently does not:

- choose, purchase, resize, suspend or delete infrastructure;
- discover a dedicated PC on the LAN;
- configure router port forwarding, a VPN, an SSH tunnel or Wake-on-LAN;
- make a remote host reachable through cloud pairing;
- provide a separately validated dedicated-PC setup wizard;
- move a team between hosts from the desktop app; or
- guarantee uptime, provider capacity, a fixed monthly price or a universal
  resource minimum.

These boundaries are reasons to choose a different path, not hidden setup
steps.

## Next steps

- [Quickstart](QUICKSTART.md) — choose the native application or CLI after
  choosing the host.
- [Native VPS setup](VPS-SETUP-WIZARD.md) — connect and prepare a remote Linux
  host from the desktop.
- [Manual VPS setup](VPS-SETUP.md) — terminal-first installation and recovery.
- [CLI installation](CLI-INSTALL.md) — inspect what the host installer changes.
- [Providers](../about/PROVIDERS.md) — supported AI accounts and current
  evidence.
- [Threat model](../security/04-threat-model.md) — trust boundaries and data
  locations.
