# 0011 — Use Tauri 2 with React for the desktop shell

**Status:** Accepted  
**Date:** 2026-08-24  
**Complements:** [ADR-0009](./0009-team-exposes-one-loopback-api.md) — the team exposes one loopback API

## Context

The shipped desktop application is the Godot office. It currently owns the
professional UI, onboarding, process lifecycle, SSH transport and the 2.5D
office in one codebase. That made the Electron-to-Godot migration shippable,
but it also duplicated product and transport logic that belongs behind the
versioned API described by ADR-0009.

The former Electron application is recoverable from Git history. It contains
useful product research and implementations, but restoring it wholesale would
also restore an obsolete architecture and a second copy of product code.

The target agent runtime is moving toward API-backed Node.js/TypeScript workers.
The existing Python/tmux runtime remains production code during that migration;
it is not a reason to make Python the desktop architecture.

## Decision

1. **The new desktop shell uses Tauri 2.** Windows, macOS and Linux remain the
   supported targets.
2. **The renderer is a static React SPA.** It shares components, domain models
   and typed API clients with the web product where useful, but it does not
   embed the Next.js server or turn the container back into a dashboard host.
3. **Rust stays at the operating-system boundary:** windows, tray,
   notifications, file pickers, secure storage, updater and child-process
   lifecycle. Product rules, agent orchestration and data access stay behind
   versioned Node.js/TypeScript APIs.
4. **Godot remains the supported application during migration.** After parity,
   the 2.5D office may remain as an optional surface; it is no longer the target
   container for settings, transport and every professional view.
5. **Electron is a reference and a fallback, not the target.** We may port
   individual flows from Git history after reviewing and testing them. We do
   not restore the deleted tree as the production application.
6. **The decision has a measured escape hatch.** Electron may replace Tauri
   only if the Windows-first spike fails a mandatory capability gate and the
   failure cannot be solved without moving product logic into Rust or adding
   unacceptable operational risk.

## Consequences

- Desktop and web can share React code without sharing deployment assumptions.
- The desktop package does not bundle Chromium and Node.js merely to render the
  UI; it uses the operating-system webview and talks to explicit services.
- Windows needs WebView2 and the Rust/C++ build prerequisites. Webview variance
  and native plugin permissions become test obligations.
- Tauri's updater requires signed update artifacts. Signing, key custody and
  rollback are release gates, not later polish.
- A static SPA cannot depend on Next.js server-side rendering. Server-only web
  modules must stay behind an API or receive a browser-safe implementation.
- Godot cannot be removed until the agreed parity slice works on all three
  operating systems and the release path is proven.

## Alternatives considered

- **Build a new Electron application.** Fastest route for a Node-heavy team and
  the fallback if Tauri fails a measured gate, but it bundles a larger runtime
  and makes it easier to blur the process/API boundary again.
- **Restore the deleted Electron application.** Useful as source material, but
  its architecture and dependencies predate the Godot migration and the new API
  boundary.
- **Keep expanding Godot as the all-in-one application.** Preserves the shipped
  product but continues the React/GDScript split and keeps transport, setup and
  professional UI coupled to the office renderer.
- **PWA plus a local daemon.** Good for shared UI, weaker for first-run process
  ownership, tray, secure storage, updates and local/VPS lifecycle.
- **Flutter.** A capable desktop toolkit, but introduces Dart and does not reuse
  the existing React/TypeScript product surface.

## References

- [Tauri architecture](https://v2.tauri.app/concept/architecture/)
- [Tauri frontend configuration](https://v2.tauri.app/start/frontend/)
- [Tauri updater](https://v2.tauri.app/plugin/updater/)
- [Desktop migration roadmap](../internal/roadmap/2026-08-24-desktop-tauri-migration.md)

