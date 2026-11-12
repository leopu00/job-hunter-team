# 📦 CLI install — `jobhunterteam.ai/install.sh`

This document describes the current CLI installer. It is the reference for
**Path 2 (CLI installer)** in the [Quickstart](QUICKSTART.md):

```bash
curl -fsSL https://jobhunterteam.ai/install.sh | bash -s -- --runtime podman
```

The visual path is the Mac desktop app in [`desktop/`](../../desktop/). This document remains the reference for CLI installation and recovery.
For onboarding inside an already-cloned repo, see [legacy `setup.sh` / `setup.ps1`](#-legacy-onboarding-setupsh--setupps1).

---

## 📋 TL;DR

| Item | Value |
|------|-------|
| Source of truth | [`scripts/install.sh`](../../scripts/install.sh) |
| Served by | Vercel (Next.js project in `web/`) |
| URL | `https://jobhunterteam.ai/install.sh` |
| HTTP cache | `public, max-age=300, s-maxage=3600, stale-while-revalidate=86400` |
| Container runtime | Podman, the only one since 0.4, on macOS and on Linux (the path of the app). Colima, Docker Desktop and Docker Engine are no longer installed nor accepted |
| Expert mode | `--no-docker` (clone + build from source) |
| OS support | macOS (Apple silicon in the 0.4 app) · Linux (apt/dnf/pacman), experimental. On Linux this script is the way in: there is no desktop app for Linux in this version |
| Windows | Windows is not in this version |

---

## 🔌 How the endpoint is wired

There is **no Next.js API route** behind `/install.sh`. The file is shipped
as a static asset:

1. The repo-root [`vercel.json`](../../vercel.json) declares a Next.js build
   for the `web/` workspace.
2. Its `buildCommand` runs `cp scripts/install.sh web/public/install.sh`
   **before** `next build`. This guarantees the deployed copy is always
   the one in the repo at the deploy commit.
3. The same `vercel.json` adds explicit headers for `/install.sh`:
   - `content-type: application/x-sh; charset=utf-8`
   - `cache-control: public, max-age=300, s-maxage=3600, stale-while-revalidate=86400`

So `https://jobhunterteam.ai/install.sh` is served straight from
`web/public/install.sh`, which is overwritten at build time.

**Implication** — the endpoint reflects the commit deployed by Vercel, while
the installer's default source branch for downloaded runtime files is
`master`. Tagging a release does not change what curl returns; deploying
does. If we ever want curl to pin to
the latest tagged release, this is where we'd change strategy (rewrite
to `raw.githubusercontent.com/leopu00/job-hunter-team/<tag>/scripts/install.sh`,
or generate `web/public/install.sh` from the latest GH release tag at
build time).

### ✅ Verifying the endpoint

```bash
curl -sI https://jobhunterteam.ai/install.sh
# expect: HTTP/2 200, content-type: application/x-sh; charset=utf-8

curl -fsSL https://jobhunterteam.ai/install.sh | head -5
# expect: shebang + the JHT banner comment block
```

---

## 🛠️ What `scripts/install.sh` does

The script is `set -euo pipefail`, idempotent, and prints a step counter
(`[N/TOTAL]`). It branches into two paths depending on `--no-docker`: the container path (the default) and the expert native path.

### 🚩 Common arguments / env vars

| Flag / env | Default | Purpose |
|------------|---------|---------|
| `--no-docker` | off | Skip the container, install natively (expert mode) |
| `--with-docker` | on | Alias kept for retro-compat (the container path is already the default) |
| `--dry-run` | off | Print every install/download/mutating action without executing any of them |
| `--runtime <id>` | `podman` | `podman` (or `auto`), the only engine: `colima`, `docker`, `docker-desktop` and `orbstack` are refused with `runtime_not_supported` |
| `--branch <name>` | `master` | Source branch for wrapper and Compose downloads |
| `-h`, `--help` | — | Print the header banner and exit |
| `JHT_REPO_URL` | `https://github.com/leopu00/job-hunter-team.git` | Repo cloned in native mode |
| `JHT_BRANCH` | `production` | Stable release branch checked out in native mode + raw download base in container mode |
| `JHT_INSTALL_DIR` | `$HOME/.jht/src` | Where the repo lands in native mode |
| `JHT_RUNTIME_DIR` | `$HOME/.jht/runtime` | Where `docker-compose.yml` lands in container mode |
| `JHT_BIN_DIR` | `$HOME/.local/bin` | Where the `jht` wrapper / symlink lands |
| `JHT_IMAGE` | `ghcr.io/leopu00/jht@sha256:fa78c975c04dd5f95d6225a35c8c3bb9646f8ef14b32c8ca558d5332de0cce00` | Content-addressed container image referenced by the compose |
| `JHT_RAW_BASE` | `https://raw.githubusercontent.com/leopu00/job-hunter-team/$JHT_BRANCH` | Base URL for the runtime file downloads |
| `JHT_SKIP_ONBOARD` | `0` | Skip the post-install `jht setup` wizard |

### 🐳 Container path (4 steps)

> Since 2026-05-06 the container path follows the **host/container split**
> design — see [`docs/internal/ops/vps.md`](../internal/ops/vps.md).
> The wrapper does not run an ephemeral `docker run --rm` per command:
> it dispatches to `docker compose` (lifecycle) or `docker exec` (operativity)
> against a long-running `jht` container.

1. **Detect system** — `uname -s` → macOS / Linux (a WSL environment is
   recognized with `grep microsoft /proc/version`, but Windows is not in this
   version); on Linux also picks `apt` / `dnf` / `pacman`.
2. **Install container runtime** — Podman, the only engine since 0.4 (the
   path of the app):
   - macOS: **Homebrew must already be installed** (it needs macOS 15 or
     later); without it the installer stops with `homebrew_missing` before
     installing anything. It then installs the Podman CLI and the Compose
     provider with Homebrew, creates/starts the dedicated rootless
     `jht-podman` machine (2 CPUs, 4 GiB of memory, a disk of up to 30 GiB; a
     Mac with at least 16 GB of RAM is recommended) and publishes an attested JHT-only `docker` shim in
     `$JHT_RUNTIME_DIR/bin` rather than the user's global `PATH`. It never
     stops, deletes, or uninstalls Colima.
   - Linux: rootless Podman 5.0 or later and podman-compose 1.1 or later, for
     your user (not root). What is missing (`podman`, `podman-compose`,
     `uidmap` or its equivalent, the subuid/subgid range and linger) is set up
     with `sudo -n`: sudo must work without asking for a password, or the
     installer stops with `podman_sudo_required` and says what an administrator
     has to do. It never installs Docker.

   A computer that already runs the team on Docker (an install of 0.3.x on
   Colima, Docker Desktop or Docker Engine) is refused with
   `runtime_change_requires_migration` (exit 85) before anything changes.
   What stays: `~/.jht` (configuration, database, profile) and
   `~/Documents/Job Hunter Team` (CVs, outputs), folders of the computer. What
   stays behind in Docker's volumes and has to be given again: the API key, the
   mail password, the Telegram tokens. The way: `jht uninstall --confirm` (it
   keeps the two folders), the installer again, then `jht setup` with the key.
   Until then the team keeps running on Docker while its engine is on; `jht up`
   no longer starts Colima or Docker Desktop.
   On Windows the installer creates the dedicated `jht-podman` machine with a
   disk limit of 30 GiB; it does not compact its VHDX automatically. See
   [Windows Podman disk space](WINDOWS-PODMAN-DISK.md) for the limits and the
   conditions required before any future compaction feature.
3. **Verify the runtime** — with Podman, `podman info` on the dedicated
   connection (the `jht-podman` machine on macOS, the rootless service on
   Linux) plus its Compose provider.
4. **Download runtime files and run host preflight** — `curl -fsSL` of:
   - `$JHT_RAW_BASE/docker-compose.yml` → `$JHT_RUNTIME_DIR/docker-compose.yml`
   - `$JHT_RAW_BASE/scripts/jht-wrapper.sh` → `$JHT_BIN_DIR/jht` (chmod +x)
   - `$JHT_RAW_BASE/scripts/host-setup.sh` → `$JHT_RUNTIME_DIR/host-setup.sh`

   The preflight records host type, language and timezone in
   `~/.jht/host.env`; on a low-memory Linux VPS it can also configure the
   documented swap prerequisite. The installer registers `$JHT_BIN_DIR` on
   the persistent shell `PATH` when needed.

   The wrapper is a host-side dispatcher: lifecycle
   commands (`up`/`down`/`restart`/`recreate`/`upgrade`/`logs`/`status`/`shell`)
   call `docker compose` / `docker logs` / `docker inspect` through the
   JHT-only `docker` shim that runs Podman; everything else is forwarded as
   `docker exec -it jht node /app/cli/bin/jht.js <args>`. Auto-up: lifecycle of the container is transparent on
   first run.

### 🛠️ Expert path — native (`--no-docker`, 6 steps)

1. **Detect system** (same as Docker path).
2. **System deps** — `git`, `tmux`, `curl` via the detected package
   manager; `brew` on macOS.
3. **Node.js ≥ 22** — NodeSource repo on apt/dnf, `brew install
   node@22` on macOS, `pacman -S nodejs npm` on Arch.
4. **Clone** — `git clone --depth 1 --branch $JHT_BRANCH $JHT_REPO_URL
   $JHT_INSTALL_DIR`. If already present, fetches and `git reset --hard
   origin/$JHT_BRANCH`.
5. **Build** — `npm install` for `cli/`, then `npm install` for every
   `shared/*/` workspace that declares dependencies.
6. **Symlink `jht`** — `$JHT_BIN_DIR/jht` → `$JHT_INSTALL_DIR/cli/bin/jht.js`.

### 🚀 After both paths

- Prints final banner with what was installed, the file layout, and
  uninstall instructions.
- If an interactive terminal is available and `JHT_SKIP_ONBOARD=0`, launches
  `jht setup` immediately. The wizard starts the container, installs the
  selected provider CLI, waits for subscription login and starts the team.

### 📁 Where things land

| Path | Purpose |
|------|---------|
| `~/.jht/` (host) → `/jht_home` (container) | Config, `jobs.db`, agents, credentials |
| `~/Documents/Job Hunter Team/` (host) → `/jht_user` (container) | CVs, generated outputs |
| `$JHT_BIN_DIR/jht` (default `~/.local/bin/jht`) | The wrapper (Docker) or symlink (native) |
| `$JHT_RUNTIME_DIR/docker-compose.yml` (default `~/.jht/runtime/`, Docker only) | The compose file the wrapper drives |
| `$JHT_RUNTIME_DIR/host-setup.sh` (container path, macOS and Linux) | Host-type, locale, timezone and VPS preflight helper |
| `~/.jht/host.env` | Values read by the wrapper and passed into the container |
| `$JHT_INSTALL_DIR` (default `~/.jht/src`, native only) | The cloned repo |

If `$JHT_BIN_DIR` is not on `$PATH`, the script updates a suitable persistent
shell profile when it can and prints a manual `export PATH=...` fallback when
it cannot.

---

## 📜 Legacy onboarding: `setup.sh` / `setup.ps1`

The repo also ships `scripts/setup.sh` (bash) and `scripts/setup.ps1`
(PowerShell). **These are not the one-liner installer.** They both print a
deprecation banner pointing at `https://jobhunterteam.ai/install.sh`.

They exist for the case "I already cloned the repo and want a
deterministic Python/Node onboarding from source": they create
`.venv/`, install `requirements.txt`, copy `.env.example` →`.env`,
copy `docs/examples/candidate_profile.yml.example` → `candidate_profile.yml`, run
`npm install` in `web/`, install the git pre-commit hook, init the
SQLite DB, and print next steps.

They do **not** install a container runtime, Node, or any system dependency — they
assume the developer already has Python ≥ 3.10, tmux, Node and npm.

If you find yourself reaching for these, you probably want the one-liner
or `docs/guides/QUICKSTART.md` instead.

---

## 🧪 Dry-run

`--dry-run` walks every step of the installer and prints the actions
that *would* be executed, without touching the system. Nothing is
downloaded, no package is installed, no file is written. Use it to
preview what the installer will do on a new machine, or to sanity-check
a change to `install.sh` before running it for real.

```bash
bash scripts/install.sh --runtime podman --dry-run   # container path, Podman
bash scripts/install.sh --no-docker --dry-run        # native path
```

Example output on macOS with Podman and its Compose provider already installed (abridged; exact actions depend on the host):

```text
╔══════════════════════════════════════════╗
║     Job Hunter Team — Installer          ║
╚══════════════════════════════════════════╝

  mode:    Container (Podman)
  image:   ghcr.io/leopu00/jht@sha256:fa78c975c04dd5f95d6225a35c8c3bb9646f8ef14b32c8ca558d5332de0cce00
  branch:  production
  runtime: $HOME/Library/Application Support/Job Hunter Team/host-runtime
  dry-run: ON (no changes to the system)

[1/4] System detection
  ✓ macOS

[2/4] Container runtime
  ✓ podman already installed
  ✓ podman-compose already installed
  [dry-run] would initialize/start Podman machine: jht-podman (2 CPU, 4096 MiB RAM, 30 GiB disk)
  [dry-run] would pull image: ghcr.io/leopu00/jht@sha256:…

[3/4] Container runtime check
  [dry-run] would execute: podman --connection jht-podman info
  [dry-run] would verify: Podman 6.1.3 + podman-compose 1.6.0

[4/4] Download wrapper + docker-compose.yml
  [dry-run] would download: …/production/docker-compose.yml -> …/host-runtime/docker-compose.yml
  [dry-run] would download: …/production/scripts/jht-wrapper.sh -> $HOME/.local/bin/jht
  [dry-run] would download: …/production/scripts/host-setup.sh -> …/host-runtime/host-setup.sh
  [dry-run] would publish an attested JHT-only docker→podman shim
```

What `--dry-run` covers:

- `brew install`, `apt-get install`, `dnf install`, `pacman -S`
- `curl ... | bash` style one-liners (Homebrew, NodeSource)
- `podman machine init` / `start` and `podman info` (dry-run does not contact
  the registry either)
- `git clone`, `git fetch`, `git reset` (--no-docker path only)
- `mkdir -p` on persistent paths, `chmod +x`, and all three runtime downloads
- the final `jht setup` wizard (skipped in dry-run)

What `--dry-run` intentionally does **not** do:

- It still runs read-only probes: `uname -s`, `command -v`, reading
  `/etc/os-release`, etc. Those have no side effect.
- It does **not** verify that `apt-get`, `brew`, or `podman` would
  succeed; it only prints the intent. Use `--dry-run` as a preview,
  not a test.

---

## ⚠️ Current limitations

- 📌 **Endpoint pins `master`, not a release tag** — a stable curl
  install would benefit from pinning to the latest GitHub release tag
  (rewrite to `raw.githubusercontent.com/.../<tag>/scripts/install.sh`,
  or generate `web/public/install.sh` from the latest release at build
  time).
- **Windows is not in this version** — there is no Windows installer in this release.

---

## 📚 Related

- 🚀 [`docs/guides/QUICKSTART.md`](QUICKSTART.md) — the human-friendly install guide (4 paths)
- 💳 [`docs/about/PROVIDERS.md`](../about/PROVIDERS.md) — Codex subscription or GLM/Kimi API key
- 🦞 [`docs/guides/AI-AGENT-INTEGRATION.md`](AI-AGENT-INTEGRATION.md) — let your AI assistant drive `jht`
- 📐 [`docs/internal/ops/INFRA.md`](../internal/ops/INFRA.md) — infrastructure diagram and deployment modes
- 🧪 [`docs/guides/BETA.md`](BETA.md) — testing and feedback channels
- 🔒 [`docs/internal/ops/MAINTAINERS.md`](../internal/ops/MAINTAINERS.md) — internal operations reference
- 📐 [ADR-0012](../adr/0012-desktop-setup-matrix.md) — the setup matrix (supersedes ADR-0004, subscription only)
