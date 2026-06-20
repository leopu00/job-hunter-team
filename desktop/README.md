# 🖥️ desktop — JHT Desktop launcher (Electron)

Desktop launcher for Job Hunter Team. It installs dependencies, prepares the
Docker container, handles provider auth, and starts the team — so non-technical
users never touch a terminal. **Interaction itself happens in the browser /
Telegram / CLI** — the launcher only bootstraps and supervises.

- **Package:** `jht-desktop` · **Stack:** Electron · electron-builder

## Layout

```
main.js              Electron main process
preload.js           preload bridge
container*.js         Docker container prep & lifecycle
deps*.js / dependencies.js   dependency install (in-app, no CLI)
disk-space.js        preflight checks
provider-*.js        provider auth / install / store
docker-installer/    bundled Docker setup (Colima on macOS)
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

- Container policy (Colima, not Docker Desktop): [`docs/adr/0001-colima-not-docker-desktop.md`](../docs/adr/0001-colima-not-docker-desktop.md)
- VPS / host split: [`docs/internal/ops/vps.md`](../docs/internal/ops/vps.md)
