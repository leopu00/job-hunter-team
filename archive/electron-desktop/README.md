# 🖥️ Electron desktop legacy archive

> **Archived on 2026-08-24.** This is the last complete Electron tree before
> commit `ef2dcca38a` removed it, recovered from source commit `cfc703781c`.
> It is kept as a runnable reference for onboarding, SSH/VPS, terminal,
> credential-store and packaging work. It is not the current desktop product,
> is not part of the root npm scripts, and must not be imported wholesale into
> the Tauri application.
>
> Public-repository safety cleanup: personal maintainer email strings were
> replaced with the project support address, and synthetic VPS addresses were
> normalized to the RFC 5737 documentation range. Runtime behaviour is
> unchanged.

Desktop app for Job Hunter Team. It installs dependencies, prepares the
Docker container, handles provider auth, and starts the team — so non-technical
users never touch a terminal. It's also the **interaction cockpit**: chat,
file upload, and team start/stop — for a local team via a browser window to
`localhost`, for a VPS team via the same stack over an SSH tunnel. The **web
dashboard is read-only** (data only); Telegram is the optional async channel.

- **Package:** `jht-desktop` · **Stack:** Electron · electron-builder

## Layout

```
main.js              Electron main process
preload.js           preload bridge
container*.js         Docker container prep & lifecycle
deps*.js / dependencies.js   dependency install (in-app, no CLI)
disk-space.js        preflight checks
provider-*.js        provider auth / install / store
docker-installer/    bundled Docker setup (macOS: Colima or Docker Desktop, user choice)
auth/                OAuth flows
assets/ · build/     icons & packaging resources
*.test.js            unit tests (run with npm test)
```

## Run

```bash
npm run dev          # launch in dev
npm test             # unit tests
npm run dist:mac     # build .dmg — ad-hoc signature, code signing deferred during beta  (also dist:win / dist:linux)
```

## See also

- Container runtime policy: [`docs/adr/0008-podman-evaluated-behind-a-shim.md`](../../docs/adr/0008-podman-evaluated-behind-a-shim.md)
- VPS / host split: [`docs/internal/ops/vps.md`](../../docs/internal/ops/vps.md)
- Current desktop migration: [`docs/internal/roadmap/2026-08-24-desktop-tauri-migration.md`](../../docs/internal/roadmap/2026-08-24-desktop-tauri-migration.md)
