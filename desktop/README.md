# JHT Desktop (Tauri 2)

The active desktop shell. It is a static React application inside a minimal
Tauri 2 host and does not replace or modify [`game/`](../game/).

The current slice implements two screens:

1. welcome;
2. the fixed `own PC + Podman + own OpenAI API key + headless agents` setup.

The setup screen asks the Tauri backend to verify that the Podman CLI is
installed and that its engine is reachable. Submitting an OpenAI API key starts
a one-shot full-team test against the checked-in synthetic candidate and job
fixtures. The first run builds the bundled `api-worker` image; following runs
reuse Podman's build cache. The team is capped at two CPUs, 1 GB RAM and a
configured maximum provider cost of USD 0.10.

The key is cleared from the React state on submit, passed to Podman over stdin
as a temporary secret, zeroized in Rust and removed after the run. It is never
written to app configuration, a command-line argument or an image layer.

Completed runs persist their isolated SQLite database and generated artifacts
under the application's local data directory.

## Development

```powershell
npm install
npm test
npm run build
npm run tauri:dev
```

The archived Electron reference lives in
[`archive/electron-desktop/`](../archive/electron-desktop/) and is not a
dependency of this package.
