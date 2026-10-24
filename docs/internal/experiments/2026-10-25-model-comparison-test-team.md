# Model comparison on a test team — 24–25 October 2026

> **Status: in progress.** Figures as of the night of 25 October. What is not
> measured yet is said in each section and listed at the end. Only numbers and
> method are recorded here: no listing text, no company, no tester data.

## What was compared, and how

One small test team (a few agents in a container on a rented server, the same
agent prompts and skills as a normal team) was run in two configurations:

| Configuration | Models | How it is paid |
|---|---|---|
| **Claude** | Sonnet for the four main roles, Haiku for the others | API key, pay per use |
| **Codex** | the three Codex tiers (sol, terra, luna), set per role with `/model` | subscription |

Terms: the *captain* is the coordinating role; the *sentinel* watches
consumption; *pacing* slows the workers down to stay inside the usage window;
the *bridge* is the process that feeds usage data to pacing; a *soft pause*
stops the team until the person gives the go-ahead.

Costs come from the provider's console where there is one, and from our own
token count where there is not. Quality is read from what the team wrote in its
database; none of it has been judged blind by a human reader (see the limits).

## 1. Quality of the job-description summaries (the focus)

The field is `jd_summary`: the text an analyst writes about a listing, meant to
be read at a glance. Sample: **36 summaries from the Claude run, 60 from the
earlier Codex run** (lengths in characters). A larger production team (Codex) is the
reference.

| | Claude | Codex | Larger production team |
|---|---:|---:|---:|
| Median length | 675 | 869 | ~680 |
| Shortest / longest | 500 / 1,052 | 583 / 1,102 | |
| Average words | 103 | 113 | |
| Average sentences | 5.9 | 6.9 | |
| Median bullet points | 5 | 4 | |
| Median bold passages | 3 | 3 | |
| Median emoji | 4 | 3 | |
| With a bulleted list | 100% | 100% | |
| Median length of the longest bullet | 111 | 197 | |
| States an uncertainty out loud ("probably", "not stated") | 18 of 36 (50%) | 8 of 60 (13%) | |
| Written in English | 26 of 36 | 57 of 60 | |

What it says:

- **The structure is the same in both**, and it is imposed by the prompt: a bold
  title with place and contract type, four or five bullets with an emoji, a
  closing line on language and requirements. The format is not where the
  models differ.
- **Claude is shorter and drier**: a shorter longest bullet (111 against 197
  characters) reads faster at a glance. Codex puts more detail in each bullet.
- **Claude says more often what the listing does not say** (half of the
  summaries against one in eight). It is useful, and it makes the text less
  decisive.
- **Language**: most summaries are in English, with summaries in Italian
  appearing in waves and no rule tied to the model. The language of a summary
  should follow the user's; this is an open question about the product, not a
  finding about the models.
- No difference in quality is evident from the format alone.

Limits: a small sample; in the Claude run the two models cannot be told apart
summary by summary; in the Codex run the three tiers cannot be told apart
either; and **no human reader has judged them blind**. A conclusion on which
text reads better needs that evaluation.

## 2. Claude on the API against Codex on a subscription: two hours of real work

| | Claude (API) |
|---|---|
| Cost on the provider's console | about 8.4 USD |
| Our estimate from the token counts | 7.3 USD (about 13% under the console, on these rounded figures) |
| Positions found | 28 |
| Positions processed | 20 |
| Scores written | 9 |
| Companies analysed | 22 |

- Positions: quality about the same as Codex's. Companies: poorer and more
  optimistic (Haiku). Scores: stricter.
- The purchased balance ran out during the run.
- **Observed:** with the purchased balance at zero, the interactive
  command-line agent with the API key was refused ("credit balance too low"),
  while `claude -p` (non-interactive) with the same key answered. **Which
  balance paid for that answer is not confirmed yet** (to be read on the
  provider's billing page). Whether promotional credits can pay for either
  was not tested here.
- With the agent CLI on an API key the team's watchers have **no usage data**
  (there is no usage window to read): pacing and the sentinel go blind and the
  team goes into a soft pause, which is lifted by the person's explicit
  go-ahead.
- Back on Codex after the subscription login: the weekly Codex budget went from
  96% to 98% in about four hours of a reduced team. Past about 96% the captain could not scale the team (observed).

## 3. One model per role (Codex)

Models switched per session with `/model` (a resume message is needed after the
switch):

| Role | Model and effort |
|---|---|
| Scout | luna medium, terra high, sol high |
| Analysts | luna medium and terra high |
| Scorer | luna medium |
| Sentinel | luna low |
| Captain | terra high |
| Mentor | sol high |
| Assistant | terra high |

**Production was low, so nothing can be concluded about the models from it.**
Three things held it down: the scouts could not check listings on a job board
that requires a login (a defect in the skill that does it: it wrote its working
data into a system folder the team's user cannot write; fixed in the
development branch, not yet in a release, and the test team was not on a build
with the fix), pacing pauses of up to 3,600 s (the top step of the throttle
ladder, `shared/skills/pace_guard.py`, `WORKER_CEILING`), and a consumption
gate that stopped the captain from scaling the team at about 96% (observed;
the danger threshold in the same file, `DANGER_PCT`, is 95%).

## 4. Same input, 11 companies

Method: the same 11 companies given to each model, **from the model's own
knowledge only**, read-only (`codex exec` for the Codex tiers), nothing written
to the database.

| Model | GO | CAUTIOUS | Red flags raised (share of companies) |
|---|---:|---:|---:|
| Haiku | 9 | 2 | 18% |
| sol | 3 | 8 | 73% |
| terra | 3 | 8 | 45% |
| luna | 0 | 10 | 64% |

(The red-flag share is over the 11 companies: Haiku 2, terra 5, luna 7, sol 8.
The verdict counts of luna cover 10 of the 11 companies; the reason is not
recorded.) With luna, a
separate run of the company analysis raised a red flag in 91% of companies and
91% cited an employee-review site.

Haiku is very optimistic and the three Codex tiers are stricter: the difference
is in **calibration, not in format**. Which calibration is right needs a
ground truth the 11 companies do not provide.

## Not measured yet

- Which balance `claude -p` spends (billing page).
- A blind human judgement of the summaries' readability.
- The model tiers of each Codex summary and of each Claude summary.
- Model per role with a team in normal production (the experiment in section 3
  was held back by the three causes above).
- Weekly Codex budget after its next reset.
