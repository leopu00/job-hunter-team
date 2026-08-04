# Recording profiles

The release videos use normal authenticated accounts populated with synthetic,
deterministic data. They do **not** use the public demo mode: no
`jht_demo_persona` cookie is written, so the protected layout never mounts the
demo banner.

Every reset also pins the recording UI to the **light** theme. It writes
`theme: "light"` for the local/game workspace and `jht-theme=light` into the
two exact browser origins: `https://jobhunterteam.ai` and
`http://localhost:3008`. The result does not depend on the recorder's
operating-system theme.

Four aliases cover different candidates and job markets:

| Alias | Candidate focus | Seed |
| --- | --- | --- |
| `software` | product/software engineering | 56 positions |
| `marketing` | growth, content and CRM | 56 positions |
| `finance` | FP&A, banking and investments | 56 positions |
| `design` | product, UX and design systems | 56 positions |

All content is fictional. The materialized rows deliberately omit account
email, candidate contacts, external job URLs and company websites. Auth
credentials, browser state and SQLite databases stay outside the repository.

## Reset in one command

From the repository root:

```bash
npm run recording-profile -- reset --all
```

Every cloud reset needs `SUPABASE_SERVICE_ROLE_KEY` in the process environment.
The key is required to recreate agent-authored chat turns and close onboarding;
RLS intentionally prevents a user session from impersonating an agent. The
command never stores that key and never prints an email, user id, token or
filesystem path. Account credentials remain in local 0600 files.

Before deleting anything, the reset checks the authenticated account metadata
for both `purpose=recording-profile` and the requested alias. A stale or
misplaced credential file therefore fails closed instead of touching another
account. Existing contact rows are removed on every reset; no email, phone,
social profile or website is copied from the source personas.

For a single scene, replace `--all` with `software`, `marketing`, `finance` or
`design`. To recreate only the game/local workspaces without touching cloud
state:

```bash
npm run recording-profile -- reset --all --local-only
```

The fixed anchor in `web/lib/recording-profile.ts` makes two resets identical:
IDs, timestamps, scores, pipeline distribution and profile content do not
drift between takes.

Transient `checked` and `writing` rows are materialized in the stable state
that the production boot recovery would choose (`new` and `scored`). All
`write_requested` flags are off. This keeps the visible pipeline varied while
making the first `pid1` boot a no-op instead of rewriting stale synthetic rows.

## Local artifacts (never commit)

The command uses the platform's XDG roots:

```text
$XDG_CONFIG_HOME/jht/recording-profiles/<alias>.env
$XDG_DATA_HOME/jht/recording-profiles/<alias>/
  auth-state.json
  jobs.db
  compose.recording.yml
  agents/{assistente,mentor,capitano}/chat.jsonl
  profile/candidate_profile.yml
  profile/ready.flag
  user/{applications,allegati,critiche,cv,output}/
```

When XDG variables are unset, the standard `~/.config` and `~/.local/share`
locations are used. Credential and auth-state files are mode 0600. A successful
reset keeps the previous local workspace beside the current one with suffix
`.previous`, so a failed take never destroys the last usable profile.

## Web recording

Select a profile by alias and pass its private `auth-state.json` to Playwright.
Start every context from that file instead of reusing a browser profile that
might still contain a demo cookie. Example shape:

```ts
const context = await browser.newContext({
  storageState: process.env.JHT_RECORDING_AUTH_STATE,
});
```

### Exact origin and route

The local recording origin is **exactly** `http://localhost:3008`. Start at
`http://localhost:3008/`, or use
`http://localhost:3008/?login=true` to enter the login flow. Once a valid
authentication callback establishes the matching auth state, its default
continuation is `/dashboard`; that is the protected page used for the first
authenticated recording frame.

`http://localhost:3008` is an origin-specific recording/development exception,
not a reintroduction of the shipped local dashboard. The product's
`localhost:3000` dashboard was retired on 2026-07-23. The recording profile
introduced `:3008` separately on 2026-08-04 (`f577a1278`), and the storage
state plus pre-take gate were then fixed to that exact origin (`9d106b676`).
Do not substitute `:3005`: that port was only an earlier, ad-hoc `dev2` Next
development reference for a simulation, never a user-facing dashboard.

The generated state contains the Supabase session plus `jht-tour-done=1` and
`jht-theme=light` in localStorage. It contains no `jht_demo_persona`, so
dashboard, positions, map, swipe and profile all use real Supabase queries,
render in light mode and show neither the demo banner nor its `CONNECT YOUR
TEAM` / `EXIT DEMO` actions.

The automated pre-take gate also calls `DELETE /api/demo` and reloads the
dashboard before accepting the first recordable frame. This clears a stale
demo cookie even if someone accidentally reused an existing browser context;
the gate then checks the API state and the context cookie jar before checking
the rendered dashboard and messages.

## Game recording

Each alias directory is a complete `JHT_HOME`, but setting that variable in a
shell is not enough: the production Compose file normally mounts the host's
`~/.jht` at `/jht_home`. Use the generated override so the container and the
game resolve the **same** recording directory:

```bash
PROFILE_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/jht/recording-profiles/software"
docker compose -p rel004 -f "$HOME/.jht/runtime/docker-compose.yml" -f "$PROFILE_ROOT/compose.recording.yml" up -d --force-recreate
JHT_HOME="$PROFILE_ROOT" /path/to/job-hunter-team-game
```

The override binds both `/jht_home` and `/jht_user` below the synthetic
profile, forces `JHT_HOST_TYPE=local` and `restart: "no"`, and blanks
cloud/provider environment values inherited from the host. It therefore
cannot mount the real user directory, reuse pairing or provider auth, or
restart alongside the normal team. Keep the `-p rel004` project name in every
Compose command. `LocalBackend` addresses the fixed container name `jht`; if a
normal `jht` already exists, Compose fails on the name collision instead of
reusing it. Do not stop that container as part of the recording workflow.

The `JHT_HOME` on the game process is required too: `LocalBackend` reads
command output from that host directory while the container writes the same
files through `/jht_home`. The SQLite database contains the
same positions, scores, applications, highlights and six chat turns as the
cloud account. The three matching `chat.jsonl` files make the Assistente,
Mentor and Capitano threads immediately visible in the game; the profile YAML
is already marked ready. Do not run the game without that real
local backend: the disconnected showroom is intentionally labelled as a
simulation and is not suitable for release footage.

## Verification

```bash
npm run recording-profile -- verify --all
```

This checks SQLite integrity, expected row counts (including chat), cloud row
content, required runtime artifacts, cloud profile/onboarding/contact state and
that the stored browser state has no demo cookie and pins `jht-theme=light` for
both supported origins. It also resolves the installed base Compose plus the
generated override (without starting Docker) and rejects any `/jht_home` or
`/jht_user` source outside the synthetic profile, a non-local host type, a
restart policy, inherited cloud/provider values or a container name that the
game cannot address. `verify` never creates an account: missing local
credentials are an error. The release gate additionally opens the protected
dashboard and messages with the generated state, verifies the rendered
`data-theme=light`, and rejects the exact demo copy and the `CONNECT YOUR TEAM`
/ `EXIT DEMO` actions.
