# 🎯 JHT Threat Model

> Pre-launch draft. When the project goes public, this file (with minor edits) becomes `SECURITY.md` at the repo root.

**Inspired by:** [OpenClaw `SECURITY.md`](https://github.com/openclaw/openclaw/blob/main/SECURITY.md) — "personal assistant trust model" pattern.

---

## 1. What JHT is

JHT is a **local-first, single-user job-hunting team** made of three pieces:

- **The native application** (Godot, [`game/`](../../game/)) on the user's machine (Windows/macOS/Linux). It is the only control surface: it starts and stops the team, logs the user into the LLM provider through an embedded console, edits the profile and the configuration.
- **The runtime container** (Docker) hosting the agents in `tmux`, the SQLite database and the bridges. It **exposes no network port**: the app drives it through `docker exec` when it runs on the same machine, or over **SSH** when it runs on the user's own VPS.
- **The cloud dashboard** (Next.js on Vercel + Supabase), optional and opt-in. It is **read-only on the data**, plus an asynchronous request lane (tickets, feedback, per-position actions). It is shared by several users, whose rows are isolated per `user_id` by Supabase RLS.

Agents read local files (CV, profile) and perform outbound HTTP fetches (job listings); data reaches the cloud only if the user enables cloud-sync.

> **Changed on 2026-07-19 / 07-23.** Until then the desktop surface was an Electron launcher wrapping a Next.js dashboard served on `http://localhost:3000`. Both are gone: the `desktop/` tree was removed with the native migration, and the container stopped serving the web app (no `EXPOSE`, no published port). **A shipped install has no local HTTP surface at all.** The `local` deploy mode of `web/` survives for development (`npm run dev`), not in the product. Audit documents `01`, `02`, `03` and `06` in this folder predate that change and describe the old architecture — they are kept as history.

**JHT is NOT:**
- a multi-tenant SaaS platform for *running teams* — a team belongs to one user and runs on that user's machine or VPS (the cloud dashboard is multi-user, but it only mirrors data and queues requests)
- a service shared between different users
- a security wrapper for third-party data

---

## 2. Trust model

### Trusted operators

The following are considered **trusted** and have full operator access:
- whoever has physical/SSH access to the host operating system
- whoever can talk to the Docker daemon on the machine hosting the container — `docker exec` into `jht` **is** operator access, and it is exactly how the native app works
- whoever holds the SSH key paired with the user's VPS (`~/.jht/` keys, see [`ops/access-and-credentials.md`](../internal/ops/access-and-credentials.md))
- whoever can write to `~/.jht/` (config, credentials, agents)
- whoever can modify `~/Documents/Job Hunter Team/` (CV, attachments)

A **cloud-authenticated session** (Supabase login on jobhunterteam.ai) is *not* an operator: it can read that user's mirrored data and queue requests, and nothing else. Control actions are refused server-side on the cloud deployment.

### Untrusted

The following are considered **untrusted** and MUST NOT reach operator capability:
- websites opened in the user's browser (CSRF against the cloud dashboard session)
- every other authenticated user of the cloud deployment (RLS isolation per `user_id`)
- content fetched from the web (job listing HTML, email, attachments)
- AI model output (prompt injection)

### Single-user assumption

JHT assumes **one user per machine**. If you want to use JHT with multiple people:
- use a separate machine/VM/OS user for each person
- do not share the same container instance between users

---

## 3. In scope

The following vectors are treated as security bugs:

| Vector | Examples |
|---------|--------|
| **Auth bypass** | bypassing `requireAuth()` on sensitive routes without physical/SSH control of the host |
| **Write from the cloud plane** | any path that lets the cloud deployment perform a control or configuration write instead of queueing a request (`requireLocalWrite()` bypass, a cloud build that believes it is local) |
| **CSRF on the cloud dashboard** | a malicious site that uses the user's session to write on the request lane (feedback, tickets, position actions) |
| **Pairing/SSH credential exposure** | pairing token or VPS key readable by another local user; VPS host-key handling on the SSH path |
| **Command injection** | untrusted input (file content, API body, env config) that becomes shell execution |
| **Path traversal** | reading/writing files outside the expected directories |
| **SSRF** | fetch toward `127.0.0.1` / `metadata.google.internal` / RFC1918 from untrusted URLs |
| **Crypto weak** | decrypting credentials in `~/.jht/credentials/*.enc.json` without the passphrase |
| **Secret leak** | API key in log/stack trace/response body |
| **Cloud-sync IDOR** | a Supabase user who modifies/reads another user's data |
| **Prompt-injection with boundary bypass** | prompt injection that bypasses an explicit policy (e.g. "do not run shell") |

---

## 4. Out of scope

The following are **not security bugs** in JHT (inspired by OpenClaw):

### Operator-controlled surfaces
- The user (trusted operator) running `jht agent start` and the agent doing things in their own container — that's exactly what JHT does.
- Shell commands run by `--yolo` agents inside the container — that's their purpose.
- Files written to `~/.jht/` by a trusted agent — authorized.

### Container ≠ security boundary
- The `jht` user has `sudo NOPASSWD` inside the container. This is **by design**: agents need to install packages on the fly (`pdftotext`, `tesseract`, etc.). The container is a **convenience sandbox** isolated from the host, **not** a boundary between different agents on the same container.
- Container escape via kernel CVE: out of scope unless a JHT-specific bug is shown (not Docker).

### Prompt injection without boundary bypass
- "I made the agent say profanities" — not a bug.
- "I made the agent run `rm -rf` and the agent did it because it's in --yolo" — not a bug, that's the nature of --yolo.
- "I made the agent read `~/.jht/secrets.json` when the policy said 'no read of secrets' and it read it anyway" — security bug.

### Trusted plugin / skill
- Skills in the repo (`.skills-source/`, `agents/*/skills/`) are part of the trusted compute base. A skill doing privileged things is not a bug.

### Backwards compatibility / third-party supply chain
- CVEs in upstream dependencies that aren't exploitable through JHT specifically → reported upstream, not a JHT bug.

### Publicly exposed setups
- The container publishes **no port**, so there is nothing to expose by default. If someone re-adds a `ports:` mapping to their own compose file and puts the runtime on the internet, that is their configuration, not a JHT bug.
- Handing the VPS SSH key (or the pairing token) to a third party is operator delegation, not a vulnerability.

### The demo mode of the cloud dashboard
- Demo data is static and lives in the code; demo verdicts live in a cookie of that browser. "I altered the demo data I am shown" is not a bug — nothing of it reaches a database. A demo write that *does* reach the database **is** a bug (see *Write from the cloud plane*).

---

## 5. Deployment assumptions

JHT is designed and tested for:

✅ **Recommended setup:**
- One machine (laptop/desktop) per user, native app + container side by side, no published port
- Optional: cloud-sync to Supabase (authenticated), read-only dashboard in the browser

⚠️ **Advanced setups supported with documented caveats:**
- Personal VPS running the container headless, driven over SSH from the native app: requires the `JHT_CREDENTIALS_KEY` env var (no OS keyring on a server) — see [`VPS-SETUP.md`](../guides/VPS-SETUP.md)

❌ **Setups NOT supported:**
- Multiple users on the same container
- Re-publishing the container port on LAN/internet
- JHT as a multi-tenant service (one shared team for several people)

---

## 6. Reporting

To report a vulnerability:
1. **DO NOT** open a public issue.
2. Email `security@jobhunterteam.ai` with:
   - Descriptive title
   - Estimated severity (Critical/High/Medium/Low)
   - Path + function + lines of vulnerable code
   - JHT version/commit you tested on
   - Reproducible PoC
   - Demonstrated impact (what the bug enables)
   - Suggested fix

Reports lacking a reproducible PoC or that fail to demonstrate a boundary bypass may be closed as "no-action".

---

## 7. Crypto / data handling

### Encryption at-rest
- Primary module `shared/credentials/`: credentials (OpenAI/Anthropic API keys, Google OAuth) encrypted in `~/.jht/credentials/*.enc.json` with **AES-256-GCM** + **PBKDF2-SHA512 100k iterations**.
- Legacy module `cli/src/commands/secrets.js`: AES-256-CBC. Migration to GCM tracked as `[H5]` in [`05-checklist.md`](05-checklist.md).
- Random salt per installation, persisted in `~/.jht/credentials/.salt` with 0600 permissions.
- Master key derived from:
  - **Desktop GUI**: OS keyring via `jht keyring set/get/delete` CLI (macOS Keychain / Windows Credential Manager / Linux libsecret) — implemented in the H4 sprint
  - **Headless / container**: `JHT_CREDENTIALS_KEY` env var required
  - **OAuth storage (`tui/src/oauth/storage.ts`)**: PBKDF2 + random per-file salt (post-fix H4 iter 2)

### Data residency
- Default: **all local** (SQLite in `~/.jht/`).
- Optional cloud-sync: Supabase. Region selection and GDPR posture are documented for maintainers in the internal compliance notes (not in public docs).

### Outbound
- LLM API: requests to `api.anthropic.com`, `api.openai.com`, `api.moonshot.cn` authenticated with the user's API key.
- Cloud-sync: Supabase URL configured by the user.
- Job scout: fetch toward job-board sites (LinkedIn, Greenhouse, Lever, etc.) — SSRF policy applied.

### Telemetry
- No automatic telemetry.
- Crash reporter: **opt-in** (TODO).

---

## 8. Update / patch policy

- Security patches: shipped as a patch version (`X.Y.Z+1`) within 7 days of discovery for Critical, 30 days for High.
- Announcements via GitHub Security Advisory + entry in CHANGELOG.md.
- **Release signing**: the macOS build is signed with a Developer ID certificate and notarized by Apple on every tag (CI fails without the credentials). Windows and Linux artifacts are unsigned.
- **Auto-update: not implemented** — updates are a manual download from the GitHub Release. Tracked in [`BACKLOG.md`](../../BACKLOG.md) under the native application section.

---

## 9. Things we deliberately DON'T do

To avoid false expectations:

- ❌ **No bug bounty** (open-source project, no budget)
- ❌ **No enterprise SLA** (use at your own risk)
- ❌ **No 100% prompt-injection-proof guarantee** (active research)
- ❌ **No container-escape guarantee** (Docker/OS responsibility)
- ❌ **No signed Windows/Linux binaries** (macOS is signed and notarized; the other two are not)
- ❌ **No auto-update channel** (updates are manual downloads)

---

## 10. Versioning

**Threat model version:** 0.2
**Last updated:** 2026-07-25 — realigned to the post-migration surface (native Godot app, no local HTTP server, control via `docker exec`/SSH, multi-user cloud dashboard with RLS).
**Previous version:** 0.1 (2026-04-27, Electron + `localhost:3000`) — see the git history of this file.
**Next review:** at the first public release.
**Current hardening status:** see [`05-checklist.md`](05-checklist.md) — Phase 1 (blockers) tracked at 9/9 before the `v0.1.0` tag.
