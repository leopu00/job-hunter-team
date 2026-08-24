# [JHT-DESKTOP-TAURI] — Tauri 2 + React desktop migration

**Decision:** accepted on 2026-08-24
**Implementation:** started — welcome/setup shell in `desktop/`
**Working branch/worktree:** `desktop-tauri`
**Architecture record:** [ADR-0011](../../adr/0011-tauri-desktop-shell.md)

## Outcome

The target desktop application is a **Tauri 2 shell with a static React UI**.
It consumes versioned APIs and owns only native operating-system integration.
The current Godot application stays supported while slices move across; its
2.5D office can survive as an optional surface after the migration.

Electron is not being resurrected as the product. Its last complete tree is
isolated under `archive/electron-desktop/` as a reference catalogue of solved
flows — onboarding, SSH/VPS, embedded terminal, provider authentication and
packaging. It is outside the current desktop package and individual pieces may
be recovered only after review.

## The boundaries

There are two related Node.js/TypeScript efforts and they must not be confused:

| Boundary | Purpose | State at decision time |
|---|---|---|
| **Product/control API** ([ADR-0009](../../adr/0009-team-exposes-one-loopback-api.md)) | One versioned interface for status, data, commands and live events, reached locally or through an SSH tunnel | First read-only server slice exists; client migration and supervision remain open |
| **API-backed agent workers** (`api-agents` branch) | Run role workers through provider APIs with typed contracts, guardrails and explicit authorized adapters | Node.js/TypeScript prototypes; not yet the production team runtime |

The shipped Python/tmux team remains operational during migration. The target is
to replace roles deliberately with Node.js/TypeScript API workers, not to hide
the Python runtime inside the desktop app.

```text
provider APIs
      │
      ▼
Node/TypeScript role workers ──► guardrails, contracts and audit
      │
      ▼
versioned product/control API ◄── local loopback / SSH tunnel
      │
      ▼
shared React application
      │
      ├── browser shell (cloud capabilities only)
      └── Tauri shell (native capabilities)
                 │
                 └── optional Godot 2.5D office
```

## Thin-shell contract

Tauri/Rust may own:

- window, tray, notification and deep-link integration;
- native file/folder selection and explicitly scoped filesystem access;
- credential storage through an audited platform facility;
- starting, stopping and observing a local API/worker process;
- opening and supervising an SSH tunnel to a remote API;
- signed installation, update and rollback mechanics.

Tauri/Rust must not own scoring, prompts, agent routing, persistence queries or
product policy. React must not read SQLite, invoke Docker or control agents
directly. Those calls cross a typed, versioned boundary.

## Phase 0 — recover knowledge, not the old application

1. Keep the last complete Electron tree (`cfc703781c`) under
   `archive/electron-desktop/`, outside the active desktop package, and inventory
   reusable flows there.
2. Classify each candidate as reusable UI/domain code, obsolete infrastructure,
   or behaviour already superseded by Godot/current APIs.
3. Port only an item that has a current owner, current tests and no duplicate
   transport path.

## Phase 1 — Windows-first Tauri spike

Build the smallest disposable shell that proves all mandatory gates:

- static React/Vite renderer starts on Windows with the expected WebView2 path;
- the shell starts and observes a Node.js sidecar, then shuts it down cleanly;
- `GET /version` and one authenticated read route work over loopback;
- the same client reaches a VPS through an SSH tunnel without changing domain
  code;
- tray, native notification, file picker and secure credential storage work;
- an embedded terminal/PTY route is either proven or replaced by an explicit,
  documented UX;
- capability permissions are least-privilege and fail closed;
- signed updater configuration and rollback are exercised with test keys;
- Windows packaging succeeds, while macOS and Linux build prerequisites and
  package formats are recorded.

Record cold-start time, idle memory, installer size and packaging friction for
the spike. Compare the same mandatory gates with a minimal Electron fallback
only if Tauri fails one; do not choose from estimates alone.

## Phase 2 — shared application shell

1. Create the React desktop shell and shared design/domain packages at boundaries
   that do not import Next.js server code.
2. Move one read-only professional view end to end through the product API.
3. Add contract fixtures for version skew, authentication failure, API offline,
   tunnel loss and a newer server capability.
4. Delete the migrated view's private transport path; parity beside duplication
   does not complete the slice.

## Phase 3 — lifecycle and interaction

1. Complete the ADR-0009 client, supervision and SSH-tunnel slices.
2. Add live events, then the first bounded write lane.
3. Move onboarding, settings, provider authentication, file workflows and
   recovery one vertical slice at a time.
4. Keep shell errors actionable: offline, unauthorized, version mismatch,
   tunnel down and child-process exit are distinct states.

## Phase 4 — office and release transition

1. Decide the optional-office integration from a working shell: separate
   process, deep link/IPC, or separately installed component. Do not choose it
   before the shell exists.
2. Prove clean install, upgrade, rollback and uninstall on Windows, macOS and
   Linux; sign every artifact that can install or execute an update.
3. Define the parity checklist and migration window. Keep Godot downloadable
   until the new shell meets it.
4. Remove migrated GDScript UI/transport only after production evidence; retain
   the office renderer only where it adds product value.

## Exit criteria

- A single React/domain implementation serves the agreed desktop and web
  surfaces without embedding Next.js in the team container.
- Local PC, dedicated LAN PC and VPS use one API contract; location changes only
  connection setup.
- No desktop renderer directly owns agent policy, persistence or Docker/SSH
  command composition.
- Clean install and signed update/rollback pass on all three supported systems.
- Godot has an explicit supported role (optional office) or an evidence-backed
  retirement plan; it is never removed merely because the new window opens.

## Non-goals

- Rewriting production Python agents as part of the desktop ticket.
- Restoring the old Electron tree wholesale.
- Shipping a Next.js server or browser dashboard inside the container.
- Moving product behaviour into Rust to avoid defining an API.
- Running two permanent transports for the same migrated capability.

## Open implementation choices

- Final monorepo paths for the desktop app and shared React packages.
- Sidecar packaging versus connecting to an already supervised host service.
- PTY implementation and the exact optional-Godot launch/IPC contract.
- Release channels, signing-key custody and update hosting.
- The first read-only vertical slice used to prove the architecture.

## Current incremental slice (2026-08-24)

The first implemented path is deliberately narrow: the team runs in Podman
containers on the user's own PC and the new Node.js headless agents consume the
user's own OpenAI API key. The desktop starts with a welcome page and then shows
this setup. Native credential persistence and Podman provisioning are separate
follow-up slices; the renderer must not persist the key in browser storage.

The complete setup-mode decision is recorded in
[`2026-08-24-desktop-setup-modes.md`](../architecture/2026-08-24-desktop-setup-modes.md).
