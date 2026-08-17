# 📦 CLI install — `jobhunterteam.ai/install.sh`

This document describes the current CLI installer. It is the reference for
**Path 2 (CLI installer)** in the [Quickstart](QUICKSTART.md):

```bash
curl -fsSL https://jobhunterteam.ai/install.sh | bash
```

The visual path is the native Godot office in [`game/`](../../game/). This document remains the reference for CLI installation and recovery.
For onboarding inside an already-cloned repo, see [legacy `setup.sh` / `setup.ps1`](#-legacy-onboarding-setupsh--setupps1).

---

## 📋 TL;DR

| Item | Value |
|------|-------|
| Source of truth | [`scripts/install.sh`](../../scripts/install.sh) |
| Served by | Vercel (Next.js project in `web/`) |
| URL | `https://jobhunterteam.ai/install.sh` |
| HTTP cache | `public, max-age=300, s-maxage=3600, stale-while-revalidate=86400` |
| Default mode | Docker (macOS: Colima by default or your Docker Desktop via `--runtime`; native Docker on Linux/WSL2) |
| Expert mode | `--no-docker` (clone + build from source) |
| OS support | macOS · Linux (apt/dnf/pacman) · WSL2 |
| Windows | Use [`install.ps1`](../../scripts/install.ps1); Docker Desktop is required |

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
(`[N/TOTAL]`). It branches into two paths depending on `--no-docker`.

### 🚩 Common arguments / env vars

| Flag / env | Default | Purpose |
|------------|---------|---------|
| `--no-docker` | off | Skip the container, install natively (expert mode) |
| `--with-docker` | on | Alias kept for retro-compat (Docker is already the default) |
| `--dry-run` | off | Print every install/download/mutating action without executing any of them |
| `--runtime <id>` | `colima` | macOS runtime: `colima` or the user's `docker-desktop` |
| `--branch <name>` | `master` | Source branch for wrapper and Compose downloads |
| `-h`, `--help` | — | Print the header banner and exit |
| `JHT_REPO_URL` | `https://github.com/leopu00/job-hunter-team.git` | Repo cloned in native mode |
| `JHT_BRANCH` | `production` | Stable release branch checked out in native mode + raw download base in Docker mode |
| `JHT_INSTALL_DIR` | `$HOME/.jht/src` | Where the repo lands in native mode |
| `JHT_RUNTIME_DIR` | `$HOME/.jht/runtime` | Where `docker-compose.yml` lands in Docker mode |
| `JHT_BIN_DIR` | `$HOME/.local/bin` | Where the `jht` wrapper / symlink lands |
| `JHT_IMAGE` | `ghcr.io/leopu00/jht@sha256:07b154bee43f32d2e6313c54f28e389836556e2b5cbe1b76d03398684c38b598` | Content-addressed container image referenced by the compose |
| `JHT_RAW_BASE` | `https://raw.githubusercontent.com/leopu00/job-hunter-team/$JHT_BRANCH` | Base URL for the runtime file downloads |
| `JHT_SKIP_ONBOARD` | `0` | Skip the post-install `jht setup` wizard |

### 🐳 Default path — Docker (4 steps)

> Since 2026-05-06 the Docker path follows the **host/container split**
> design — see [`docs/internal/ops/vps.md`](../internal/ops/vps.md).
> The wrapper does not run an ephemeral `docker run --rm` per command:
> it dispatches to `docker compose` (lifecycle) or `docker exec` (operativity)
> against a long-running `jht` container.

1. **Detect system** — `uname -s` → macOS / Linux / WSL (`grep microsoft
   /proc/version`); on Linux/WSL also picks `apt` / `dnf` / `pacman`.
2. **Install container runtime** — *detect-first: if a Docker daemon already
   responds (Docker Desktop, an existing Colima, OrbStack, …) it is reused and
   nothing is installed.*
   - macOS: `--runtime=colima` (default) installs Homebrew if missing →
     `brew install colima docker` → `colima start`. `--runtime=docker-desktop`
     uses your own Docker Desktop (`open -a Docker`; never silent-installed).
     See [ADR-0006](../adr/0006-user-choice-container-runtime-macos.md).
   - Linux/WSL: `apt-get install docker.io` (or dnf/pacman equivalent),
     `systemctl enable --now docker` if available, `service docker start`
     on WSL, and `usermod -aG docker $USER` so subsequent runs don't need
     sudo.
3. **Verify Docker** — `docker info`. On Linux falls back to `sudo docker
   info` if the user is not yet in the `docker` group.
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
   call `docker compose` / `docker logs` / `docker inspect`; everything
   else is forwarded as `docker exec -it jht node /app/cli/bin/jht.js
   <args>`. Auto-up: lifecycle of the container is transparent on
   first run.

### 🛠️ Expert path — native (`--no-docker`, 7 steps)

1. **Detect system** (same as Docker path).
2. **System deps** — `git`, `tmux`, `curl` via the detected package
   manager; `brew` on macOS.
3. **Node.js ≥ 22** — NodeSource repo on apt/dnf, `brew install
   node@22` on macOS, `pacman -S nodejs npm` on Arch.
4. **Provider CLI** — `npm install -g @anthropic-ai/claude-cli` (legacy
   package name, see [Current limitations](#%EF%B8%8F-current-limitations)). Failure
   here is non-fatal (warns and continues).

   > 💡 **Native mode installs only Claude today.** If you plan to use
   > Codex or Kimi instead, install the corresponding CLI manually after
   > the script finishes:
   > - 🟠 **Claude Code**: `npm install -g @anthropic-ai/claude-code` *(modern package)*
   > - 🔵 **Codex**: `npm install -g @openai/codex`
   > - 🌙 **Kimi**: see [Moonshot docs](https://github.com/MoonshotAI/kimi-cli) — installed via Python `uv`, not npm
   >
   > See [`docs/about/PROVIDERS.md`](../about/PROVIDERS.md) for the full provider matrix.
5. **Clone** — `git clone --depth 1 --branch $JHT_BRANCH $JHT_REPO_URL
   $JHT_INSTALL_DIR`. If already present, fetches and `git reset --hard
   origin/$JHT_BRANCH`.
6. **Build** — `npm install` for `cli/`, then `npm install` for every
   `shared/*/` workspace that declares dependencies.
7. **Symlink `jht`** — `$JHT_BIN_DIR/jht` → `$JHT_INSTALL_DIR/cli/bin/jht.js`.

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
| `$JHT_RUNTIME_DIR/host-setup.sh` (Docker on macOS/Linux/WSL2) | Host-type, locale, timezone and VPS preflight helper |
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

They do **not** install Docker, Node, or any system dependency — they
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
bash scripts/install.sh --dry-run                 # docker path
bash scripts/install.sh --no-docker --dry-run     # native path
```

Example output (abridged; exact actions depend on the host):

```text
╔══════════════════════════════════════════╗
║     Job Hunter Team — Installer          ║
╚══════════════════════════════════════════╝

  mode:   Docker (isolated)
  image:  ghcr.io/leopu00/jht@sha256:07b154bee43f32d2e6313c54f28e389836556e2b5cbe1b76d03398684c38b598
  branch: production
  runtime:$HOME/.jht/runtime
  dry-run: ON (no changes to the system)

[1/4] System detection
  ✓ macOS

[2/4] Container runtime
  ▸ Installing Colima...
  [dry-run] would execute: brew install colima
  ✓ docker CLI already installed
  [dry-run] would execute: colima start (se non gia' attivo)

[3/4] Docker check
  [dry-run] would execute: docker info

[4/4] Download wrapper + docker-compose.yml
  [dry-run] would execute: mkdir -p $HOME/.jht/runtime $HOME/.local/bin
  [dry-run] would download: …/master/docker-compose.yml -> $HOME/.jht/runtime/docker-compose.yml
  [dry-run] would download: …/master/scripts/jht-wrapper.sh -> $HOME/.local/bin/jht
  [dry-run] would download: …/master/scripts/host-setup.sh -> $HOME/.jht/runtime/host-setup.sh
  [dry-run] would execute: chmod +x $HOME/.local/bin/jht $HOME/.jht/runtime/host-setup.sh
```

What `--dry-run` covers:

- `brew install`, `apt-get install`, `dnf install`, `pacman -S`
- `curl ... | bash` style one-liners (Homebrew, NodeSource)
- `colima start`, `systemctl enable --now docker`, `service docker start`
- `docker info` (the image pull is lazy and belongs to the later `jht setup` /
  `jht up`, so dry-run does not contact the registry)
- `git clone`, `git fetch`, `git reset` (--no-docker path only)
- `mkdir -p` on persistent paths, `chmod +x`, and all three runtime downloads
- the final `jht setup` wizard (skipped in dry-run)

What `--dry-run` intentionally does **not** do:

- It still runs read-only probes: `uname -s`, `command -v`, reading
  `/etc/os-release`, etc. Those have no side effect.
- It does **not** verify that `apt-get`, `brew`, or `docker` would
  succeed; it only prints the intent. Use `--dry-run` as a preview,
  not a test.

---

## ⚠️ Current limitations

- **Expert native mode installs a legacy Claude package** — `--no-docker`
  still attempts `@anthropic-ai/claude-cli`. The normal Docker path is not
  affected: `jht setup` installs the selected current CLI through
  [`cli/src/commands/providers.js`](../../cli/src/commands/providers.js).
- 📌 **Endpoint pins `master`, not a release tag** — a stable curl
  install would benefit from pinning to the latest GitHub release tag
  (rewrite to `raw.githubusercontent.com/.../<tag>/scripts/install.sh`,
  or generate `web/public/install.sh` from the latest release at build
  time).
- **Windows requires Docker Desktop** — `install.ps1` verifies it but does not
  silently accept its license, enable WSL2 or complete a reboot.

---

## 📚 Related

- 🚀 [`docs/guides/QUICKSTART.md`](QUICKSTART.md) — the human-friendly install guide (4 paths)
- 💳 [`docs/about/PROVIDERS.md`](../about/PROVIDERS.md) — supported subscriptions matrix
- 🦞 [`docs/guides/AI-AGENT-INTEGRATION.md`](AI-AGENT-INTEGRATION.md) — let your AI assistant drive `jht`
- 📐 [`docs/internal/ops/INFRA.md`](../internal/ops/INFRA.md) — infrastructure diagram and deployment modes
- 🧪 [`docs/guides/BETA.md`](BETA.md) — testing and feedback channels
- 🔒 [`docs/internal/ops/MAINTAINERS.md`](../internal/ops/MAINTAINERS.md) — internal operations reference
- 📐 [ADR-0004](../adr/0004-subscription-only-no-api-keys.md) — why subscription-only, no API keys
