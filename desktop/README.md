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
  `http://127.0.0.1:54917/auth/callback`, which must be in the project's
  allowed redirect URLs. Loopback rather than a deep link because a custom
  scheme only exists for the installed app on macOS, and sign-in has to work
  from `tauri dev` too.
- **Storage.** The session and the PKCE verifier are not kept in the
  webview's localStorage: they are encrypted (ChaCha20-Poly1305) in the app's
  local data dir, with the 32-byte key in the OS keychain (macOS Keychain,
  Windows Credential Manager, Linux kernel keyring). A file that no longer
  decrypts counts as signed out.
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
