# JHT Desktop — status & roadmap

The desktop app is the **no-terminal** way to run Job Hunter Team: an Electron
launcher that installs the prerequisites, runs the agent team in a local Docker
container, and gives you a native dashboard + chat to drive it.

It works end-to-end today, but it is **not yet publicly promoted**. The web
`/download` page is intentionally disabled (it redirects to the CLI guide) until
the gaps below are closed. For now the **supported entry point is the CLI**; the
desktop app is where we want contributors to help.

> This document is the honest state of things — what works, what's broken, what's
> missing, and where we want to take it. If you're here from the recruitment
> post: the "Vision" and "Where we need help" sections are for you.

---

## Status at a glance

| Area | State | Notes |
|---|---|---|
| Install wizard (Win/mac/Linux) | 🟢 Works | One-click install, guided setup |
| Prerequisite install (WSL/Git/Docker) | 🟢 Works | Windows path fully wired |
| Container/team boot | 🟢 Works | 7 agents come up in tmux |
| Provider login (Claude/Codex/Kimi) | 🟢 Works | Embedded terminal login |
| Language selection | 🟢 Works | 7 languages, live on welcome screen |
| Native dashboard (positions/stats) | 🟡 Partial | Reads work; parity with web incomplete |
| Chat with agents | 🟡 Partial | Captain + Assistant only; new model below |
| Agent lifecycle (stop/respawn) | 🔴 Missing | No UI control yet |
| Observability (spend / activity) | 🔴 Missing | Not surfaced in the app |
| Auto-update of the container image | 🟢 Works | Fixed this cycle (see below) |
| Cross-platform QA | 🟡 Partial | Windows tested live; mac/Linux thin |

---

## What works today

The full first-run flow is real and has been driven end-to-end on Windows:

1. **Install** — NSIS/dmg/AppImage installer, one click (unsigned during beta).
2. **Welcome + language** — first screen carries the language picker; switching
   it re-translates the whole screen live. 7 languages.
3. **Readiness check** — detects and installs WSL2, Git and Docker Desktop
   (Windows). Reboot is only prompted when WSL was actually freshly installed.
4. **Provider login** — pick a provider (Claude / Codex / Kimi), log in through
   an embedded xterm terminal that runs the provider CLI inside the container.
5. **Profile upload** — drop in a CV; the Assistant ingests it.
6. **Working hours, email, Telegram** — optional steps, skippable.
7. **Start team** — boots the Docker container (`ghcr.io/leopu00/jht:latest`) and
   brings up the agents. Confirmed: 7 tmux sessions come alive — Captain
   (`ALFA`), Analyst, Critic, Scorer, Scout, Writer, Sentinel.

Under the hood the launcher also handles: bundling the platform-native binaries
(node-pty for the terminal, keyring for secure credential storage), a local
auth token so the native views can read the team's API, and a
read-only-web / write-only-desktop security split.

---

## Known gaps & bugs

- **Dashboard parity is incomplete.** The desktop shows a *native* dashboard
  (positions, stats) that reads the same local API the web dashboard uses, but
  it doesn't yet mirror everything the web view offers. The goal is one dashboard
  experience, identical on web and desktop.
- **Chat is limited to Captain + Assistant** and uses a direct tmux channel. The
  model we want is different (see Vision → Chat).
- **No agent lifecycle controls.** You can't stop, pause or respawn an individual
  agent from the app. Today that's tmux/CLI only.
- **No observability.** Token/credit spend and "what is each agent doing right
  now" aren't surfaced in the app.
- **Uninstall leaves an empty program dir** when Docker/WSL hold an open handle
  to it — cosmetic (the folder is empty and writable), but not clean.
- **Cross-platform QA is thin.** Windows has been exercised live this cycle;
  macOS and Linux installers build but have had far less hands-on testing.

### Fixed this cycle (2026-07)

- Bundled `email-verify.js` (was excluded from the asar → launch crash).
- Only prompt a reboot when WSL was actually installed (was always prompting).
- Detect provider CLIs by bin-dir name on Windows/WSL2 (lstat failed on the
  WSL2 symlinks → provider-login step looked empty).
- Bundle the **win32 node-pty & keyring native binaries** on a Mac cross-build
  (npm skips per-platform optional deps → the login terminal was dead on Windows
  with `node-pty not available`). See `scripts/ensure-win-natives.js`.
- **Auto-update the container image.** The launcher used to skip `docker pull`
  whenever *any* local image existed, to protect a locally-built dev image — but
  that froze end users on the first image they ever pulled (stale backend, old
  routes, placeholder data) even after updating the app. Now only a
  *locally-built* image (no registry digest) is left alone; a pulled image always
  refreshes to the current `:latest`.

---

## Left to test

- Full first-run on **macOS** and **Linux** (only Windows has been driven live).
- **Container auto-update** in the wild: fresh install → old cached image →
  confirm it pulls the current one on "Start team".
- **VPS mode**: the app can attach to and control a team running on a remote VPS
  (start/stop/monitor as if local) — needs an end-to-end pass from the app.
- Provider login for **Codex** and **Kimi** (only Claude exercised recently).
- Email + Telegram onboarding steps end-to-end.
- Uninstall / reinstall / upgrade cycles.

---

## Vision — what we want the desktop app to be

The desktop app should be the **single cockpit** for a non-technical user to own
their agent team. Concretely:

### Dashboard
- **One dashboard, everywhere.** The exact same dashboard the user sees on the
  web, available natively in the desktop app — positions, scores, pipeline,
  activity. Same data, same views, no second-class desktop version.

### Agent control (lifecycle)
- **See the team** — who's running, who's idle.
- **Stop** an agent (or the whole team) from the UI.
- **Respawn** an agent that died or that you stopped.
- All without touching a terminal.

### Observability
- **Spend** — how much each agent / the whole team is consuming (tokens /
  credits), live and over time.
- **Activity** — what each agent is doing *right now*, in plain language.

### Chat — new model
Today you can chat with Captain and Assistant directly. We want to change the
concept to a **three-door model**:

- You chat **only** with three agents: **Assistant**, **Mentor**, **Captain**.
- Through those three you reach everyone else — they relay to and coordinate the
  rest of the team. You don't chat with Scout/Analyst/Writer/etc. directly.
- The most important conversation is with the **Assistant** — it's the human's
  main interface to the whole system.

This mirrors the Telegram model (three dedicated bots: assistant / captain /
mentor) and keeps the mental model simple: three people to talk to, and they run
the rest.

---

## Where we need help (contributors)

Highest-impact, roughly in order:

1. **Desktop dashboard ↔ web parity** — make the native dashboard a faithful
   mirror of the web one.
2. **Agent lifecycle UI** — stop / respawn / status, wired to the existing
   `docker exec` + tmux control plane.
3. **Observability panel** — surface spend and per-agent activity.
4. **Chat three-door model** — restrict chat to Assistant/Mentor/Captain and
   implement relaying to the rest of the team.
5. **macOS / Linux QA** — drive the full flow, file what breaks.

---

## Architecture (orientation for contributors)

- **Shell:** Electron (`main.js` = main process, `renderer/` = UI). Wiring is
  split into `renderer/modules/*` (wizard-flow, terminal-login, dash-chat,
  docker-card, home, running, …).
- **Backend:** the team runs in a Docker container (`ghcr.io/leopu00/jht:latest`)
  built from the repo. Agents run as **tmux** sessions inside it; the CLI
  (`cli/bin/jht.js`) is the control plane. The desktop drives the team via
  `docker exec` (start team, tmux send-keys for chat), never by re-implementing
  it.
- **Web ↔ desktop:** the container also serves the Next.js web app on `:3000`.
  The desktop's native views call that same API over `127.0.0.1`, authenticating
  with a local token file (`~/.jht/.local-token`, bind-mounted into the
  container). Web is **read-only**; mutations happen only from the desktop/CLI
  (security: secrets stay local).
- **Bind mounts:** `~/.jht → /jht_home` (config, agents, logs, credentials) and
  `~/Documents/Job Hunter Team → /jht_user` (user-visible drop zone).

### Build & run

```bash
cd desktop
npm install
npm run dev          # run the app from source (electron .)
npm test             # unit tests (node --test)

# Package installers:
npm run dist:mac     # dmg
npm run dist:linux   # AppImage + deb
npm run dist:win     # nsis (x64 + arm64)
```

`predist:win` runs `scripts/ensure-win-natives.js`, which vendors the win32
native binaries so a Mac/Linux cross-build produces a working Windows installer.
