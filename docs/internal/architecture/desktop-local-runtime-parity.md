# Desktop local runtime: Electron to Tauri parity

This note records the local path restored after the
`local_account_owner_missing` regression on candidate `73dbd6c11`. It is a
behavioral comparison: Tauri reuses the current attested installer and host
wrapper instead of copying Electron's retired Docker/Colima implementation.

| Step | Electron legacy | Tauri backend |
| --- | --- | --- |
| Local identity | Google login could be skipped; the OS user's `~/.jht` was used directly. | `runtime_local_profile_create` creates a backend-owned opaque local profile. Only that kind of scope may make the one-time legacy claim. A Google scope cannot claim it. |
| Existing local data | `container.js`, `provider-install.js`, and `main.js` bind and update `~/.jht` without an owner marker. | A recognizable Electron/installer `~/.jht` is preserved and receives `.desktop-account-scope` with create-new semantics. From that point every local call must match the exact digest; another local profile is denied. Arbitrary populated directories are not adopted. |
| Runtime | `docker-installer/install.js` installed or started Colima/Docker and verified that the daemon answered. | `onboarding::install_local` executes the SHA-256-attested `scripts/install.sh --runtime podman`, then starts or initializes the named Podman machine and verifies `podman info`. |
| Container | `container-prep.js` prepared the image; `runtime.js` started the container and checked readiness. | The authoritative `jht` wrapper runs `up`; Tauri then polls `jht status` and refuses to advance until the container is actually ready. |
| Provider | `provider-install.js` installed the selected subscription CLI into the bind mount and `main.js` synchronized `jht.config.json`. | Tauri runs `jht providers use <id>` and `jht providers update <id>` through the owner-checked wrapper. Provider login remains a separate interactive command so no paid API key is introduced. |
| Team | `startTeamRuntime` started the runtime and then the team, with later probes of the running sessions. | `onboarding_team_start` (or the no-argument resume command) runs `jht team start`, then verifies both Assistente and Capitano before reporting success. |

The migration is intentionally one-way and non-destructive. It does not move,
delete, or globally fall back to Electron data. A missing marker is accepted
only when the active scope is a backend-generated local profile and the home
contains a durable JHT artifact. The newly written marker becomes mandatory
for all subsequent runtime, provider, team, snapshot, and chat operations.
