# Native application roadmap

The Electron-to-Godot migration, live data views, embedded console and
choice-driven first-run are baseline features, not future work.

## Current hardening priorities

1. Cross-platform first-install E2E on clean macOS, Windows and Linux machines.
2. Accessibility: keyboard traversal, screen-reader labels and scalable text.
3. Signing, notarization and upgrade/recovery polish for release artifacts.
4. More localized authored onboarding copy beyond the Italian/English source
   set (other locales currently use the Italian fallback for new dialogue).
5. Stronger failure injection for offline Docker, interrupted SSH, expired
   provider sessions and Telegram/email network failures.

## Product expansion

- Rich Mentor review surfaces tied to real weekly outcomes.
- Interview-practice missions linked to a selected position.
- User feedback cards that teach ranking preferences.
- Additional office rooms only when they expose useful workflow, never as
  decoration disconnected from real data.

## Explicit non-goals

- Reintroducing Electron or external terminal windows.
- Multiplayer or a purely decorative virtual office.
- Automatic mass application by default.
- Hiding technical failures behind fictional game state.
