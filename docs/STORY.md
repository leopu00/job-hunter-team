# The Story Behind Job Hunter Team

## Why this exists

Job Hunter Team didn't start as an open-source project. It started as a private repo I built to find a job for myself — a full-stack developer looking around in early 2026, in a market where most applications get no reply at all.

The first version was a quick prototype, hardcoded for my profile, not scalable, no UI to speak of. Just a handful of AI agents wired together with tmux and SQLite. It worked far better than I expected.

## What the legacy team did, in numbers

Running it for **2 weeks** on a **Claude Max x20 subscription**:

- 🎯 **~200 job offers** discovered and analyzed by the pipeline
- 📄 **~20 high-quality applications** sent (CV + cover letter, fully tailored, perfect match to the JD)
- 💬 **5 interviews** scheduled within a few weeks

Five interviews in a market where simply *getting a reply* is rare. None of them led to an offer — but that wasn't the point. The point was that the pipeline produced submissions good enough to break through the noise. The conversion from "AI-generated" to "human invited me to talk" was real.

I kept the legacy team running long enough to be sure it wasn't a fluke, then I stopped applying for myself.

## Why I open-sourced it

Two reasons, in this order:

**1. Friends in trouble.** A few people close to me were stuck in the same job search, in the same market. The legacy team was hardcoded to my profile — useless to them. I started thinking about what it would take to make it usable by anyone.

**2. A Docker portfolio piece.** The legacy team itself was honest with me: it scored my profile and flagged "no real Docker experience" as a gap. I needed a project that would prove I could ship a real containerized system. Building JHT properly — multi-tenant, Dockerized, with a launcher and a real UX — covered the gap. The team that found me jobs also told me what to build next.

## What changed when I rebuilt it

Going from "works for Leone" to "works for anyone" is a different project entirely. The current public JHT has:

- 🤖 **7 specialized agents** (Captain, Sentinel, Scout, Analyst, Scorer, Writer, Critic) — each with its own prompt, skills, and on-demand tools
- 🛡️ **A Bridge + Sentinel monitoring layer** that calibrates token usage to within 5–15% of the subscription window, so the team doesn't burn through your quota
- 🌐 **A web dashboard, a Telegram bot, a CLI, and a desktop launcher** — pick the interface that fits how you work
- 💳 **Subscription-only model** (Claude Max x20, Kimi €40, others to test) so you know the cost upfront, no per-token surprises — see [`docs/PROVIDERS.md`](PROVIDERS.md)
- 🐳 **Containerized agents** so your local machine stays clean and the same setup works on a VPS

## What I want next

- **🧙‍♂️ A Maestro agent** — a career coach that looks at your goals, your gaps, and what the market is offering, and helps you adjust direction. The job market changes every month; the team should help you adapt, not just apply.
- **A €40/month tier that actually works** — if Kimi at €40 holds up for a full month under real load, JHT becomes accessible to anyone, not just people who can afford €200/month for Claude Max.
- **More case studies, not just mine** — see [`docs/RESULTS.md`](RESULTS.md). If you use JHT, share your numbers.

## Beta testers wanted

I have a couple of friends already lined up to test the public version. If you're job-hunting and want early access in exchange for honest feedback, see [`docs/BETA.md`](BETA.md).

---

> The system that found me a job tells me to build the next thing. I keep listening.
