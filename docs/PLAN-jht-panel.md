# PLAN — JHT Panel (archived)

**Original date:** 2026-03-15
**Status:** ⚠️ Superseded by the new product direction

---

## 📌 Note

This document described a plan for a **native Rust + egui desktop app** talking directly to `tmux`.

The current project direction is different:

- 🧭 the desktop app becomes a **launcher/orchestrator**
- 🌐 the main GUI stays the existing **web dashboard**
- 🚀 the launcher installs and starts JHT in the background
- 🔗 when the local runtime is ready, it opens the browser at `http://localhost:3000`

---

## ✅ New direction

The active plan now lives in:

- [`README.md`](../README.md)
- [`BACKLOG.md`](../BACKLOG.md)
- [`docs/ROADMAP.md`](./ROADMAP.md)

In short:

- 📦 desktop installer (`.dmg`, `.exe`, `.AppImage`, `.deb`)
- 🛠️ silent bootstrap of the local runtime
- 🧠 AI provider is user's choice; `Claude CLI` only when actually required
- 🌍 no terminal for the end user
- 🖥️ main experience in the local browser, not in a rewritten desktop UI

---

## 🗃️ Why it's archived

- Avoids duplicating the UI already present in `web/`
- Drastically reduces the code to maintain
- Gets us to actually useful desktop packages (`.dmg`, `.exe`, `.AppImage`, `.deb`) much sooner
- Keeps the web dashboard as the single source of truth for UX
