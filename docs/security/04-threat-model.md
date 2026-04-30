# 🎯 JHT Threat Model

> Pre-launch draft. When the project goes public, this file (with minor edits) becomes `SECURITY.md` at the repo root.

**Inspired by:** [OpenClaw `SECURITY.md`](https://github.com/openclaw/openclaw/blob/main/SECURITY.md) — "personal assistant trust model" pattern.

---

## 1. What JHT is

JHT is a **local-first desktop app for a single user** that:
- runs on the user's machine (Windows/macOS/Linux), via Electron + Docker container
- exposes a web dashboard at `http://localhost:3000`
- orchestrates AI agents (Claude/Codex/Kimi) inside `tmux` within the container
- reads local files (CV, profile) and performs outbound HTTP fetches (job listings)
- optionally syncs data to Supabase via cloud-sync

**JHT is NOT:**
- a multi-tenant SaaS platform
- a service shared between different users
- a security wrapper for third-party data

---

## 2. Trust model

### Trusted operators

The following are considered **trusted** and have full operator access:
- whoever has physical/SSH access to the host operating system
- whoever can write to `~/.jht/` (config, credentials, agents)
- whoever can modify `~/Documents/Job Hunter Team/` (CV, attachments)
- whoever is authenticated on the dashboard `http://localhost:3000` via local-token (`jht_local_token` HttpOnly+SameSite=Strict cookie, set by the middleware only on direct localhost requests with no `x-forwarded-*` headers) or Supabase login

### Untrusted

The following are considered **untrusted** and MUST NOT reach operator capability:
- websites opened in the user's browser (CSRF / DNS rebinding)
- other users on the same LAN (if the dashboard is exposed on the network)
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
| **CSRF / DNS rebinding** | a malicious site that triggers side-effects on `localhost:3000` (e.g. start agent, read secret) |
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
- Exposing `localhost:3000` to the internet without Supabase auth is **not recommended and not supported**. Bug only if the recommended setup (loopback only) is bypassable.

---

## 5. Deployment assumptions

JHT is designed and tested for:

✅ **Recommended setup:**
- One machine (laptop/desktop) per user
- Docker container on loopback `127.0.0.1:3000`
- Optional: cloud-sync to Supabase (authenticated)

⚠️ **Advanced setups supported with documented caveats:**
- Personal VPS for headless JHT: requires `JHT_CREDENTIALS_KEY` env var, no keyring
- Public tunnel (ngrok/Cloudflare) to JHT: **requires Supabase auth on** (no localhost bypass)

❌ **Setups NOT supported:**
- Multiple users on the same container
- Dashboard exposed on LAN/internet without auth
- JHT as a multi-tenant service

---

## 6. Reporting

To report a vulnerability:
1. **DO NOT** open a public issue.
2. Email `leopu00@gmail.com` (interim, until `security@jobhunterteam.ai` is set up) with:
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
- LLM API: requests to `api.anthropic.com`, `api.openai.com`, `api.minimax.chat` authenticated with the user's API key.
- Cloud-sync: Supabase URL configured by the user.
- Job scout: fetch toward job-board sites (LinkedIn, Greenhouse, Lever, etc.) — SSRF policy applied.

### Telemetry
- No automatic telemetry.
- Crash reporter: **opt-in** (TODO).

---

## 8. Update / patch policy

- Security patches: shipped as a patch version (`X.Y.Z+1`) within 7 days of discovery for Critical, 30 days for High.
- Announcements via GitHub Security Advisory + entry in CHANGELOG.md.
- Electron auto-update: signed updates via Sparkle (TODO).

---

## 9. Things we deliberately DON'T do

To avoid false expectations:

- ❌ **No bug bounty** (open-source project, no budget)
- ❌ **No enterprise SLA** (use at your own risk)
- ❌ **No 100% prompt-injection-proof guarantee** (active research)
- ❌ **No container-escape guarantee** (Docker/OS responsibility)
- ❌ **No signed binary releases** (post-MVP)

---

## 10. Versioning

**Threat model version:** 0.1 (draft)
**Last updated:** 2026-04-27
**Next review:** at the first public release.
**Current hardening status:** see [`05-checklist.md`](05-checklist.md) — Phase 1 (blockers) tracked at 9/9 before the `v0.1.0` tag.
