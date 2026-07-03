# 🗺️ ROADMAP — Job Hunter Team

> Last updated: 2026-07-03
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

**Two interaction planes** (decision 2026-06-15): the **data plane** is one-way and read-only everywhere — container → Supabase → the public web dashboard (positions, scores, map, case studies; usable from a phone or a work PC). The **interaction plane** — chat, files, start/stop, config — always lives co-located with the team in the **desktop app** (browser to `localhost` for a local team, the same stack over an SSH tunnel for a VPS team). Telegram is the optional async channel. Full rationale: [`docs/internal/architecture/2026-06-15-interaction-planes-redesign-design.md`](../internal/architecture/2026-06-15-interaction-planes-redesign-design.md).

**Guiding principles** — the constraints every roadmap item respects:

- **Local-first, privacy-first.** Credentials, CVs and the SQLite source-of-truth never leave the user's machine; the cloud mirror is opt-in and read-only. Web read-only is a *security* stance, not a UX shortcut.
- **Subscriptions, not API keys.** A parallel agent team burns pay-per-use credits in hours; subscription tokens cost ~5× less ([ADR-0004](../adr/0004-subscription-only-no-api-keys.md)). Pay-per-use returns only as a Sentinel-enforced €-budget (mission M8).
- **Quality over volume.** No auto-apply spam: the Critic gate rewrites until submissions pass a rubric, and the human clicks send.
- **Honest status.** Verbal states, measured numbers, and published case studies — nothing on this page should fail a fact-check against the code.

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

## 🧭 Horizons — what the core team is driving

The maintainer's own sequencing (contributor missions below run in parallel and are not gated on this):

| Horizon | Focus |
|---|---|
| **Now** *(weeks)* | Demo GIFs + launch assets for the README and download page · the two open pacing guards (reset-edge false-freeze, daily-halt standby leak) · publish the remaining case studies (Kimi weekly-distributed run #4, Claude re-run #5) · observe the two multi-week Kimi beta teams. |
| **Next** *(1–2 months)* | Desktop auto-update + tray/notifications + recovery passphrase · **Kimi €40 out of beta** if the month-scale observation holds (that unlocks the honest "affordable for everyone" claim) · translator guide + native-speaker review pass · public project board fed by triaged issues. |
| **Later** *(a quarter and beyond)* | The large missions as they attract contributors — mobile control (M2), local models (M5), pay-per-use €-budget (M8) · Mentor as a first-class surface (M6) · fine-grained team observability with a who-did-what-when timeline (M7, enabled by the [DB schema evolution](../internal/roadmap/db-schema-optimization.md)). |

---

## 🙌 Where you can help — contributor missions

New here? These are the **missions** we'd love a hand with — bigger directions, each broken into smaller entry-point tasks. Pick one, comment to claim it, open a PR.

```
  NOW                          NEXT                         LATER
  (core team)                  (great entry points)         (bigger builds)
  ────────────────────────     ────────────────────────     ────────────────────────
  • launch assets              • M1 quick-feedback cards     • M2 mobile team control
  • public site polish         • M4 cheaper tiers +          • M5 fully-local models
  • case studies                  more providers
                               • M3 harden security
```

| # | Mission | Good for | Size |
|---|---------|----------|------|
| **M1** | 🃏 Quick-feedback cards on offers (swipe / buttons → the team learns your taste). The backend action already exists (`user-exclude` + the async request lane); the card UX is the work. | Frontend / UX | 🟡 medium |
| **M2** | 📱 Control & stop the team from your phone — today the phone gets the read-only dashboard and Telegram; full control needs a mobile-friendly surface over the interaction plane. | Mobile + API | 🔴 large |
| **M3** | 🛡️ Harden security — prompt-injection fencing on ingested job descriptions, uniform auth gates across routes, sync-token lifecycle policy. | Security / Backend | 🔴 large |
| **M4** | 💸 Run on entry tiers (~€20/mo) + add more providers ⭐ — the blocker is projection precision and coordinator overhead, not raw budget; every new provider also stress-tests the pacing abstraction. | Integrations | 🟡 medium |
| **M5** | 🏠 Run the whole team on local models (zero cloud) ⭐ — start by swapping a single role (the Scorer is the most self-contained) and measure quality against the case-study baselines. | LLM / infra | 🔴 large |

**On the horizon** — bigger directions we've scoped but not opened yet:

| # | Direction | Why it matters |
|---|---|---|
| **M6** | 🧙‍♂️ Mentor as a first-class citizen — dedicated web + desktop page, deeper tuning | The career-coach agent is live but buried in chat; it deserves its own surface. |
| **M7** | 📊 Fine-grained observability + user feedback — full who-did-what-when timeline per offer | Builds on the [schema evolution plan](../internal/roadmap/db-schema-optimization.md) (`position_events` is the enabler). |
| **M8** | 💳 Pay-per-use API mode with a **€-budget** the Sentinel enforces | Turns the budget guardian from "subscription %" into real money limits — and makes JHT usable without any subscription. |

> Each mission gets a tracking issue with **good-first sub-tasks** — look for the `good first issue` and `help wanted` labels, or open a [Discussion](https://github.com/leopu00/job-hunter-team/discussions) and we'll help you scope a first slice.

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
