# Recording profiles

The release videos use normal authenticated accounts populated with synthetic,
deterministic data. They do **not** use the public demo mode: no
`jht_demo_persona` cookie is written, so the protected layout never mounts the
demo banner.

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

The generated state contains the Supabase session plus `jht-tour-done=1` in
localStorage. It contains no `jht_demo_persona`, so dashboard, positions, map,
swipe and profile all use real Supabase queries and render without the banner.

## Game recording

Each alias directory is a complete `JHT_HOME`, but setting that variable in a
shell is not enough: the production Compose file normally mounts the host's
`~/.jht` at `/jht_home`. Use the generated override so the container and the
game resolve the **same** recording directory:

```bash
PROFILE_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/jht/recording-profiles/software"
docker compose -f "$HOME/.jht/runtime/docker-compose.yml" -f "$PROFILE_ROOT/compose.recording.yml" up -d --force-recreate
JHT_HOME="$PROFILE_ROOT" /path/to/job-hunter-team-game
```

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
that the stored browser state has no demo cookie. `verify` never creates an
account: missing local credentials are an error. The release gate
additionally opens the protected dashboard with the generated state and checks
that no visible text contains the demo banner label.
