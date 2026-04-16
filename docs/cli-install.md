# CLI install — `jobhunterteam.ai/install.sh`

This document describes how the one-liner installer works **today**
(behaviour AS-IS, before any further hardening). It is the reference for
the Path B promised in the README:

```bash
curl -fsSL https://jobhunterteam.ai/install.sh | bash
```

For the GUI / desktop launcher path, see the `/download` page.
For onboarding inside an already-cloned repo, see [legacy `setup.sh` / `setup.ps1`](#legacy-onboarding-setupsh--setupps1).

---

## TL;DR

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

## How the endpoint is wired

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

### Verifying the endpoint

```bash
curl -sI https://jobhunterteam.ai/install.sh
# expect: HTTP/2 200, content-type: application/x-sh; charset=utf-8

curl -fsSL https://jobhunterteam.ai/install.sh | head -5
# expect: shebang + the JHT banner comment block
```

---

## What `scripts/install.sh` does

The script is `set -euo pipefail`, idempotent, and prints a step counter
(`[N/TOTAL]`). It branches into two paths depending on `--no-docker`.

### Common arguments / env vars

| Flag / env | Default | Purpose |
|------------|---------|---------|
| `--no-docker` | off | Skip the container, install natively (expert mode) |
| `--with-docker` | on | Alias kept for retro-compat (Docker is already the default) |
| `-h`, `--help` | — | Print the header banner and exit |
| `JHT_REPO_URL` | `https://github.com/leopu00/job-hunter-team.git` | Repo cloned in native mode |
| `JHT_BRANCH` | `main` | Branch checked out in native mode |
| `JHT_INSTALL_DIR` | `$HOME/.jht/src` | Where the repo lands in native mode |
| `JHT_BIN_DIR` | `$HOME/.local/bin` | Where the `jht` wrapper / symlink lands |
| `JHT_IMAGE` | `ghcr.io/leopu00/jht:latest` | Container image used by the wrapper |
| `JHT_SKIP_ONBOARD` | `0` | Skip the post-install `jht setup` wizard |

### Default path — Docker (5 steps)

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
4. **Pull image** — `docker pull $IMAGE`. A failure here is non-fatal:
   the wrapper is still installed and re-running the installer once the
   image is published completes the install.
5. **Write `jht` wrapper** — generates `$JHT_BIN_DIR/jht` as a small
   shell script that:
   - ensures Colima is up on macOS,
   - mounts only `~/.jht` → `/jht_home` and `~/Documents/Job Hunter Team`
     → `/jht_user` (sandbox),
   - forwards a fixed allow-list of API-key env vars
     (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `MOONSHOT_API_KEY`,
     `CLAUDE_CODE_OAUTH_TOKEN`, `GEMINI_API_KEY`, `GOOGLE_API_KEY`),
   - publishes container port `3000`.

   The wrapper is intentionally bash-3.2-compatible (macOS) and avoids
   bash arrays under `set -u`.

### Expert path — native (`--no-docker`, 7 steps)

1. **Detect system** (same as Docker path).
2. **System deps** — `git`, `tmux`, `curl` via the detected package
   manager; `brew` on macOS.
3. **Node.js ≥ 22** — NodeSource repo on apt/dnf, `brew install
   node@22` on macOS, `pacman -S nodejs npm` on Arch.
4. **Claude CLI** — `npm install -g @anthropic-ai/claude-cli`. Failure
   here is non-fatal (warns and continues).
5. **Clone** — `git clone --depth 1 --branch $JHT_BRANCH $JHT_REPO_URL
   $JHT_INSTALL_DIR`. If already present, fetches and `git reset --hard
   origin/$JHT_BRANCH`.
6. **Build** — `npm install` + `npx tsc` for `tui/`, `npm install` for
   `cli/`, then `npm install` for every `shared/*/` workspace that
   declares dependencies.
7. **Symlink `jht`** — `$JHT_BIN_DIR/jht` → `$JHT_INSTALL_DIR/cli/bin/jht.js`.

### After both paths

- Prints final banner with what was installed, the file layout, and
  uninstall instructions.
- If stdin/stdout are a TTY and `JHT_SKIP_ONBOARD=0`, prompts to run
  `jht setup` immediately.

### Where things land

| Path | Purpose |
|------|---------|
| `~/.jht/` (host) → `/jht_home` (container) | Config, `jobs.db`, agents, credentials |
| `~/Documents/Job Hunter Team/` (host) → `/jht_user` (container) | CVs, generated outputs |
| `$JHT_BIN_DIR/jht` (default `~/.local/bin/jht`) | The wrapper (Docker) or symlink (native) |
| `$JHT_INSTALL_DIR` (default `~/.jht/src`, native only) | The cloned repo |

If `$JHT_BIN_DIR` is not on `$PATH`, the script warns and prints the
`export PATH=...` line to add to `~/.zshrc` / `~/.bashrc`.

---

## Legacy onboarding: `setup.sh` / `setup.ps1`

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
or `docs/quickstart.md` instead.

---

## Tested environments

> Filled in once we run the script end-to-end on clean machines.

| OS | Mode | Date | Result | Notes |
|----|------|------|--------|-------|
| macOS 15 (this Mac) | Docker | _todo_ | _todo_ | _todo_ |
| Ubuntu 24.04 (`docker run -it ubuntu:24.04`) | Docker | _todo_ | _todo_ | DinD limitations expected |
| Ubuntu 24.04 | `--no-docker` | _todo_ | _todo_ | _todo_ |
| WSL2 (Ubuntu) | Docker | _todo_ | _todo_ | _todo_ |

---

## Known gaps and follow-ups

- `--dry-run` flag — not yet implemented; tracked separately.
- The endpoint always serves `master`. We may want to pin to the latest
  GitHub release tag instead, so a stable curl install is reproducible.
- `setup.ps1` still detects neither CPU architecture (ARM vs AMD64) nor
  WSL availability before claiming `tmux` works.
- Quickstart says "Node 20+" but `scripts/install.sh` enforces
  `MIN_NODE_MAJOR=22`. Aligning these is a doc fix, not an installer
  change.
