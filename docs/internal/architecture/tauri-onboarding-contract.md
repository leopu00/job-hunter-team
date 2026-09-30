# Tauri 0.4 onboarding: door-to-door contract

**Status:** implemented contract for the Tauri release path (2026-09-30)

## Released path

After Google login, the main window evaluates one account-scoped gate. A new
account cannot mount the dashboard until this sequence has been verified:

```text
Google session
  -> candidate profile written and independently re-read
  -> execution host selected (this Mac or validated VPS)
  -> subscription provider selected (Claude, Codex or Kimi)
  -> production runtime installed and container responding
  -> provider subscription login completed and credential marker re-read
  -> Capitano and Assistente reported running
  -> Assistente onboarding completed (profile ready + welcomed marker)
  -> direct local/VPS chat connected and reported ready
  -> account-scoped subscription-v1 marker written and re-read
  -> dashboard
```

Any missing fact stops the transition. The API-key `api-worker` experiment is
not a release route: `index.html` contains Google login only,
`start_api_team` is not registered, there is no “Team locale” link, and
`api-worker` is not bundled as a Tauri resource.

Accounts that predate the desktop marker are admitted when both their current
profile satisfies the product minimum and `first_team_run_at` exists. A profile
or `profile_configured_at` alone resumes onboarding at host selection.

## Ports and ownership

| Port | Contract |
| --- | --- |
| Authentication | `lib/supabase.ts` produces the saved user session. No service-role credential enters the desktop. |
| Detection/persistence | `lib/onboarding.ts` reads RLS-protected account evidence, validates and upserts `candidate_profiles`, then re-reads exact fields. |
| UI | `onboarding/OnboardingFlow.tsx` receives account, optional draft, runtime state, `onSubmit`, `onRuntimeAction` and `onRetry`; it owns no IPC or persistence. |
| Native runtime | `src-tauri/src/onboarding.rs` exposes typed prepare, snapshot, provider-login, input/close, team-start and Assistant commands. |
| Direct chat | `lib/direct-chat.ts` and `src-tauri/src/direct_chat.rs` connect the selected host; readiness is part of the final onboarding snapshot. |
| Routing | `dashboard/DashboardApp.tsx` is the sole orchestrator. It mounts `Shell` only after durable evidence or the complete verified flow. |

The runtime discriminant is `status`:

- `collecting`: `profile`, `host`, `provider`
- `working`: `runtime`, `provider-login`, `team-start`, `assistant`
- `action-required`: `provider-login`, `assistant`
- `failed`: any stage, with retry
- `ready`: every final fact is true

## Reused production backend

The native bridge orchestrates existing production interfaces instead of
copying Electron:

- `scripts/install.sh` and `scripts/host-setup.sh` install the runtime;
- `jht up` starts the container;
- `jht providers use/update <allowlisted provider>` configures a subscription;
- `jht oauth-login` performs provider authentication;
- `jht team start` and `jht team start assistente` start the real agents;
- `jht status`, `jht team status`, strict profile validation and credential/
  welcome markers supply independently re-read facts.

For VPS provisioning, the current one-shot pairing-token format is reused:
base64 JSON containing Supabase URL, user id, refresh token and issue time. The
token travels only through typed IPC and process stdin, is zeroized natively,
and is never logged. The installer/container deletes its one-shot copy after
pairing.

## Native security and failure semantics

- Host, user, port and absolute key path are validated before process launch.
- VPS host keys are acquired once into an app-private known-hosts file; every
  later SSH command uses `StrictHostKeyChecking=yes` against that pin.
- User values are process arguments or stdin, never concatenated into a shell
  command. Remote command strings are fixed constants and providers are an enum.
- Commands have timeouts; stdout is bounded and sensitive stderr is drained but
  not returned. Interactive output is redacted before reaching the UI.
- Provider input and pairing tokens are zeroized; no API key or service-role
  credential is accepted.
- A successful process exit is insufficient: snapshots re-check runtime,
  container, provider, agents, profile and Assistant. The dashboard transition
  additionally requires a `ready` result from the direct-chat connection.

The direct VPS chat follows the authoritative current Godot transport:
`chat.jsonl` persistence via stdin, bounded history tail, and verified
`jht-tmux-send` delivery with retry only for exit code 4. It does not use
Supabase or another cloud API as the message transport.

## Deliberate exclusions

Binary CV upload remains excluded until a separate audited Tauri file
transport exists. The legacy Electron implementation and its history were used
only as behavioural evidence; no legacy commit or shell/paste transport is
copied into this path.
