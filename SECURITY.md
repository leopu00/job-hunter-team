# Security Policy

JHT (Job Hunter Team) is a **local-first, single-user system** with a native Godot desktop app and a CLI. It runs on your own machine, orchestrates AI agents in a Docker container, and reads/writes only files you control. The full threat model lives in [`docs/security/04-threat-model.md`](docs/security/04-threat-model.md) — this file is the short, public-facing version.

## Reporting a vulnerability

**Do not open a public issue for security bugs.**

Email **`security@jobhunterteam.ai`** with:

- Descriptive title and estimated severity (Critical / High / Medium / Low)
- Path + function + line numbers of the vulnerable code
- JHT version or commit SHA you tested on
- Reproducible PoC
- Demonstrated impact — what the bug actually enables
- Suggested fix, if you have one

Reports without a reproducible PoC, or that don't demonstrate a **trust-boundary bypass** (see scope below), may be closed as `no-action`.

### Response targets

- **Critical:** patch shipped as `X.Y.Z+1` within **7 days** of triage
- **High:** patch within **30 days**
- **Medium / Low:** rolled into the next regular release
- Public disclosure via GitHub Security Advisory + `CHANGELOG.md` entry once a fix is available

## Trust model (one paragraph)

JHT assumes **one user per machine**. Anyone with physical or SSH access to
the host, or who can write to `~/.jht/` and
`~/Documents/Job Hunter Team/`, is a **trusted operator** with full capability.
Everything else — websites in the user's browser, content fetched from the
web, AI model output and other users on the same network — is **untrusted**
and must not reach operator capability. The shipped container exposes no local
HTTP port; the browser dashboard is the authenticated cloud surface.

If you want to use JHT with multiple people, give each person a separate machine, VM, or OS user. The container is **not** a security boundary between users.

## In scope

The following are treated as security bugs:

- **Auth bypass** on sensitive routes without physical/SSH control of the host
- **CSRF / DNS rebinding** triggering side effects on a supported HTTP surface
- **Command injection** from untrusted input (file content, API body, env config)
- **Path traversal** outside expected directories
- **SSRF** toward `127.0.0.1`, cloud metadata endpoints, or RFC1918 from untrusted URLs
- **Weak crypto** allowing decryption of `~/.jht/credentials/*.enc.json` without the passphrase
- **Secret leakage** in logs, stack traces, or response bodies
- **Cloud-sync IDOR** — a Supabase user reading or modifying another user's data
- **Prompt injection with boundary bypass** — model output that defeats an explicit policy (e.g. "do not read secrets")

## Out of scope

The following are **not security bugs** in JHT:

- A trusted operator running `jht agent start` and the agent doing things in their own container — that's the product.
- Shell commands run by `--yolo` agents inside the container — that's the purpose of `--yolo`.
- The `jht` user having `sudo NOPASSWD` inside the container — by design, agents need to install packages on the fly.
- Container escape via kernel/Docker CVEs, unless a JHT-specific bug is shown.
- Prompt injection without boundary bypass ("I made the agent say profanities").
- Skills shipped in the repo (`agents/_skills/`, `agents/*/_skills/`) doing privileged things — they are part of the trusted compute base.
- CVEs in upstream dependencies not exploitable through JHT specifically — report upstream.
- A contributor exposing the development-only web server to the internet
  without its normal authentication boundary. The released product does not
  ship a local web server.

## What we deliberately don't offer

To set expectations honestly:

- **No bug bounty** — open-source project, no budget.
- **No enterprise SLA** — use at your own risk.
- **No 100% prompt-injection-proof guarantee** — active research area.
- **No container-escape guarantee** — Docker/OS responsibility.
- **Platform signing is not uniform** — macOS releases are signed, notarized
  and stapled; Windows and Linux artifacts are currently unsigned. Verify that
  downloads come from this repository's GitHub Releases page.

## Hardening status

The repository has been through a dedicated hardening sprint: 31 of 34
hardening tasks closed (from 27 findings), and the comparison score moved from
30% to 74% versus the OpenClaw baseline. Tooling in place includes `gitleaks`,
`detect-secrets`, `actionlint`, `zizmor`, `npm audit --production`, `pip-audit`
and Dependabot (npm + Docker).

**Git history sanitization** — before the repository was published in July
2026, its history was rewritten with `git filter-repo`: application dossiers,
employer names, email addresses, machine addresses and other personal data
from test runs were purged or pseudonymized. If you spot a `chore(pii)` commit
in the log, that is the tip-level removal; the historical blobs behind it were
purged in the same sweep.

Full audit trail and remaining gaps: [`docs/security/`](docs/security/).

## Versioning

**Policy version:** 1.0
**Last updated:** 2026-08-04
**Next review:** at the next regular release or after a material trust-boundary change.
