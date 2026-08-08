# Choose where to run Job Hunter Team

Job Hunter Team (JHT) has one containerized team and more than one place to
run it. The desktop application stays on the computer you use; the Docker
container can run on that same computer or on a Linux host reached over SSH.

This guide compares three deployment paths. It does not compare the native
application with the command-line interface (CLI): those are two ways to
control the same team. See the [Quickstart](QUICKSTART.md) after choosing the
host.

## Decision tree

1. **Do you want the shortest path to a first working team?** Run it on your
   **local PC**.
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

If you are unsure, start locally. Moving later is possible, but read
[Moving an existing team](#moving-an-existing-team) before relying on the
automated migration flow.

## At a glance

| | Local PC | Dedicated PC on the LAN | VPS |
|---|---|---|---|
| **Current product path** | Supported local runtime | Existing SSH transport; advanced topology, not separately validated as a guided path | Supported remote runtime |
| **Where the team runs** | Your everyday computer | A Linux computer you own or control | A Linux virtual server from an infrastructure provider |
| **How the desktop reaches it** | Direct `docker` commands | SSH over your network | SSH over the internet |
| **Must your everyday PC stay on?** | Yes | No; only while you use the desktop | No; only while you use the desktop |
| **What must stay available?** | Your PC, Docker and its network connection | Dedicated PC, Docker, power and the LAN | VPS, Docker, provider account and network |
| **Where persistent workspace data lives** | On your PC | On the dedicated PC | On the VPS provider's storage |
| **Extra operating work** | Keep Docker and the PC healthy | Administer Linux, SSH, Docker, power, updates and backups | Administer Linux, SSH, Docker, provider billing, updates and backups |
| **Cost categories** | Existing hardware, power, internet and AI-provider subscription | Hardware, power, internet, maintenance and AI-provider subscription | VPS service, optional provider add-ons and AI-provider subscription |

The project does not sell the server or AI subscription. Prices vary by
provider, region, taxes, billing period and options, so this guide intentionally
does not quote them. Check the current terms and prices of both providers
before committing. The [provider guide](../about/PROVIDERS.md) explains the
supported AI accounts without turning an old price into a deployment promise.

## Requirements shared by all paths

- **Docker is the runtime boundary.** The supported team runs in the JHT
  container. The container publishes no network port; the desktop controls a
  local runtime directly and a remote runtime through SSH.
- **A supported AI-provider subscription is separate.** JHT uses the selected
  provider's official CLI under your account. It does not include or resell
  that subscription.
- **A host choice is not an offline mode.** Agents fetch job information, and
  the selected provider can process prompts, profile or CV context needed for
  the work. Review that provider's current terms and privacy policy.
- **Cloud pairing is optional for the runtime and native setup path.** Without
  it, the team can still run on its host. With it, supported profile, job and
  team records are synchronized to the hosted dashboard. There is one current
  workflow exception: the interactive CLI setup wizard on a host marked as a
  VPS requires `jht cloud login` before it completes. A cloud-free remote
  runtime is implemented, but skipping pairing is not a path offered by that
  wizard today. The dashboard is not a local web server and does not replace
  the SSH connection.
- **Plan for the Docker image and persistent data.** No universal local disk
  minimum has been measured. Leave room for the image, runtime state, uploaded
  documents and generated application files, and monitor growth on every
  host.

The public [threat model](../security/04-threat-model.md) describes the current
desktop, container, SSH and optional-cloud boundaries.

## Path 1 — Local PC

Choose this when you want the least infrastructure and can leave your computer
awake while the agents work.

### What you need

- A supported desktop release: Windows x64, Linux x64, or macOS (Intel 11 or
  newer; Apple silicon 13 or newer).
- Docker installed and running. The native setup guide handles the supported
  runtime choices for each operating system.
- About **8 GB of RAM available before starting the team** for comfortable
  local use. This is a measured recommendation, not a universal minimum: in a
  30-minute Windows run, a 12 GB machine retained more than 4 GB free with the
  team and desktop active, and a 2013 two-core/four-thread CPU did not
  saturate.
- Enough unmeasured disk headroom for the image and your data.

### Availability and operations

The container uses `restart: unless-stopped`, so it can return after a normal
host reboot once Docker is available. It cannot work while the computer is
powered off or asleep, while Docker is stopped, or while its required network
services are unavailable. When agents are active and you close the desktop,
the application asks whether to stop the team or leave it working. Choose the
explicit **QUIT · THE TEAM KEEPS WORKING** path if you want only the window to
close; the stop choices shut down the local team and container. If no agents
are active, closing the native desktop stops the local container without that
choice. By contrast, finishing a CLI command or closing its terminal does not
stop the container; use the documented lifecycle command when you intend to
stop it.

You operate the computer, Docker, updates, disk space and backups. There is no
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

The current desktop does **not** have a dedicated-PC wizard. Its remote backend
accepts a DNS hostname or IPv4 address and uses OpenSSH, so the same controls
labelled **Settings → Connect VPS** can address a reachable Linux machine on a
LAN. This transport is implemented, but this exact topology has not been
separately validated end to end as a guided release path. Treat it as advanced
operation rather than plug-and-play discovery.

### What you need

- A dedicated x64 Linux host reachable from the desktop over a trusted network
  on the standard SSH port **22**. The current native host field does not
  accept a custom port.
- Docker support on that host and enough disk for the image and persistent
  data.
- SSH key authentication and an OpenSSH client on the desktop computer.
- A remote account that is `root`, has passwordless `sudo`, or is already
  allowed to run Docker. The desktop verifies one of those conditions.
- A DNS hostname or IPv4 address. The current input and transfer path do not
  support IPv6 addresses or `host:port` values.
- Capacity comparable to the local recommendation unless you measure your own
  workload. There is no separate dedicated-PC benchmark or universal minimum
  to quote.

### Availability and operations

The dedicated PC, Docker and the LAN must remain available. Your everyday PC
may be off while the container works, but you need it and a working SSH path
to use the native desktop directly. Closing the desktop does not stop the
remote container.

JHT does not currently discover LAN hosts, wake a sleeping machine, configure
a firewall, or create a VPN or tunnel. Do not expose SSH to the public internet
just to imitate a VPS. If you need access away from home or the office, operate
a secure network path yourself or choose a VPS.

You are responsible for the Linux installation, SSH configuration and host-key
verification, Docker, power, updates, backups and disk monitoring. Existing
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
- SSH key authentication from your computer.
- For native desktop control, SSH on the standard port **22**. The current
  native host field does not accept a custom port. A terminal-only operator
  can configure their own SSH client separately, but that does not add custom
  port support to the desktop.
- `root`, passwordless `sudo`, or an account already allowed to run Docker for
  a fresh prepare/connect flow.
- Outbound HTTPS for installation, AI-provider authorization, job sources and
  any optional cloud features.
- A supported AI-provider subscription in addition to the VPS account.

### Availability and operations

The container can continue after the desktop closes and uses
`restart: unless-stopped` after normal host restarts. Availability still
depends on the VPS provider, account and billing state, host health, Docker,
network access and the services the agents call. “VPS” does not mean managed
by the JHT project.

You choose the provider, region and optional backup products, and you operate
access control, operating-system updates, Docker, storage, monitoring,
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

The native desktop includes local-to-remote, remote-to-remote and
remote-to-local migration flows. They stop the source, transfer the persistent
workspace, verify the archive and preserve a destination backup.

There is an important current limit: the automated remote migration scripts
still use root-owned paths such as `/root/.jht`. A fresh remote prepare/connect
can use `root`, passwordless `sudo`, or an account allowed to run Docker, but
**automated migration to or from a non-root remote account is not currently
implemented**. Do not treat a successful SSH verification as proof that this
migration variant is supported. Use a root-based remote destination or perform
a separately reviewed manual migration until that code is changed and tested.

After a successful move, do not run both copies as one team. Confirm the new
host, data and provider login before retiring the old host, and delete old
copies according to the retention rules you chose.

## What is not implemented for you

JHT currently does not:

- choose, purchase, resize, suspend or delete infrastructure;
- discover a dedicated PC on the LAN;
- configure router port forwarding, a VPN, an SSH tunnel or Wake-on-LAN;
- make a remote host reachable through cloud pairing;
- provide a separately validated dedicated-PC setup wizard;
- automate migration to or from a non-root remote account; or
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
