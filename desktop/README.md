# JHT Desktop (Tauri 2)

The active desktop shell. It is a static React application inside a minimal
Tauri 2 host and does not replace or modify [`game/`](../game/).

The current slice implements two screens:

1. welcome;
2. the fixed `own PC + Podman + own OpenAI API key + headless agents` setup.

The key is intentionally kept only in React memory and cleared on confirmation.
Native credential persistence and Podman provisioning are follow-up slices.

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
