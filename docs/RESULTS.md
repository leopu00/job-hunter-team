# Results

This page collects what JHT has actually produced for real users — not benchmarks, not synthetic tests.

## Case study #1 — Leone (the legacy team, 2026)

The original private version of JHT, hardcoded for one user.

| Metric | Value |
|---|---|
| 👤 User profile | Full-stack developer |
| 📅 Period | 2–3 weeks |
| 💳 Subscription | Claude Max x20 (~€200/mo) |
| 🎯 Job offers analyzed by the pipeline | ~300 |
| 📄 Applications sent (CV + cover letter) | ~20 |
| 💬 Interview invites | 5 |
| 🎉 Offers received | 0 *(not the goal — see note)* |
| ✉️ Reply rate vs market baseline | ~5x typical |

> **Note on zero offers**: Leone wasn't actively hunting — the 5 interviews were taken to validate that the pipeline produced submissions strong enough to reach the human stage. The hypothesis was: *"if AI-written applications get reply rates above market baseline, the system works."* It did. Then he stopped applying for himself and rebuilt the team for everyone.

Full origin story in [`STORY.md`](STORY.md).

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
- [`MONITORING-RESULTS.md`](MONITORING-RESULTS.md) — technical test data on the monitoring stack
