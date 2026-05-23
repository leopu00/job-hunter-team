# Show HN — draft

Working draft for the public launch post on Hacker News. Tone is dev-to-dev:
no marketing language, no "revolutionary AI", no sales speak. Lead with what
it does and the numbers from the legacy run, then the why.

Linked from [`BACKLOG.md`](../../BACKLOG.md) item **[JHT-LAUNCH-09]**. Owner:
maintainer. Reviewer: the team (post in #launch when ready). Not published yet.

---

## Title

HN titles get 60 characters max in the front-page list. Test the variants in
order; if one feels too much like a pitch, fall back to the next.

1. `Show HN: Job Hunter Team — 7-agent pipeline to apply to jobs for you`
2. `Show HN: I open-sourced the AI team that found me 5 interviews`
3. `Show HN: A Docker-packaged team of AI agents that hunts jobs`
4. `Show HN: Self-hosted multi-agent job search (Claude/Kimi/Codex)`

The first one is the safest — it's literal and tells you what JHT does in
one line. The second one performs better on engagement but reads more
"clickbait-ish"; only use it if the first is already taken or buried.

## Body (dev-to-dev)

> I built **Job Hunter Team** because I was looking for a job in early
> 2026 and the response rate on cold applications had collapsed. Most
> postings got zero replies even with a tailored CV. I wrote a small
> pipeline of LLM agents to do the boring half of the search — find
> postings, filter them, write the CV + cover letter, log everything —
> and let me focus on the interviews when they came in.
>
> The legacy version ran for **2 weeks** on a single Claude Max x20
> subscription:
>
> - ~200 job offers discovered and analyzed
> - ~20 high-quality applications sent (fully tailored CV + cover letter)
> - 5 interviews booked
>
> None of those interviews ended in an offer, but the conversion from
> "AI-generated submission" → "human invited me to talk" was real, which
> is the part of the funnel that's usually broken.
>
> A few friends asked me to use the same system. The original repo was
> hardcoded to my profile, so I rebuilt it properly — multi-tenant,
> containerized, runnable as a single CLI command. That's what's on
> GitHub now.
>
> **What's in the box**
>
> - 7 specialized agents (Captain, Sentinel, Scout, Analyst, Scorer,
>   Writer, Critic) — each with its own prompt and a small set of
>   colocated skills.
> - A monitoring layer (Bridge + Sentinel) that calibrates token usage
>   to stay inside the subscription window — overshoot is what kills
>   "AI-agent" projects in practice.
> - Pluggable providers: Claude Max ($200/mo), Kimi K2 (~€40/mo), Codex.
>   Subscription-only, no per-token surprises.
> - Web dashboard + Telegram bot + CLI + desktop launcher.
> - Everything runs in a single Docker container. State lives in a
>   bind-mount, so your machine stays clean.
>
> **What it's not**
>
> - It's not auto-apply spam. It won't fire off 500 generic CVs. The
>   default Scout queries are tight, the Critic loop rewrites until
>   each submission passes a quality gate, and the throttle clamps the
>   token spend.
> - It's not a hosted service. You run the container, you bring your
>   own Claude / Kimi / Codex subscription. Nothing leaves your box
>   except the actual job application traffic.
> - It's not finished. The Mentor agent (career-coach role) is
>   half-built, the desktop installer for non-CLI users is in beta,
>   and I'm still chasing real €40/month coverage with Kimi as the
>   primary provider.
>
> **Why open**
>
> Two reasons. First, the legacy run worked well enough that people I
> know wanted to use it — and the only honest way to give them
> something I'm not maintaining for free is to publish it. Second, the
> legacy team itself reviewed my CV and flagged "no real Docker
> experience" as a gap; building a public version was the cleanest way
> to close that gap with a real artifact instead of a tutorial repo.
>
> Repo: <https://github.com/leopu00/job-hunter-team>
> Story (longer version): [`docs/about/STORY.md`](https://github.com/leopu00/job-hunter-team/blob/master/docs/about/STORY.md)
> Beta program: [`docs/guides/BETA.md`](https://github.com/leopu00/job-hunter-team/blob/master/docs/guides/BETA.md)
>
> Happy to answer questions about the agent design, the cost calibration,
> or why I picked subscriptions over per-token billing.

## First-comment prep

HN ranks posts partly on the first 30-60 min of activity, so be ready to
answer fast. Pre-write these so we don't fumble live.

### "Doesn't this just spam recruiters with AI-generated CVs?"
> No — the Critic agent rewrites each submission until it passes a
> rubric (real match against the JD, no hallucinations, no generic
> bullet points). The bottleneck is the LLM throughput, not the apply
> rate. In 2 weeks the legacy team sent ~20 applications, not ~200.
> Quality > volume is the entire point.

### "Why a multi-agent team? Wouldn't one big prompt do?"
> A single agent thrashes on context: it has to hold the JD, your CV,
> the rubric, the search history, and the throttle state all at once.
> Splitting roles let me keep each prompt under 1k tokens of system
> message and the context windows tight, which is what actually keeps
> the token bill within the subscription envelope.

### "What stops it from burning my Claude quota in 4 hours?"
> The Sentinel reads usage live from the provider's `/usage` endpoint
> and adjusts a global throttle (T0 → T2 → freeze) for the whole team.
> Empirically it lands within 5-15% of the subscription window. Source:
> `agents/sentinella/` + `agents/_skills/throttle/`.

### "How is this different from autoApplyBot / autoApply / Simplify / ..."
> Most of those are browser-extension form-fillers. JHT is the layer
> *above* that — it decides which jobs are worth applying to, drafts
> the tailored CV + cover letter, and logs the funnel. The actual
> "click submit" step is still manual, on purpose: a single bot-flag on
> your LinkedIn account is too expensive a failure mode.

### "Can it really run on €40/month?"
> Honestly: TBD. Kimi K2 at €40/mo handles the load in my smoke tests
> but I haven't run a full 2-week campaign on it yet — that's the next
> piece of work I want to publish numbers on.

## Timing

- **Best window:** Tuesday or Wednesday, 13:00-15:00 UTC (08:00-10:00 ET).
  HN traffic is highest then and the front page churns slower than on
  Mondays.
- **Avoid:** Friday afternoon (drops off the front page before US
  east-coast end of day), any Monday morning (drowns in week-start
  posts), and the day of any Apple/Anthropic/OpenAI keynote.
- **Pre-flight:** repo `README.md` and `docs/about/STORY.md` must be
  the last things touched before posting. The HN crowd reads them
  inside the first 10 minutes, and any half-finished section is the
  first comment.

## Plan B

If HN doesn't pick up within ~2 hours of posting (i.e. fewer than ~30
upvotes), fall back to these in order. Don't cross-post simultaneously
— stagger by 6-12 hours so each thread can stand on its own.

1. **r/LocalLLaMA** — angle: multi-agent orchestration with
   subscription LLMs, not API. Lead with the architecture diagram and
   the token-throttle calibration story.
2. **r/ClaudeAI** — angle: Claude Max x20 in a real production
   workload, sub-limit usage with Sentinel.
3. **r/selfhosted** — angle: full Docker container, bind-mounts only,
   no cloud component. Lead with the install one-liner.
4. **r/cscareerquestions / r/ItalyJobs** — only if (1)-(3) also flop;
   different audience, different framing (results-first, not
   architecture-first).

## After the post

- Monitor the thread for the first 4 hours. Reply to every top-level
  comment even if it's "this won't work" — the algorithm rewards
  engagement velocity.
- Pin a single follow-up comment with the install instructions and
  the BETA program link so people who land late don't have to scroll
  through the architecture debate to get to the action.
- Open a GitHub issue tagged `feedback:hn` and link every constructive
  thread comment so we don't lose them.
