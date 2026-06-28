# 🖥️ desktop — JHT Desktop app (Electron)

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
npm run dist:mac     # build signed .dmg  (also dist:win / dist:linux)
```

## See also

- Container runtime policy (macOS: Colima or Docker Desktop, user choice): [`docs/adr/0006-user-choice-container-runtime-macos.md`](../docs/adr/0006-user-choice-container-runtime-macos.md) (supersedes [`0001`](../docs/adr/0001-colima-not-docker-desktop.md))
- VPS / host split: [`docs/internal/ops/vps.md`](../docs/internal/ops/vps.md)
