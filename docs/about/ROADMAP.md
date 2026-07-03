# 🗺️ ROADMAP — Job Hunter Team

> Last updated: 2026-07-03 · 🚀 launch day
>
> This is the **strategic, forward-looking** view — the themes in motion and where help is welcome. It is **not** a status ledger: shipped work lives in [`CHANGELOG.md`](../../CHANGELOG.md), tactical tasks in [GitHub Issues](https://github.com/leopu00/job-hunter-team/issues) (plus the slim [`BACKLOG.md`](../../BACKLOG.md) index), technical debt in [`docs/internal/roadmap/MINOR-TRACKER.md`](../internal/roadmap/MINOR-TRACKER.md). No percentages here — verbal states only.
>
> 🙌 **Want to contribute?** Jump to [Where you can help](#-where-you-can-help--contributor-missions).

---

## 🎯 Vision (deployment & stack)

> 🧭 Product vision & design philosophy → [`VISION.md`](VISION.md) — agents-as-characters, the Mentor, the anti-goals. This section covers *deployment & stack* only.

Job Hunter Team runs **locally** in a Docker container, with multiple interfaces (web/desktop/CLI/TUI/Telegram). Non-technical users download the Electron app; technical users clone the repo and use the CLI. Either way, the agent team works on the user's own machine, on their own data, with their own LLM subscription — not a managed cloud service. **AI on the side of workers, not against them.**

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

**Two interaction planes** (decision 2026-06-15): the **data plane** is one-way and read-only everywhere — container → Supabase → the public web dashboard (positions, scores, map, case studies; usable from a phone or a work PC). The **interaction plane** — chat, files, start/stop, config — always lives co-located with the team in the **desktop app** (browser to `localhost` for a local team, the same stack over an SSH tunnel for a VPS team). Telegram is the optional async channel. Full rationale: [`docs/internal/2026-06-15-interaction-planes-redesign-design.md`](../internal/2026-06-15-interaction-planes-redesign-design.md).

**Stack decisions:**

| Component | Technology | Rationale |
|---|---|---|
| Desktop app | **Electron** | Installer + lifecycle **+ interaction cockpit** (local via browser→localhost, VPS via SSH tunnel); the web dashboard stays view-only |
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
| 🔨 **Web platform** (read-only cloud dashboard) | **Shipped, hardening** | Live on [jobhunterteam.ai](https://jobhunterteam.ai) — 54 pages, 143 API routes on real data, E2E-tested. Open: pacing reset-edge guard, publish the remaining test-campaign cells ([`BETA.md`](../guides/BETA.md)). |
| 🖥️ **Desktop launcher** (Electron, all-in-one) | **Shipped, polishing** | Installers (4 OS), wizard, OAuth, encrypted cloud sync live. Open: auto-update, tray icon + native notifications, recovery passphrase, friendly error cards, embedded help/FAQ. Code signing deferred by choice (open source + community review as the trust signal). |
| ☁️ **VPS provisioning** (bring-up via SSH) | **Shipped** | Desktop wizard brings a team up on any VPS (SSH key + IP, provider install, login PTY, Telegram step). Multi-cloud adapters deliberately not pursued — see the scope note below. |
| 📡 **Budget monitoring** (Bridge + Sentinel) | **Proven at month scale on Codex** | Weekly-aware pacing closed 4 straight weekly cycles at 99–100% with zero overshoot ([case study #4](RESULTS.md#-case-study-4--the-finance-profile--codex-pro-one-month-autonomous-run)). Open: Kimi projection precision (±10–15% → tier stays **beta**, two multi-week teams in observation), €20 entry tiers not viable yet (→ mission M4). |
| 🌍 **Internationalization** (7 languages) | **Essentially done** | EN base + it/hu/es/de/fr/pt across agent prompts, UI, landing, docs pages. Open: `LOCALES` drift (`shared/i18n/types.ts` omits `hu`; API default `'it'` vs `DEFAULT_LOCALE='en'`), `mantenitore` agent overlays, translator-facing guide, native-speaker review. |
| 💬 **Telegram** (async channel) | **Shipped, optional** | 3 bots (Assistant/Captain/Mentor) via wizard, skippable since 2026-06-15. Horizon: per-agent 1:1 chat, directed messages (`@scout find python jobs in EU`), "team forum" view (→ mission M7). |
| 🌐 **Public website & launch assets** | **In progress** | Landing + case studies + docs live in 7 languages. Open (maintainer): demo GIFs for the README (blocker), launcher screenshots, visual FAQ, video tutorials, SHA256 checksums on the download page, press kit. |
| 🚢 **OSS hygiene** | **In progress** | LICENSE, CoC, SECURITY, issue templates, 25-label taxonomy, triage SLA in place. Open: `gh label sync` live + public project board, FAQ, VPS comparison doc, awesome-lists submissions. |

> 📦 **Scope note — multi-cloud provisioning:** we evaluated per-provider adapters (AWS EC2 / GCP GCE, one-click `create-server`, billing-aware provisioning) and dropped them. The single-VPS-over-SSH path already covers every use case, and automated Hetzner API provisioning is out-of-scope for beta (decision locked 2026-05-13). If real demand appears we reopen it as a fresh design — no abandoned code ships in the meantime.

---

## 🙌 Where you can help — contributor missions

New here? These are the **missions** we'd love a hand with — bigger directions, each broken into smaller entry-point tasks. Pick one, comment to claim it, open a PR.

```
  NOW                          NEXT                         LATER
  (core team, pre-launch)      (great entry points)         (bigger builds)
  ────────────────────────     ────────────────────────     ────────────────────────
  • cross-OS setup E2E         • M1 quick-feedback cards     • M2 mobile team control
  • public site polish         • M4 cheaper tiers +          • M5 fully-local models
  • case studies                  more providers
                               • M3 harden security
```

| # | Mission | Good for | Size |
|---|---------|----------|------|
| **M1** | 🃏 Quick-feedback cards on offers (swipe / buttons → the team learns your taste) | Frontend / UX | 🟡 medium |
| **M2** | 📱 Control & stop the team from your phone | Mobile + API | 🔴 large |
| **M3** | 🛡️ Harden security (prompt-injection fencing, uniform auth gates, token policy) | Security / Backend | 🔴 large |
| **M4** | 💸 Run on entry tiers (~€20/mo) + add more providers ⭐ | Integrations | 🟡 medium |
| **M5** | 🏠 Run the whole team on local models (zero cloud) ⭐ | LLM / infra | 🔴 large |

**Also on the horizon:** 🧙‍♂️ **M6** — make the Mentor a first-class citizen (dedicated web + desktop page, deeper tuning) · 📊 **M7** — fine-grained team observability + user feedback (full timeline of every offer, who-did-what-when) · 💳 **M8** — pay-per-use API mode with a **€-budget** the Sentinel enforces (not just a subscription %).

> Each mission has **good-first sub-tasks** in its issue. Issues go live at launch — look for the `good first issue` and `help wanted` labels, or open a [Discussion](https://github.com/leopu00/job-hunter-team/discussions) and we'll help you scope a first slice.

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
- 🧪 [`docs/guides/BETA.md`](../guides/BETA.md) — beta program + open invitation (any role/industry)
- 🦞 [`docs/guides/AI-AGENT-INTEGRATION.md`](../guides/AI-AGENT-INTEGRATION.md) — let your AI assistant drive `jht`
