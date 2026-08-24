# Godot office roadmap

The Electron-to-Godot migration, live data views, embedded console and
choice-driven first run are shipped features. Godot remains the supported
desktop application while the new [Tauri 2 + React shell](../../docs/adr/0011-tauri-desktop-shell.md)
is built in vertical slices.

Godot's target role is the **optional 2.5D office**, not the permanent owner of
settings, transport, setup and every professional view. The migration plan is
tracked in
[`2026-08-24-desktop-tauri-migration.md`](../../docs/internal/roadmap/2026-08-24-desktop-tauri-migration.md).

## Priorities during the transition

1. Keep the current release safe: cross-platform first-install coverage,
   recovery and fixes for production regressions continue.
2. Define parity per vertical slice before removing its Godot implementation.
3. Move data, lifecycle and interaction behind the versioned product API; do
   not create another private transport for Tauri.
4. Isolate the office renderer from setup, SSH, persistence and professional UI
   so it can be launched as an optional component.
5. Preserve useful office-only experiences: agents-as-characters, spatial state
   and rooms that expose real workflow.

## Product expansion owned by the office

- Spatial views that make agent activity and hand-offs easier to understand.
- Additional rooms only when they expose useful workflow, never as decoration
  disconnected from real data.
- An explicit launch/IPC contract with the Tauri shell, selected only after the
  shell spike proves the native lifecycle.

Mentor review, interview practice, feedback and general settings belong to the
shared React/product layer unless a spatial office treatment adds distinct
value.

## Explicit non-goals

- Restoring Electron as the primary application. Its Git history may be mined
  selectively for reviewed flows.
- Deleting Godot before the replacement slice passes the parity and release
  gates.
- Multiplayer or a purely decorative virtual office.
- Automatic mass application by default.
- Hiding technical failures behind fictional game state.
