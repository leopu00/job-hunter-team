# 📦 CLI install — `jobhunterteam.ai/install.sh`

This document describes how the one-liner installer works **today**
(behaviour AS-IS, before any further hardening). It is the reference
for **Path 3 (One-liner installer)** in the [Quickstart](quickstart.md):

```bash
curl -fsSL https://jobhunterteam.ai/install.sh | bash
```

For the GUI / desktop launcher path, see the `/download` page.
For onboarding inside an already-cloned repo, see [legacy `setup.sh` / `setup.ps1`](#-legacy-onboarding-setupsh--setupps1).

---

## 📋 TL;DR

| Item | Value |
|------|-------|
| Source of truth | [`scripts/install.sh`](../scripts/install.sh) |
| Served by | Vercel (Next.js project in `web/`) |
| URL | `https://jobhunterteam.ai/install.sh` |
| HTTP cache | `public, max-age=300, s-maxage=3600, stale-while-revalidate=86400` |
| Default mode | Docker (Colima on macOS, native Docker on Linux/WSL2) |
| Expert mode | `--no-docker` (clone + build from source) |
| OS support | macOS · Linux (apt/dnf/pacman) · WSL2 |
| Windows native | Not supported by this script — Windows users go via desktop launcher |

---

## 🔌 How the endpoint is wired

There is **no Next.js API route** behind `/install.sh`. The file is shipped
as a static asset:

1. The repo-root [`vercel.json`](../vercel.json) declares a Next.js build
   for the `web/` workspace.
2. Its `buildCommand` runs `cp scripts/install.sh web/public/install.sh`
   **before** `next build`. This guarantees the deployed copy is always
   the one in the repo at the deploy commit.
3. The same `vercel.json` adds explicit headers for `/install.sh`:
   - `content-type: application/x-sh; charset=utf-8`
   - `cache-control: public, max-age=300, s-maxage=3600, stale-while-revalidate=86400`

So `https://jobhunterteam.ai/install.sh` is served straight from
`web/public/install.sh`, which is overwritten at build time.

**Implication** — the endpoint always reflects the `master` branch (or
whatever branch Vercel is set to deploy). Tagging a release does not
change what curl returns; deploying does. If we ever want curl to pin to
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
| `-h`, `--help` | — | Print the header banner and exit |
| `JHT_REPO_URL` | `https://github.com/leopu00/job-hunter-team.git` | Repo cloned in native mode |
| `JHT_BRANCH` | `master` | Branch checked out in native mode + raw download base in Docker mode |
| `JHT_INSTALL_DIR` | `$HOME/.jht/src` | Where the repo lands in native mode |
| `JHT_RUNTIME_DIR` | `$HOME/.jht/runtime` | Where `docker-compose.yml` lands in Docker mode |
| `JHT_BIN_DIR` | `$HOME/.local/bin` | Where the `jht` wrapper / symlink lands |
| `JHT_IMAGE` | `ghcr.io/leopu00/jht:latest` | Container image referenced by the compose |
| `JHT_RAW_BASE` | `https://raw.githubusercontent.com/leopu00/job-hunter-team/$JHT_BRANCH` | Base URL for `docker-compose.yml` + `jht-wrapper.sh` downloads |
| `JHT_SKIP_ONBOARD` | `0` | Skip the post-install `jht setup` wizard |

### 🐳 Default path — Docker (4 steps)

> Since 2026-05-06 the Docker path follows the **host/container split**
> design — see [`docs/internal/2026-05-06-host-container-split.md`](../internal/2026-05-06-host-container-split.md).
> The wrapper does not run an ephemeral `docker run --rm` per command:
> it dispatches to `docker compose` (lifecycle) or `docker exec` (operativity)
> against a long-running `jht` container.

1. **Detect system** — `uname -s` → macOS / Linux / WSL (`grep microsoft
   /proc/version`); on Linux/WSL also picks `apt` / `dnf` / `pacman`.
2. **Install container runtime** —
   - macOS: install Homebrew if missing → `brew install colima docker` →
     `colima start` (Colima is Apache-2.0, no Docker Desktop).
   - Linux/WSL: `apt-get install docker.io` (or dnf/pacman equivalent),
     `systemctl enable --now docker` if available, `service docker start`
     on WSL, and `usermod -aG docker $USER` so subsequent runs don't need
     sudo.
3. **Verify Docker** — `docker info`. On Linux falls back to `sudo docker
   info` if the user is not yet in the `docker` group.
4. **Download wrapper + compose** — `curl -fsSL` of:
   - `$JHT_RAW_BASE/docker-compose.yml` → `$JHT_RUNTIME_DIR/docker-compose.yml`
   - `$JHT_RAW_BASE/scripts/jht-wrapper.sh` → `$JHT_BIN_DIR/jht` (chmod +x)

   The image is **not pulled eagerly**: `jht up` (the first command the
   user runs) does `docker compose up -d`, which pulls the image lazily
   and starts the long-running container.

   The wrapper is a thin (~165 LOC) host-side dispatcher: lifecycle
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
   package name, see [Known gaps](#-known-gaps-and-follow-ups)). Failure
   here is non-fatal (warns and continues).

   > 💡 **Native mode installs only Claude today.** If you plan to use
   > Codex or Kimi instead, install the corresponding CLI manually after
   > the script finishes:
   > - 🟠 **Claude Code**: `npm install -g @anthropic-ai/claude-code` *(modern package)*
   > - 🔵 **Codex**: `npm install -g @openai/codex`
   > - 🌙 **Kimi**: see [Moonshot docs](https://github.com/MoonshotAI/kimi-cli) — installed via Python `uv`, not npm
   >
   > See [`docs/PROVIDERS.md`](../about/PROVIDERS.md) for the full provider matrix.
5. **Clone** — `git clone --depth 1 --branch $JHT_BRANCH $JHT_REPO_URL
   $JHT_INSTALL_DIR`. If already present, fetches and `git reset --hard
   origin/$JHT_BRANCH`.
6. **Build** — `npm install` + `npx tsc` for `tui/`, `npm install` for
   `cli/`, then `npm install` for every `shared/*/` workspace that
   declares dependencies.
7. **Symlink `jht`** — `$JHT_BIN_DIR/jht` → `$JHT_INSTALL_DIR/cli/bin/jht.js`.

### 🚀 After both paths

- Prints final banner with what was installed, the file layout, and
  uninstall instructions.
- If stdin/stdout are a TTY and `JHT_SKIP_ONBOARD=0`, prompts to run
  `jht setup` immediately.

### 📁 Where things land

| Path | Purpose |
|------|---------|
| `~/.jht/` (host) → `/jht_home` (container) | Config, `jobs.db`, agents, credentials |
| `~/Documents/Job Hunter Team/` (host) → `/jht_user` (container) | CVs, generated outputs |
| `$JHT_BIN_DIR/jht` (default `~/.local/bin/jht`) | The wrapper (Docker) or symlink (native) |
| `$JHT_RUNTIME_DIR/docker-compose.yml` (default `~/.jht/runtime/`, Docker only) | The compose file the wrapper drives |
| `$JHT_INSTALL_DIR` (default `~/.jht/src`, native only) | The cloned repo |

If `$JHT_BIN_DIR` is not on `$PATH`, the script warns and prints the
`export PATH=...` line to add to `~/.zshrc` / `~/.bashrc`.

---

## 📜 Legacy onboarding: `setup.sh` / `setup.ps1`

The repo also ships `setup.sh` (bash) and `setup.ps1` (PowerShell) at
the root. **These are not the one-liner installer.** They both print a
deprecation banner pointing at `https://jobhunterteam.ai/install.sh`.

They exist for the case "I already cloned the repo and want a
deterministic Python/Node onboarding from source": they create
`.venv/`, install `requirements.txt`, copy `.env.example` →`.env`,
copy `candidate_profile.yml.example` → `candidate_profile.yml`, run
`npm install` in `web/`, install the git pre-commit hook, init the
SQLite DB, and print next steps.

They do **not** install Docker, Node, or any system dependency — they
assume the developer already has Python ≥ 3.10, tmux, Node and npm.

If you find yourself reaching for these, you probably want the one-liner
or `docs/guides/quickstart.md` instead.

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

Both finish in under a second and exit `0`.

Sample output (docker path on a Mac that already has `docker`, no
Colima, no image pulled):

```text
╔══════════════════════════════════════════╗
║     Job Hunter Team — Installer          ║
╚══════════════════════════════════════════╝

  mode:   Docker (isolato)
  image:  ghcr.io/leopu00/jht:latest
  branch: master
  runtime:$HOME/.jht/runtime
  dry-run: ON (nessuna modifica al sistema)

[1/4] Rilevamento sistema
  ✓ macOS

[2/4] Container runtime
  ▸ Installo Colima (runtime container Apache 2.0, no Docker Desktop)...
  [dry-run] would execute: brew install colima
  ✓ docker CLI gia' installato
  [dry-run] would execute: colima start (se non gia' attivo)

[3/4] Verifica docker
  [dry-run] would execute: docker info

[4/4] Download wrapper + docker-compose.yml
  [dry-run] would execute: mkdir -p $HOME/.jht/runtime $HOME/.local/bin
  [dry-run] would download: …/master/docker-compose.yml -> $HOME/.jht/runtime/docker-compose.yml
  [dry-run] would download: …/master/scripts/jht-wrapper.sh -> $HOME/.local/bin/jht
  [dry-run] would execute: chmod +x $HOME/.local/bin/jht
```

What `--dry-run` covers:

- `brew install`, `apt-get install`, `dnf install`, `pacman -S`
- `curl ... | bash` style one-liners (Homebrew, NodeSource)
- `colima start`, `systemctl enable --now docker`, `service docker start`
- `docker info`, image pull (lazy on first `jht up`, no longer eager in install.sh)
- `git clone`, `git fetch`, `git reset` (--no-docker path only)
- `mkdir -p` on persistent paths, `chmod +x`, `curl -fsSL` of compose+wrapper
- the final `jht setup` wizard (skipped in dry-run)

What `--dry-run` intentionally does **not** do:

- It still runs read-only probes: `uname -s`, `command -v`, reading
  `/etc/os-release`, etc. Those have no side effect.
- It does **not** verify that `apt-get`, `brew`, or `docker` would
  succeed; it only prints the intent. Use `--dry-run` as a preview,
  not a test.

---

## 🧭 Tested environments

| OS | Mode | Date | Result | Notes |
|----|------|------|--------|-------|
| macOS 15 (this Mac) | Docker `--dry-run` | 2026-04-16 | OK, exit 0 | Walks all 5 steps, no side effects. Colima not installed locally — shown as "would execute: brew install colima" |
| macOS 15 (this Mac) | `--no-docker --dry-run` | 2026-04-16 | OK, exit 0 | Walks all 7 steps. `git`/`tmux`/`node`/`claude` already present, so only clone/build/link are "would execute" |
| macOS 15 (this Mac) | Docker (real install) | _not run_ | — | Would install Colima system-wide; skipped in this session |
| Ubuntu 24.04 (`docker run -it ubuntu:24.04`) | Docker `--dry-run` | _not run in this session_ | — | Docker daemon not active locally at verification time; skipped per anti-crash rules |
| Ubuntu 24.04 | `--no-docker` | _not run_ | — | Needs a clean VM |
| WSL2 (Ubuntu) | Docker | _not run_ | — | No WSL host available |

---

## 🐛 Known gaps and follow-ups

Tickets to file on `scripts/install.sh` itself (not on this doc):

- 🟠 **Wrong Claude package name** — line 505/508 installs the legacy
  `@anthropic-ai/claude-cli`. The active CLI is `@anthropic-ai/claude-code`
  (see `desktop/provider-install.js:33`). Update install.sh + add Codex
  and Kimi as additional optional installs in the native flow.
- 🌍 **Italian output strings** — install.sh prints user-facing messages
  in Italian (`Rilevamento sistema`, `Installazione Colima fallita`,
  `gia' installato`, ...) while the rest of the project is in English.
  Translate to English (or wire into `shared/i18n/`).
- 🐧 **Unverified Linux/WSL paths** — run the installer end-to-end on at
  least one clean Linux VM and one clean WSL2 host; `--dry-run` on Mac
  is not a substitute.
- 📌 **Endpoint pins `master`, not a release tag** — a stable curl
  install would benefit from pinning to the latest GitHub release tag
  (rewrite to `raw.githubusercontent.com/.../<tag>/scripts/install.sh`,
  or generate `web/public/install.sh` from the latest release at build
  time).
- 🪟 **`setup.ps1` arch/WSL detection** — still doesn't detect CPU
  architecture (ARM vs AMD64) nor WSL availability before claiming
  `tmux` works.

---

## 📚 Related

- 🚀 [`docs/guides/quickstart.md`](quickstart.md) — the human-friendly install guide (4 paths)
- 💳 [`docs/PROVIDERS.md`](../about/PROVIDERS.md) — supported subscriptions matrix
- 🦞 [`docs/AI-AGENT-INTEGRATION.md`](AI-AGENT-INTEGRATION.md) — let your AI assistant drive `jht`
- 📐 [`docs/INFRA.md`](../internal/INFRA.md) — infrastructure diagram and deployment modes
- 🧪 [`docs/BETA.md`](BETA.md) — beta tester program (report install issues here)
- 🔒 [`docs/MAINTAINERS.md`](../internal/MAINTAINERS.md) — internal operations reference
- 📐 [ADR-0004](./adr/0004-subscription-only-no-api-keys.md) — why subscription-only, no API keys
