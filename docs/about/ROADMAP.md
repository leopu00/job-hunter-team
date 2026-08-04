# 🗺️ ROADMAP — Job Hunter Team

> Last updated: 2026-08-04 *(public release preparation; native distribution,
> setup and first-run docs reconciled with the shipped code)*
>
> This is the **strategic, forward-looking** view. It is **not** a status
> ledger: shipped work lives in [`CHANGELOG.md`](../../CHANGELOG.md), tactical
> tasks in [GitHub Issues](https://github.com/leopu00/job-hunter-team/issues)
> (plus the slim [`BACKLOG.md`](../../BACKLOG.md) index), and technical debt in
> [`docs/internal/roadmap/MINOR-TRACKER.md`](../internal/roadmap/MINOR-TRACKER.md).
> No percentages here — verbal states only.

---

## 🎯 Vision (deployment & stack)

> 🧭 Product vision & design philosophy → [`VISION.md`](VISION.md) — agents-as-characters, the Mentor, the anti-goals. This section covers *deployment & stack* only.

Job Hunter Team runs **locally** in a Docker container, with multiple interfaces (native office/web/CLI/TUI/Telegram). Non-technical users use the Godot office; technical users can also use the CLI. Either way, the agent team works on the user's own machine, on their own data, with their own LLM subscription — not a managed cloud service. **AI on the side of workers, not against them.**

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

**Two interaction planes** (decision 2026-06-15): the **data plane** is one-way and read-only everywhere — container → Supabase → the public web dashboard (positions, scores, map, case studies; usable from a phone or a work PC). The **interaction plane** — chat, files, start/restart, config — lives in the native Godot office, connected directly to a local team or over SSH to a VPS. Telegram is the optional async channel. The sole cloud safety exception is an authenticated, rate-limited, stop-only emergency action on mobile; it cannot run arbitrary commands or start the team. Full rationale: [`docs/internal/architecture/2026-06-15-interaction-planes-redesign-design.md`](../internal/architecture/2026-06-15-interaction-planes-redesign-design.md).

**Guiding principles** — the constraints every roadmap item respects:

- **Local-first, privacy-first.** Credentials, CVs and the SQLite source-of-truth never leave the user's machine; the cloud mirror is opt-in and read-only. Web read-only is a *security* stance, not a UX shortcut.
- **Subscriptions, not API keys.** A parallel agent team burns pay-per-use credits in hours; subscription tokens cost ~5× less ([ADR-0004](../adr/0004-subscription-only-no-api-keys.md)). Pay-per-use returns only as a Sentinel-enforced €-budget (mission M8).
- **Quality over volume.** No auto-apply spam: the Critic gate rewrites until submissions pass a rubric, and the human clicks send.
- **Honest status.** Verbal states, measured numbers, and published case studies — nothing on this page should fail a fact-check against the code.

**Stack decisions:**

| Component | Technology | Rationale |
|---|---|---|
| Native desktop app | **Godot 4.7** | Game-like office, onboarding, lifecycle and interaction cockpit; the web dashboard stays view-only |
| Web dashboard | **Next.js 16 on Vercel** | CI/CD pipeline live |
| Container runtime | **Docker + Docker Compose** | Isolation, reproducibility |
| Structured data (cloud, opt-in) | **Supabase** | PostgreSQL + Google/GitHub auth |
| User files (cloud, opt-in) | **Google Drive** | CV, cover letters, generated PDFs |
| Cloud provisioning | **Any VPS via SSH** | A VPS is a VPS — the manual SSH + IP flow already runs on any provider. Hetzner is simply the one we test on (cheapest, EU GDPR). A per-cloud one-click abstraction is *not* a target — see the scope note below. |
| Primary language | **English** | 6 more locales shipped (it/hu/es/de/fr/pt) |

---

## 🚦 Where things stand

| Theme | State | What's open |
|---|---|---|
| 🔨 **Web platform** (read-only cloud dashboard) | **Shipped, hardening** | Live on [jobhunterteam.ai](https://jobhunterteam.ai) on real data and event-driven through Supabase Realtime. A new user without a team gets the `/welcome` wizard and an interactive simulation. Open work is tracked in GitHub Issues, not in the testing guide. |
| 🖥️ **Native office** (Godot, all-in-one) | **Published build, release hardening** | Office, onboarding, embedded provider console, local/VPS lifecycle, profile, email, Telegram, cloud sync, job data, map, agents and observability are native. Electron and the local web dashboard are gone: the browser is cloud-only. macOS releases are signed and notarized; Windows and Linux artifacts are unsigned. Open: Windows signing, installer and auto-update polish. |
| ☁️ **VPS provisioning** (bring-up via SSH) | **Shipped** | The native office brings a team up on any VPS (SSH key + IP, provider install, embedded login console, Telegram setup). Multi-cloud adapters deliberately not pursued — see the scope note below. |
| 📡 **Budget monitoring** (Bridge + Sentinel) | **Proven at month scale on Codex** | Weekly-aware pacing closed 4 straight weekly cycles at 99–100% with zero overshoot ([case study #4](RESULTS.md#-case-study-4--the-finance-profile--codex-pro-one-month-autonomous-run)). Open: Kimi projection precision (±10–15% → tier stays **beta**, two multi-week teams in observation), €20 entry tiers not viable yet (→ mission M4). |
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
| **Now** *(August 2026)* | **Official public release**: clean install → office → container → provider login → profile → team-up paths on macOS/Windows/Linux, plus native horizontal/vertical trailers and concise game/web tutorials. |
| **Next** *(1–2 months)* | **Native app polish** — Windows signing, installer/upgrade UX and notifications · **local models (M5) groundwork** — paired quality and hardware validation · **Kimi €40 out of beta** only if month-scale evidence holds. |
| **Later** *(a quarter and beyond)* | Broader mobile control beyond the shipped emergency stop · pay-per-use €-budget (M8) · Mentor as a first-class surface (M6) · interview practice (M9) · opt-in auto-submit (M10) · fine-grained team observability (M7). |

---

## 🧭 Future product directions

These missions describe possible product directions. They are not release
prerequisites or promises of a delivery date.

```
  NOW                          NEXT                         LATER
  (release work)               (near term)                  (later)
  ────────────────────────     ────────────────────────     ────────────────────────
  • desktop setup e2e          • M4 cheaper tiers +          • M7 fine-grained observability
    (all three OSes)              more providers             • M9 interview practice
  • case studies               • M3 harden security          • M10 opt-in auto-submit
                               • M5 fully-local models ⭐
```

M1 quick-feedback cards and M2 mobile team safety are already shipped, so
they live in [`CHANGELOG.md`](../../CHANGELOG.md) rather than this future list.

| # | Direction | Engineering focus | Size |
|---|---------|----------|------|
| **M3** | 🛡️ Harden security — prompt-injection fencing on ingested job descriptions, uniform auth gates across routes, sync-token lifecycle policy. | Security / Backend | 🔴 large |
| **M4** | 💸 Run on entry tiers (~€20/mo) + add more providers ⭐ — reproducible [Kimi variance and cost tooling](../internal/experiments/2026-08-03-m4-entry-tier-evidence-protocol.md) now exists, but no live export in the repo validates 88→92 or a PAYG buying claim yet; any fourth CLI remains gated by [ADR-0002 and the provider checklist](../guides/ADDING-A-PROVIDER.md). | Integrations | 🟡 medium |
| **M5** | 🏠 Run the whole team on local models (zero cloud) ⭐ — a one-role Scorer spike exists with a machine-checked provider inventory and deterministic comparison harness. Whole-team support remains unavailable: paired quality, live URL/feedback parity, real hardware evidence and additional roles are still required. | LLM / infra | 🔴 large |

> 🖥️ **Native app** — the highest-priority engineering area remains
> onboarding recovery, accessibility, packaging/signing and cross-platform QA
> in [`game/`](../../game/).

**On the horizon** — bigger directions we've scoped but not opened yet:

| # | Direction | Why it matters |
|---|---|---|
| **M6** | 🧙‍♂️ Mentor as a first-class citizen — dedicated web + desktop page, deeper tuning | The career-coach agent is live but buried in chat; it deserves its own surface. |
| **M7** | 📊 Fine-grained observability + user feedback — full who-did-what-when timeline per offer | Builds on the [schema evolution plan](../internal/roadmap/db-schema-optimization.md) (`position_events` is the enabler). |
| **M8** | 💳 Pay-per-use API mode with a **€-budget** the Sentinel enforces | Turns the budget guardian from "subscription %" into real money limits — and makes JHT usable without any subscription. |
| **M9** | 🎤 Interview practice agent — mock interviews **tailored to a specific position** (its JD, seniority, company), with feedback after each round | Rehearsing for a strong match is a natural extension of the Mentor (pairs with M6). |
| **M10** | 📮 Opt-in auto-submit lane — **off by default**, per-user explicit opt-in, hard caps, and only for drafts that clear the Critic gate | A possible bounded exception for users who explicitly choose it; quality-over-volume remains the default. |

Work moves into a tracking issue when it is scheduled. Shipped behavior remains
in the changelog, not on this forward-looking page.

---

## 📚 Related

- 🎯 [`docs/about/VISION.md`](VISION.md) — design philosophy (the "why")
- 📝 [`CHANGELOG.md`](../../CHANGELOG.md) — everything that shipped, per release
- 📋 [`BACKLOG.md`](../../BACKLOG.md) — slim index of the open tactical work
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
