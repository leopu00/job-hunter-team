# Results

This page collects what JHT has actually produced for real users — not benchmarks, not synthetic tests.

## Case study #1 — The maintainer (legacy team, early 2026)

The original private version of JHT, hardcoded for a single profile run by the project maintainer.

| Metric | Value |
|---|---|
| 👤 User profile | Full-stack developer |
| 📅 Period | 2 weeks |
| 💳 Subscription | Claude Max x20 (~€200/mo) |
| 🎯 Job offers analyzed by the pipeline | ~200 |
| 📄 Applications sent (CV + cover letter) | ~20 |
| 💬 Interview invites | 5 |
| 🎉 Offers received | 0 *(not the goal — see note)* |
| ✉️ Reply rate vs market baseline | ~5x typical |

> **Note on zero offers**: the maintainer was not actively hunting — the 5 interviews were taken to validate that the pipeline produced submissions strong enough to reach the human stage. The hypothesis was: *"if AI-written applications get reply rates above market baseline, the system works."* It did. The system was then rebuilt as the open-source team for everyone else.

Full origin story in [`STORY.md`](STORY.md).

---

## 🧪 Case study #2 — Beta tester 1 × Codex ProLite (senior multilingual technical profile)

35-hour autonomous run on a Hetzner CPX22 VPS. Tested whether a senior multilingual technical profile, targeting a multi-country European market, can be served by the public stack.

> **Profile summary**: senior professional with 10+ years of experience in multilingual technical documentation, translation, and localization, with secondary technical/manufacturing skills. Multi-country European job search across primary and secondary markets, with EU-remote as fallback.

| Metric | Value |
|---|---|
| 👤 User profile | Senior multilingual tech documentation/translation, 10+y experience |
| 🌍 Target geography | Multi-country European search (primary + secondary markets + EU remote) |
| 📅 Period | 2026-05-19 → 2026-05-21 (**34.84h** active pipeline time) |
| 💳 Subscription | 🔵 **Codex ProLite ~€100/mo** (1 month paid) |
| 🖥️ Host | Hetzner CPX22 VPS (2 vCPU, 4GB, **€9.75/mo** ≈ €0.54 for this run) |
| 🎯 Job offers analyzed by the pipeline | **206** |
| ✅ Companies vetted | 179 (120 GO / 59 CAUTIOUS / 0 NO_GO) |
| 📄 Applications written (CV + critic PASS) | **105** *(51% pipeline conversion)* |
| 📤 Applications submitted | 0 *(by-design — user-curated, see note)* |
| 💬 Interview invites | N/A *(no auto-apply)* |
| 🎉 Offers received | N/A |
| 💰 LLM tokens consumed | **396.9M weighted** (Codex billing telemetry) |
| 📈 Critic pass rate | **88.2%** (105 PASS / 14 REJECT, avg score 6.35/10) |
| ⏱️ Avg time-to-ready (found → CV ready) | **7.4h** (min 12 min, max 18.9h) |
| 🧠 Hours of user time | <1h setup + occasional monitoring (autonomous) |

### What worked
- **Niche match excellence** — the candidate's secondary technical/manufacturing skill set surfaced a small group of rare-but-perfect matches that averaged **87.3/100**, the highest score domain of the run. The primary multilingual lane scored steadily lower (avg 73.4) but produced higher volume.
- **Critic loop holds quality** — 88.2% PASS rate confirms the 3-round Critic protocol is *provider-independent*; the LLM is interchangeable as long as the rubric stays consistent.
- **Fast end-to-end pipeline** — average 7.4 hours from discovery to ready CV+cover letter; bottom decile in 30 minutes.
- **Curated source > volume** — the curated scout lane (Company 015/Greenhouse-style) produced 22% high-score positions vs the volume scout lane (LinkedIn-heavy) at 14%.

### What didn't
- **Codex Pro weekly cap is a hard ceiling** — the weekly token budget was consumed in ~2.3 days at a 2.7%/h burn rate. Codex ProLite is **not sustainable for 7-day full-throughput hunts**. Users on this plan need to pace via the bridge or schedule the run.
- **Company verdict rubric is too lenient** — 0 NO_GO out of 179 companies. Hard requirements (degree, geography lock-in) leaked downstream and were filtered late by the Writer instead of upfront by the Analyst.
- **Writer attribution is broken** — only 8 out of 119 `written_by` fields populated (93% null). Pipeline still works but we lose per-Writer quality breakdown.

### Tweaks made to the default config
- Mid-run the user activated **NO CV mode** (search-only) at 2026-05-20 07:42 UTC — Writers went idle by design while Scout/Analyst kept curating.

> **Note on "0 submitted"**: JHT does not auto-submit applications. The user reviews the ready stack (105 CVs in this run) and clicks send when they want. This is the same intentional behavior as case study #1.

> **Note on duration**: this is a ~35-hour snapshot, not a full month of work. A monthly subscription represents ~4 weeks of pacing — these results should be read as *what the pipeline produces under near-burst conditions* rather than steady-state. Multi-week beta tests are the next milestone.

Raw data: SQLite snapshot, Sentinel logs, deliverables (PDF CVs, critic reviews) extracted and verified.

---

## 🧪 Case study #3 — Beta tester 2 × Kimi K2 Pro (junior software developer)

~75-hour run on a Hetzner CPX22 VPS validating Kimi K2 as the **mass-market jackpot tier** (€40/mo target). Profile: junior software developer in a saturated capital-city market — a deliberately hard cell.

> **Profile summary**: junior software developer with ~1 year of experience and no formal degree, looking for a first or second professional position. Target geography is a single European capital metropolitan area. Target industries: technology and fintech.

| Metric | Value |
|---|---|
| 👤 User profile | Junior software developer, ~1y experience, no formal degree |
| 🌍 Target geography | Single European capital-city metropolitan area |
| 🏢 Target industry | Technology / Fintech |
| 📅 Period | 2026-05-16 → 2026-05-19 (~75h calendar, **30.22h** state-tracked pipeline) |
| 💳 Subscription | 🌙 **Kimi K2 Pro ~€40/mo** (1 month paid) |
| 🖥️ Host | Hetzner CPX22 VPS (2 vCPU, 4GB, **€9.75/mo** ≈ €1.17 for this run) |
| 🎯 Job offers analyzed by the pipeline | **251** |
| ✅ Companies vetted | 178 (158 GO / 20 CAUTIOUS / 0 NO_GO) |
| 📄 Applications written (CV + critic PASS) | **56** *(22% pipeline conversion)* |
| 📤 Applications submitted | 0 *(by-design — user-curated)* |
| 💬 Interview invites | N/A |
| 🎉 Offers received | N/A |
| 💰 LLM tokens consumed | **40.7M "fresh" + 1.57B cache_read = 1.61B total** *(aggregated from 16,700 events in 427 session logs)* |
| 💵 Pay-per-use equivalent cost | **~€78** (input $5 + output $17 + cache_read $63 at Kimi list prices) — vs **€40 subscription** = sub 14× cheaper at this usage |
| 📈 Critic pass rate | **51.4%** (55 PASS / 51 REJECT, avg score 5.05/10) |
| ⚡ Bridge velocity | 5.37%/h (2× faster than Codex 2.7%/h) |
| 🧠 Hours of user time | <1h setup + occasional monitoring (autonomous) |

### What worked
- **Token-based provider sustains long runs** — Kimi has no weekly cap; the team ran 4 calendar days without saturation (vs Codex Pro hitting 96% weekly in 2.3 days).
- **High scout volume** — 251 positions discovered in the run, peak of 145 on day 2. Scout-1 (volume lane) found 29 high-score positions on 187 total.
- **Mass-market price point validated** — €40/mo subscription delivered a working pipeline on a junior profile in a saturated metro. **Cost per ready CV: €0.71** (taking the full month's subscription / 56 CVs from this run alone). At pay-per-use rates the same run would have cost ~€78 (input $5 + output $17 + 1.57B cached input $63) — the subscription paid for itself in <4 days.
- **Aggressive prompt caching pays off** — 1.57B cached input reads vs 33.9M new input tokens means the team re-uses context heavily (job descriptions, agent instructions, candidate profile). Caching represents 97% of input volume but cost only ~74% of input billing.
- **Bug-fix loop during the run** — 13 bugs + 4 features closed in a 24-hour mid-run sprint (the maintainer is also a developer; this is not the default user experience but proves the pipeline is debuggable from inside).

### What didn't
- **Pipeline conversion dropped to 22%** vs case study #2's 51%. **Two confounders**: a junior software developer in a saturated capital city is a brutally competitive market (high baseline rejection), and the Critic pass rate also dropped (51% vs 88%). Cannot isolate provider quality from candidate profile difficulty.
- **Critic average 5.05/10** vs case study #2's 6.35/10 — outputs scored lower. Could be Kimi K2 producing weaker CV text, or the junior profile mapping poorly to senior-skewed job descriptions, or both.
- **Scout-2 underperformed on this profile** — 0 high-score positions out of 64 (vs Scout-1's 29/187). The curated-lane strategy that worked on the multilingual senior profile (case #2) did not transfer.
- **Same company-verdict rubric bug** — 0 NO_GO out of 178 (158 GO / 20 CAUTIOUS). Cross-run confirmation that the Analyst rubric is too permissive.

### Tweaks made to the default config
- None planned upfront. Mid-run bug fixes (the 13 closed during the run) are documented in the project changelog.

> **Note on token aggregation**: `token-meter.csv` (the rolling telemetry file the bridge consumes) was reset when the container restarted, so the live CSV no longer holds historical data. The numbers above are **back-calculated from the durable Kimi session logs** (`wire.jsonl` files, 175MB across 15 sessions) — every `StatusUpdate` event the Kimi CLI emits carries an exact `token_usage` block. Aggregating 16,700 such events gives a precise picture. We tracked a follow-up to make `token-meter.csv` restart-durable so future runs don't need this fallback.

> **Note on profile difference**: case study #2 (Beta tester 1) and case study #3 (Beta tester 2) used **different candidate profiles** and **different providers**. The provider comparison is *not* clean — to isolate provider quality we would need the same candidate × two providers in parallel. That's a follow-up experiment.

> **Note on duration**: 75 calendar hours of run, with the weekly token cap hit on day 4. A €40 monthly subscription represents ~4 weeks of pacing — these results show what happens under *burst usage* (single 4-day intensive period), not steady-state. A spread-out usage pattern across the month could produce different cache hit ratios, different pricing dynamics, and potentially better throughput per euro. Multi-week beta tests and a separate **€40 pay-per-use validation experiment** are the next milestones.

Raw data: SQLite snapshot, Sentinel logs (3052 ticks), Kimi session logs (16,700 token events), deliverables (PDF CVs, critic reviews) extracted and verified.

---

## Case study template

If you use JHT and want to share your results, here's the template. PRs welcome — drop a new section in this file.

```markdown
## Case study #N — [Your name or handle]

| Metric | Value |
|---|---|
| 👤 Profile (role / seniority / location) |
| 📅 Period |
| 💳 Subscription / provider |
| 🎯 Offers analyzed |
| 📄 Applications sent |
| 💬 Interview invites |
| 🎉 Offers received |
| 💰 Total LLM cost |
| ⏱️ Hours of your time spent |

### What worked
- ...

### What didn't
- ...

### Tweaks you made to the default config
- ...
```

## What we want to learn

The case studies above (and the ones we hope you'll add) are how we understand:

- 📈 **Conversion rates** — Offer → CV → Interview, by industry and seniority
- 💰 **Cost per result** — total LLM spend vs interviews obtained
- 🌍 **Market coverage** — which job boards actually produce results, by region
- 🧪 **Provider performance in the wild** — how Kimi, Claude Max, and the rest hold up beyond our test sessions

We will publish aggregate results in this file periodically (anonymized, with consent).

## Related

- [`STORY.md`](STORY.md) — why this project exists
- [`PROVIDERS.md`](PROVIDERS.md) — which subscription to pick
- [`MONITORING.md`](MONITORING.md) — Bridge/Sentinel monitoring stack (architecture + test data)
