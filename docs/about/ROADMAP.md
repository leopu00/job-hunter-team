# 🗺️ ROADMAP — Job Hunter Team

> Last updated: 2026-11-12 *(0.4: the Tauri 2 desktop app replaces the Godot
> office, which is retired and not distributed)*
>
> This is the **strategic, forward-looking** view. It is **not** a status
> ledger: shipped work lives in [`CHANGELOG.md`](../../CHANGELOG.md), tactical
> tasks in [GitHub Issues](https://github.com/leopu00/job-hunter-team/issues)
> (plus the one-line [`BACKLOG.md`](../../BACKLOG.md) index of open items), and technical debt in
> [`docs/internal/roadmap/MINOR-TRACKER.md`](../internal/roadmap/MINOR-TRACKER.md).
> No percentages here — verbal states only.

---

## 🎯 Vision (deployment & stack)

> 🧭 Product vision & design philosophy → [`VISION.md`](VISION.md) — agents-as-characters, the Mentor, the anti-goals. This section covers *deployment & stack* only.

Job Hunter Team runs **locally** in a Docker container, with multiple interfaces
(desktop/web/CLI/TUI/Telegram). Non-technical users use the Tauri 2 desktop
app on a Mac; technical users can also use the CLI (Mac, Linux, and a Windows
preview). Either way, the agent team works on the user's own machine, on their
own data, with their own provider account — not a managed cloud service. **AI on the side
of workers, not against them.**

```
                              👤 User
                                 │
                                 ▼
                       ┌──────────────────┐
                       │ 🐳 JHT Container │
                       │  (agent team +   │
                       │   📡 Bridge)     │
                       └──────────────────┘
                                 │
                ┌────────────────┼────────────────┐
                ▼                ▼                ▼
         🖥️ Local PC      🏠 Dedicated PC    ☁️ Self-hosted VPS
```

**Two interaction planes** (decision 2026-06-15): the **data plane** mirrors container data through Supabase to the authenticated web dashboard (positions, scores, map and case studies; usable from a phone or a work PC). It is read-heavy, with narrow authenticated write-back lanes including web chat (`pending-messages`), persistent team directives, per-position CV write requests and other bounded position feedback/actions. Mobile also exposes an authenticated, rate-limited, stop-only emergency action. These routes mutate only their own user-scoped records or requests: they do not expose a shell, arbitrary commands, team start/restart or general configuration. The broader **interaction plane** — files, lifecycle and configuration — currently lives in the Godot office and moves slice by slice to the Tauri shell, consuming one versioned product API locally or through an SSH tunnel. Telegram is the optional async channel. Full rationale: [`docs/internal/architecture/2026-06-15-interaction-planes-redesign-design.md`](../internal/architecture/2026-06-15-interaction-planes-redesign-design.md); desktop decision: [ADR-0011](../adr/0011-tauri-desktop-shell.md).

**Guiding principles** — the constraints every roadmap item respects:

- **Local-first, privacy-first.** Credentials, CVs and the SQLite source-of-truth never leave the user's machine; the cloud mirror is opt-in and read-mostly. Its authenticated writes include user-owned chat messages, team directives, bounded position feedback/actions and the emergency stop — not generic control of the host or team runtime.
- **Two ways to pay, with a ceiling.** Codex on a subscription is the recommended way and the one proven over a month; GLM or Kimi with an API key on the Pi harness is the other, with a daily spending ceiling that pauses the team ([ADR-0012](../adr/0012-desktop-setup-matrix.md), which supersedes [ADR-0004](../adr/0004-subscription-only-no-api-keys.md)). The full-team [API team](../guides/API-TEAM.md) on metered OpenAI calls stays in rehearsal.
- **Quality over volume.** No auto-apply spam: the Critic gate rewrites until submissions pass a rubric, and the human clicks send.
- **Honest status.** Verbal states, measured numbers, and published case studies — nothing on this page should fail a fact-check against the code.

**Stack decisions:**

| Component | Technology | Rationale |
|---|---|---|
| Native desktop app | **Tauri 2 + static React** | Shared professional UI and a thin native shell; the Godot office is retired ([ADR-0011](../adr/0011-tauri-desktop-shell.md)) |
| Agent runtime | **Python/tmux current; Node.js/TypeScript API workers target** | Production keeps running while roles migrate behind contracts, guardrails and authorized adapters |
| Web dashboard | **Next.js 16 on Vercel** | CI/CD pipeline live |
| Container runtime | **Podman target; Docker retained for the shipped path during migration** | The new own-PC desktop setup provisions local Podman containers; legacy call sites move behind the runtime boundary incrementally |
| Structured data (cloud, opt-in) | **Supabase** | PostgreSQL + Google/GitHub auth |
| User files (cloud, opt-in) | **Google Drive** | CV, cover letters, generated PDFs |
| Cloud provisioning | **Any VPS via SSH** | A VPS is a VPS — the manual SSH + IP flow already runs on any provider. Hetzner is simply the one we test on (cheapest, EU GDPR). A per-cloud one-click abstraction is *not* a target — see the scope note below. |
| Primary language | **English** | 6 more locales shipped (it/hu/es/de/fr/pt) |

---

## 🚦 Where things stand

| Theme | State | What's open |
|---|---|---|
| 🔨 **Web platform** (read-mostly cloud dashboard) | **Shipped, hardening** | Live on [jobhunterteam.ai](https://jobhunterteam.ai) on real data and event-driven through Supabase Realtime. Authenticated users can send and reply to chat messages, maintain team directives, request a CV for a scored position and issue the stop-only emergency action; shell access, team start/restart and general configuration are not exposed. A new user without a team gets the `/welcome` wizard and an interactive simulation. Open work is tracked in GitHub Issues, not in the testing guide. |
| 🖥️ **Desktop application** | **Tauri 2 app shipped on Mac** | The Tauri 2 + React app in [`desktop/`](../../desktop/) is the desktop product on Apple silicon Macs: first setup, Team with chat, Budget, Office, profile and Settings. It installs Podman, or adopts a team the CLI installed on Colima. Open: an end-to-end test of that adoption, a desktop app for Linux and Windows (Windows is a CLI preview). The Godot office is retired and not distributed. |
| ☁️ **VPS provisioning** (bring-up via SSH) | **Shipped** | The native office brings a team up on any VPS (SSH key + IP, provider install, embedded login console, Telegram setup). Multi-cloud adapters deliberately not pursued — see the scope note below. |
| 📡 **Budget monitoring** (Bridge + Sentinel) | **Proven at month scale on Codex** | Weekly-aware pacing closed 4 straight weekly cycles at 99–100% with zero overshoot ([case study #4](RESULTS.md#-case-study-4--the-finance-profile--codex-pro-one-month-autonomous-run)). Open: Kimi projection precision (±10–15% → tier stays **beta**, two multi-week teams in observation) *(Kimi archived in 0.4: no longer offered)*, €20 entry tiers not viable yet (→ mission M4). |
| 🌍 **Internationalization** (7 languages) | **Essentially done** | EN base + it/hu/es/de/fr/pt across agent prompts, native UI and web. The current web locale contract is [`web/i18n/config.ts`](../../web/i18n/config.ts), which includes all seven. Remaining work is translator guidance, coverage cleanup and native-speaker review. |
| 💬 **Async channels** (Telegram · email) | **Telegram shipped & validated** | 3 Telegram bots (Assistant/Captain/Mentor) via wizard, skippable since 2026-06-15 — **field-validated, and the recommended channel for teams on a VPS or dedicated PC**. Email: job-alert sourcing shipped ([`EMAIL-FORWARDING.md`](../guides/EMAIL-FORWARDING.md)); two-way agent email is implemented but still untested. Horizon: per-agent 1:1 chat, directed messages (`@scout find python jobs in EU`), "team forum" view (→ mission M7), **WhatsApp** as an additional channel on the same three-door model. |
| 🌐 **Public website & release assets** | **Website live; release media in preparation** | Landing, case studies and docs are live in 7 languages. Release work now focuses on clean native-format trailers, concise tutorials, screenshots and checksums; recordings with simulation/demo banners are not release assets. |
| 🚢 **OSS hygiene** | **Established** | LICENSE, Code of Conduct, security policy, issue templates, label taxonomy and triage workflow are in place. FAQ, VPS comparison and distribution listings remain normal follow-up work. |

> 📦 **Scope note — multi-cloud provisioning:** we evaluated per-provider adapters (AWS EC2 / GCP GCE, one-click `create-server`, billing-aware provisioning) and dropped them. The single-VPS-over-SSH path already covers every use case, and automated provider-specific provisioning is outside the current product scope. If real demand appears we reopen it as a fresh design — no abandoned code ships in the meantime.

---

## 🧭 Horizons — what the core team is driving

Current sequencing:

| Horizon | Focus |
|---|---|
| **Now** *(November 2026)* | Release 0.4: the Mac desktop app on Tauri 2, the CLI on Mac and Linux, the Windows CLI preview, Codex and the API-key way on Pi, integrations added on request. |
| **Next** *(1–2 months)* | Add native credential storage, Podman detection/provisioning and headless-worker lifecycle through the versioned loopback API; retain Windows signing, installer/upgrade UX and notifications as release gates. |
| **Later** *(a quarter and beyond)* | Add own-VPS SSH setup, provider-subscription TUI/`tmux` paths and managed plug-and-play with Stripe credits · Mentor as a first-class surface (M6) · interview practice (M9) · opt-in auto-submit (M10) · fine-grained team observability (M7). |

---

## 🧭 Future product directions

These missions describe possible product directions. They are not release
prerequisites or promises of a delivery date.

```
  NOW                          NEXT                         LATER
  (release work)               (near term)                  (later)
  ────────────────────────     ────────────────────────     ────────────────────────
  • 0.4 release (Tauri app)   • desktop app beyond the Mac   • M7 fine-grained observability
  • product API               • M4 cheaper tiers +          • M9 interview practice
  • case studies                 more providers              • M10 opt-in auto-submit
                               • M3 security · M5 local ⭐
```

M1 quick-feedback cards and M2 mobile team safety are already shipped, so
they live in [`CHANGELOG.md`](../../CHANGELOG.md) rather than this future list.

| # | Direction | Engineering focus | Size |
|---|---------|----------|------|
| **M3** | 🛡️ Harden security — prompt-injection fencing on ingested job descriptions, uniform auth gates across routes, sync-token lifecycle policy. | Security / Backend | 🔴 large |
| **M4** | 💸 Run on entry tiers (~€20/mo) + add more providers ⭐ — reproducible variance and cost tooling (built on Kimi, archived in 0.4) [exists](../internal/experiments/2026-08-03-m4-entry-tier-evidence-protocol.md), but no live export in the repo validates 88→92 or a PAYG buying claim yet; any fourth CLI remains gated by [ADR-0002 and the provider checklist](../guides/ADDING-A-PROVIDER.md). | Integrations | 🟡 medium |
| **M5** | 🏠 Run the whole team on local models (zero cloud) ⭐ — a one-role Scorer spike exists with a machine-checked provider inventory and deterministic comparison harness. Whole-team support remains unavailable: paired quality, live URL/feedback parity, real hardware evidence and additional roles are still required. | LLM / infra | 🔴 large |

> 🖥️ **Desktop app** — the Tauri migration is the shipped app; its history, capability gates and
> parity rule are in the [desktop migration plan](../internal/roadmap/2026-08-24-desktop-tauri-migration.md).

**On the horizon** — bigger directions we've scoped but not opened yet:

| # | Direction | Why it matters |
|---|---|---|
| **M6** | 🧙‍♂️ Mentor as a first-class citizen — dedicated web + desktop page, deeper tuning | The career-coach agent is live but buried in chat; it deserves its own surface. |
| **M7** | 📊 Fine-grained observability + user feedback — full who-did-what-when timeline per offer | Builds on the [schema evolution plan](../internal/roadmap/db-schema-optimization.md) (`position_events` is the enabler). |
| **M8** | 💳 Pay-per-use API mode — the [API team](../guides/API-TEAM.md), in rehearsal, with **dollar caps** enforced per run (the runtime), per session (the launcher) and across runs (the key proxy) | Real money limits instead of a subscription's usage window — and makes JHT usable without any subscription. |
| **M9** | 🎤 Interview practice agent — mock interviews **tailored to a specific position** (its JD, seniority, company), with feedback after each round | Rehearsing for a strong match is a natural extension of the Mentor (pairs with M6). |
| **M10** | 📮 Opt-in auto-submit lane — **off by default**, per-user explicit opt-in, hard caps, and only for drafts that clear the Critic gate | A possible bounded exception for users who explicitly choose it; quality-over-volume remains the default. |

Work moves into a tracking issue when it is scheduled. Shipped behavior remains
in the changelog, not on this forward-looking page.

---

## 📚 Related

- 🎯 [`docs/about/VISION.md`](VISION.md) — design philosophy (the "why")
- 📝 [`CHANGELOG.md`](../../CHANGELOG.md) — everything that shipped, per release
- 📋 [`BACKLOG.md`](../../BACKLOG.md) — one line per open item
- 📊 [`docs/about/RESULTS.md`](RESULTS.md) — case studies (incl. the month-long autonomous run)
- 💳 [`docs/about/PROVIDERS.md`](PROVIDERS.md) — supported subscriptions
- 📡 [`docs/about/MONITORING.md`](MONITORING.md) — Bridge/Sentinel budget stack
- 📐 [`docs/adr/`](../adr/) — architectural decision records (incl. container + subscription-only rationale)
- 🤖 [`agents/_team/architettura.md`](../../agents/_team/architettura.md) — how the team works
- 🛠️ [`docs/internal/architecture/skill-distribution.md`](../internal/architecture/skill-distribution.md) — per-agent skill isolation design + punch list
- 🗄️ [`docs/internal/roadmap/db-schema-optimization.md`](../internal/roadmap/db-schema-optimization.md) — schema evolution ideas (feeds M7)
- 📐 [`docs/internal/ops/INFRA.md`](../internal/ops/INFRA.md) — deployment diagram
- 🧪 [`docs/guides/BETA.md`](../guides/BETA.md) — testing, feedback and evidence guidance
- 🦞 [`docs/guides/AI-AGENT-INTEGRATION.md`](../guides/AI-AGENT-INTEGRATION.md) — let your AI assistant drive `jht`
