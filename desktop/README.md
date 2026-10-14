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

## Sign-in

The control panel signs in to the same Supabase project as the web, with
the user's own session (anon key + JWT, RLS): no service_role key ever ships
in the app. `src/lib/supabase.ts` exports the signed-in client (`supabase`),
`useSession()` and `signOut()`; `src/components/login-screen.tsx` is the
"Accedi con Google" screen.

- **Build env.** Copy `.env.example` to `.env.local` and fill in
  `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Without them the app still
  starts and the login screen says the build is not configured.
- **Flow.** Google refuses embedded webviews, so the authorize page opens in
  the system browser (PKCE). The return lands on a one-shot loopback listener,
  `http://127.0.0.1:54917/auth/callback?sb_flow_id=<flow>`. The project's
  allowed redirect URLs must include
  `http://127.0.0.1:54917/auth/callback?sb_flow_id=*`: the per-request flow id
  binds the callback to its own PKCE verifier. Loopback rather than a deep link
  because a custom scheme only exists for the installed app on macOS, and
  sign-in has to work from `tauri dev` too.
- **Browser choice.** The login screen lists the browsers found installed
  (macOS: the `.app` bundles in `/Applications` and `~/Applications`;
  Windows: the usual install folders; Linux: `PATH`), plus the system default
  and "copy the link" for any other browser. The last choice is remembered in
  localStorage (a preference, not a secret). The frontend sends only the id:
  the backend resolves it again and launches the browser with separate
  arguments, never through a shell.
- **Storage.** The session and the PKCE verifier are not kept in the
  webview's localStorage: they are encrypted (ChaCha20-Poly1305) in the app's
  local data dir, with the 32-byte key in the OS keychain (macOS Keychain,
  Windows Credential Manager, Linux kernel keyring). A file that no longer
  decrypts counts as signed out. Startup and navigation never touch the OS
  credential store: only an explicit "Accedi con Google" action can read or
  create the key, at most once per process, and the key then stays in memory.
  A refusal is terminal until the app is fully restarted.
- **Sign-out** revokes this app's session only (`scope: "local"`): the web and
  other devices stay signed in.
- The CSP allows `https://*.supabase.co` and `wss://*.supabase.co`; a project
  on a custom domain needs its host added there.

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

## Existing team: starting the assistant

The read-only view of an existing VPS team (Dashboard, Positions, Team, Profile) reads and
changes nothing. One action in the Team page changes the team, on the person's explicit,
confirmed request only: **Start assistant**.

What it does, on the verified target of the account (the team, container, image, platform and
digest it was connected with; there is no fallback to another container):

1. probes the team's readiness, with the team identity check; an assistant already running ends
   here and no start command is sent;
2. runs `/app/.launcher/start-agent.sh assistente` once in that container (the script the CLI's
   `jht team start assistente` runs; idempotent: a lock per session and an exact `tmux has-session`);
3. probes the readiness again, up to 20 times 3 seconds apart. Only a probe that sees the
   assistant promotes the result (`started`); running out of tries is `assistant_verify_timeout`
   and a failing probe ends with its own code. A timeout or an error enables nothing and reuses no
   earlier snapshot.

It never runs at connect, refresh, retry or when a page opens, and a second click (or a second
window) while one start runs is refused. The confirmation states its cost first: the script opens
the team's provider with the team's account and injects the one-shot `[WELCOME-USER]` message,
which spends tokens of that subscription and puts the assistant to work. It does not change
provider and does not touch the captain or the other sessions.

There is no **Stop** here, on purpose: stopping is not a guaranteed rollback. To undo a start:

- *What no stop undoes*: the tokens spent, the `profile/welcomed.flag` the assistant writes after
  the welcome, and the logs the start script and its welcome watchdog write.
- *Controlled target* (no watchdog, no autostart, like the controlled run the team was connected
  to): the session stays until someone ends it. With access to the VPS, end the tmux session
  `ASSISTENTE` in the pinned container (`jht team stop assistente` there does the same); nothing
  restarts it. The next probe reads `assistantRunning=0`.
- *Supervised target* (a watchdog is running): the watchdog restarts a stopped assistant, in about
  30 seconds. Stopping the one agent does not stick; the team's persistent stop (`jht team stop`
  with no agent creates `/jht_home/.team-halted.flag`) is a decision about the whole team, and
  keeps the assistant alive by design. Turning the assistant off on such a target is therefore a
  team-level decision of whoever runs it, not something this view does.

