---
name: throttle-distribution
description: Decide WHO slows down and BY HOW MUCH when the team's consumption has to change. Open it when a `[PACE-GUARD]` advisory lands in your pane, when the Sentinella orders a `Throttle: N` level, or when your own check says the window is off pace. Every one of those signals is a single team-level number; the actuator is per-agent, and choosing the per-agent split is yours alone — no script moves the worker throttle any more. Also tells you when the right move is to leave it alone.
allowed-tools: Bash(python3 *), Bash(jht-tmux-send *)
---

# throttle-distribution — who slows down, and by how much

Every pacing signal you get is one number for the whole team: *"35% too fast"*, *"Throttle: 2"*, *"advised 780s"*. The actuator is not one number — it is one value per agent in `throttle.json`, and **you are the only one who writes it**. No script moves the worker throttle on its own.

So the job this skill does is the conversion, and it has exactly one hard rule: **a team-level number does not mean everyone gets the same value.** One Scout can be 52% of the burn while an idle Writer is 2%; the Analista and the Scorer are the two roles that turn a backlog into the only thing the user actually sees — a position **with a score**. Levelling spends your brake where there is nothing to gain and takes throughput where it costs the most.

## When to open this skill

| Trigger | Where it comes from | Go to |
|---|---|---|
| `[PACE-GUARD] … NON APPLICATO` in your pane | the bridge: it checks consumption against the window curve at every usage sample, and writes to you only when there is something to act on | §1 |
| `[SENTINELLA] [URG] RALLENTARE — Throttle: N`, or any pacing signal she forwards | she receives the 15-min `[BRIDGE PACING]` tick (it lands in **her** pane, not yours), reads it, and decides whether it is worth waking you | §3 — the "how much" is decided, the split is not. `bridge-pacing` decodes her numbers |
| `[HEARTBEAT]` mentioning weekly/burn, or your own `rate-budget` / `agent-speed-table` pull | you, on your own initiative | §2 |

> ⚠️ **You are not pinged every 15 minutes, and you should not wait to be.** Being kept quiet is deliberate: if every bridge in the office reported to you directly, you would spend the budget reading instead of deciding, and you would burn it while the user is asleep. The 15-min tick goes to the Sentinella, who filters and only then disturbs you. So **drive on the conditions you observe** — do not sit waiting for a tick that is not addressed to you. If a pacing line does reach you directly it is either a `[PACE-GUARD]` or an escalation saying the Sentinella has gone unreceptive (that is a liveness problem, not a pacing verdict — `agent-emergency`).

---

## 1. Reading the `[PACE-GUARD]` advisory

One physical line, fields separated by ` | ` (wrapped here for reading):

```
[@bridge -> @capitano] [PACE-GUARD] <VERDETTO> — CONSIGLIO, THROTTLE NON APPLICATO |
  usage=<U>% vs curva=<I>% (<±D>pt sul target <T>% al reset) | reset fra <M> min |
  throttle worker ORA <C>s → CONSIGLIATO <R>s (<±S> gradini) | worker: <a1, a2, ...> |
  decidi tu e applica: python3 /app/shared/skills/throttle-config.py bulk-set <a1>=<R> <a2>=<R>
```

Stable anchors if you have to recognise it in a noisy pane: the `[PACE-GUARD]` tag, the words `NON APPLICATO`, and `CONSIGLIATO <R>s`.

| Field | What it tells you |
|---|---|
| `<VERDETTO>` | `AVANTI` (above the curve) / `INDIETRO` (below) / `IN-PARI` / `LOCKOUT-IMMINENTE` |
| `usage=<U>% vs curva=<I>%` | where you are vs where the ideal straight line `usage = target × elapsed / window` says you should be now |
| `<±D>pt` | the drift in budget points. **Under ±6pt it is measurement noise** — that is the guard's own step size |
| `sul target <T>% al reset` | the target the curve aims at. This is the `<T>` you need in §2 |
| `reset fra <M> min` | how much window is left. This is what turns a drift into an urgency |
| `ORA <C>s → CONSIGLIATO <R>s` | the current worker throttle, and the guard's **single group value**, in seconds |
| `worker: …` | the live workers the advice was computed on. Floor-exempt ones are **already excluded** — do not re-filter |

Two variants:
- on `LOCKOUT-IMMINENTE` an extra field appears **before** the last one: `il freno da solo non basta: valuta di ridurre il ROSTER (togli uno Scout, mai l'Analista o lo Scorer)`.
- if every live worker is floor-exempt, the last field becomes `nessun worker su cui agire (tutti esenti dal floor): decidi tu`.

> ⚠️ **The advised value is a level, not a distribution — and the `bulk-set` at the end of the line is a suggestion, not an order.** The guard derives that number from the **most-braked** worker and moves it one rung per ~6 points of drift, then offers it to every worker at once. Pasting that command *is* the levelling. Read the line as *"about this much rate has to go"*, then decide *whose* (§3) and *how much* (§4).

`LOCKOUT-IMMINENTE` (usage ≥95% **and** still above the curve) is the one verdict that is not about the throttle: the window is closing early, the brake is already near its ceiling, and the remaining lever is the **roster** — kill one Scout. Never the Analista or the Scorer: without them nothing gets scored and the user sees an empty screen.

If your pane was busy, the line is also in the mailbox: `python3 /app/shared/skills/bridge_mailbox.py drain`, entries with `kind:"pace-guard"`. Apply only the **last** one — replaying old advice means fighting your own past calibrations.

---

## 2. How much rate has to go

If the signal was a Sentinella `Throttle: N` order, the "how much" is already decided — skip to §3. Otherwise, one line:

```
vel_needed = (<T> − usage) / hours_to_reset       # the rate that lands exactly on target
f_team     = (vel_now − vel_needed) / vel_now × 100   # the share of the team rate to remove
```

`vel_now` is the team's current rate in budget %-points per hour: take it from `agent-speed-table.py` (`team.speed_pct_per_h`, §3) or from `rate-budget`. `f_team ≤ 0` means you have headroom → §5.

> 💡 **The same drift means different things depending on how much window is left**, and this is exactly what the guard's fixed "one rung per 6 points" cannot see. `+18pt` with 3 hours to go is a 7%/h correction: one agent, one rung up. `+18pt` with 20 minutes to go is a 54%/h correction, which no throttle can deliver — that is a roster decision, or an accepted early close. Always divide the drift by the hours remaining before deciding how hard to press.

---

## 3. WHO pays — the distribution

The point of this skill. Three inputs, in this order.

**a. Who is spending.** The throttle returns budget strictly in proportion to what an agent is actually consuming. Halving an agent at 2% of the team rate gives back 1%: a config write, a rung, and one of your turns spent for nothing. This is why the answer to "the team is 35% too fast" is never "everyone down 35%".

The per-agent shares live in the 15-min tick, which lands on the Sentinella — so pull your own:

```bash
python3 /app/shared/skills/agent-speed-table.py --since-min 60
```

Per agent it returns `pct_per_h` (budget points per hour) and `team_share_pct`, plus `throttle_options` (how much a given pause-per-hour would save). It skips anyone under 0.20 %/h for the same reason you should: throttling them changes nothing.

**b. Who is producing.**

```bash
python3 /app/shared/skills/db_query.py stats
```

Read `UNSCORED` (positions − scores) as the queue behind the Analista/Scorer, and the Writer queue as user-driven demand. A Scout burning 52% of the budget while `UNSCORED = 40` is buying input nobody can consume yet — the cheapest thing on the board to slow. The same Scout with `UNSCORED = 0` is feeding the whole pipeline, and slowing it stops the team producing anything at all.

**c. The grid.**

| | **Producing** | **Idle / blocked** |
|---|---|---|
| **High share** | slow it, but by **one rung**, then re-measure — it is paying for itself | **first to be slowed, hard** — and if it is already high on the ladder and still burning without output, the lever is KILL, not another rung |
| **Low share** | do not touch: you gain no budget and you lose throughput | do not touch either: it is already spending nothing, braking it returns nothing |

On top of the grid, the role asymmetry: the last agents you slow are the ones converting an existing backlog into a **scored** position (Analista, Scorer) — they are the difference between "50 positions sourced" and something the user can act on. The first is the one generating new raw input when the downstream queue is already deep (Scout). A Writer with an empty queue is not a lever in either direction.

**Concentrate on one or two agents.** The ladder is coarse — consecutive rungs are 20-60% apart — so a cut spread over five agents lands inside the noise for each of them, while the same cut on the top-share agent is a real, measurable change by the next signal.

**When you do brake two, give them different rungs.** The ladder is in prime minutes (1, 2, 3, 5, 7, 11, 13, 17, 23, 31, 41, 53, 60) on purpose: two workers pausing on the same value re-synchronise by construction, and their checkpoints then land together as a burst of simultaneous requests. `scout-1=660` + `analista-1=780` (11 and 13 min) collide far more rarely than both at 780.

---

## 4. HOW MUCH on that agent — and the command

You need the agent's **cadence** `c`: how many times per minute it reaches a checkpoint (`jht-throttle` call). Count it from the log:

```bash
python3 - <<'PY'
import collections, json, os, pathlib, time
p = pathlib.Path(os.environ.get("JHT_HOME", "/jht_home")) / "logs/throttle-events.jsonl"
cut = time.time() - 3600
c = collections.Counter()
for line in p.read_text(encoding="utf-8").splitlines():
    try:
        e = json.loads(line)
    except ValueError:
        continue
    if e.get("event") in ("checkpoint", "start") and e.get("ts_unix", 0) >= cut:
        c[e.get("agent")] += 1
for a, n in c.most_common():
    print(f"{a}: {n} chk/h -> cadence {n/60:.2f}/min")
PY
```

Then, to cut that agent's rate by a fraction `f_a`, from its current throttle `T_now`:

```
f_a   = f_team / share_a           # the whole team cut carried by this agent alone
ΔT    = (60 / c) × f_a / (1 − f_a) # seconds to ADD to its current throttle
T_new = T_now + ΔT                 # then pick the nearest rung yourself
```

`60/c` is the agent's current seconds-per-checkpoint. The `f/(1−f)` is not decoration: the pause also pushes the next checkpoint further out, so the cadence falls as you brake. A linear estimate (`ΔT = f × 60/c`) promises a cut it does not deliver.

Rungs, in seconds: `60 120 180 300 420 660 780 1020 1380 1860 2460 3180 3600`. `throttle-config.py` snaps whatever you pass to the nearest one, so **choose the rung yourself** — otherwise you will not know what you actually asked for. Verify with `dump`, which prints effective values.

**No cadence available?** Move exactly **one rung** and re-measure at the next signal. The ladder is coarse enough that one rung is always a meaningful, bounded step, and this is strictly better than guessing a number you cannot check.

### Worked example — distribute instead of levelling

```
[PACE-GUARD] AVANTI — CONSIGLIO, THROTTLE NON APPLICATO | usage=58% vs curva=40% (+18pt sul target 100% al reset) |
  reset fra 180 min | throttle worker ORA 300s → CONSIGLIATO 780s (+3 gradini) |
  worker: scout-1, analista-1, scorer-1, scrittore-1 |
  decidi tu e applica: python3 /app/shared/skills/throttle-config.py bulk-set scout-1=780 analista-1=780 scorer-1=780 scrittore-1=780
```

`agent-speed-table.py --since-min 60` says: team `speed_pct_per_h = 21.4`, and

| agent | `pct_per_h` | `team_share_pct` | cadence |
|---|---|---|---|
| scout-1 | 11.2 | 52% | 0.15/min |
| analista-1 | 6.0 | 28% | 0.12/min |
| scorer-1 | 3.0 | 14% | 0.10/min |
| scrittore-1 | 0.4 | 2% | 0.01/min |

**How much:** `vel_needed = (100 − 58) / 3.0 = 14.0 %/h` → `f_team = (21.4 − 14.0) / 21.4 = 35%`, i.e. **7.4 %/h has to go**.

**Who:** `db_query.py stats` says `UNSCORED = 40` — three hours of scoring work already banked, so more sourcing is worth little right now. The Scout alone spends more than the whole correction.

**How much on it:**
- `f_a = f_team / share_a = 35% / 52% ≈ 0.66` (same as `7.4 / 11.2`)
- `ΔT = (60 / 0.15) × 0.66/0.34 = 776s` → `T_new = 300 + 776 = 1076` → nearest rung **1020s (17 min)**
- effect: rate × `60/(60 + 0.15×720)` = 0.36 → **−7.2 %/h**, landing at 14.2 %/h ≈ target

```bash
python3 /app/shared/skills/throttle-config.py set scout-1 1020
python3 /app/shared/skills/throttle-config.py dump   # confirm the effective values
```

Analista, Scorer and Writer are left alone: the first two are what turn those 40 positions into scores, and the Writer would return 0.4 %/h even if stopped dead.

Now the levelling that the ready-made `bulk-set` would have produced — everyone to 780s: −6.1 from the Scout, **−2.9 from the Analista, −1.3 from the Scorer**, −0.03 from the Writer = −10.3 %/h. The team lands at 11.0 %/h and reaches **91% at reset instead of 100** — nine points of the user's paid budget thrown away — and it gets there with scoring throughput cut in half. Same signal, same tools, opposite outcome.

### Two agents

When one agent cannot carry the whole cut (or carrying it would starve the pipeline), split by share and keep the rungs different:

```bash
python3 /app/shared/skills/throttle-config.py bulk-set scout-1=660 analista-1=780
```

`bulk-set` is one atomic write — prefer it to two `set` calls.

---

## 5. Releasing the brake (`INDIETRO` / `MARGINE`)

Underspending is a distribution decision too — *whose* brake you release decides what the extra budget buys.

1. Release **the bottleneck role first** (`pipeline-triage` if you are unsure which it is). Releasing a Scout when the scoring queue is already 40 deep buys more backlog, not more results.
2. Workers never go below **5 min**, so "zero the throttle" does not exist for them. Once the bottleneck is back at the floor, the lever to spend more is **one more worker**, staged per C-02 — not a shorter pause.
3. **Never release everyone at once**: you oscillate straight into an overshoot at the next signal.

---

## 6. When NOT to act

An intervention costs one of your turns plus 15-45 min of blind time. Spend it only when the signal earns it.

- `IN-PARI`, or `|drift| ≤ 6pt` → **nothing**. That band is measurement noise.
- **One signal is noise, two consecutive are a trend.** A single overshoot right after a spawn is the new worker's boot cost.
- After any change, **wait 2-3 signals (≈30-45 min)**. A throttle only takes effect at the agent's *next* checkpoint, so a change made now is barely visible in the next measurement. Do not stack corrections you cannot see yet.
- Do not add `rate_budget live` probes just to double-check a fresh advisory — the extra calls inflate the Sentinella's `velocity_smooth` and induce wrong follow-up orders.
- **In the last ~15 min before reset, high usage is the target hit, not an overshoot.** 97% at reset is a bullseye; braking there only guarantees you leave budget unspent.
- If after 3 signals the same agents are still overshooting, double their durations (linear → geometric); if still underspending, halve.
- An `[URG]` from the Sentinella outranks a `[PACE-GUARD]`: apply it first, the next advisory re-measures.

---

## 7. Safety nets — not your lever

They exist because of a measured incident (the night of 2026-07-15, an uncontrolled burn that happened with both of them off) and they are **not part of the pacing decision**:

- **The 5-min worker floor.** Scout, Analista, Scorer, Scrittore, Critico never run below 300s, whatever you write. `set scout-1 60` on a worker is effectively 300s — `dump` shows the truth. Do not read a floor-clamped value as a change you made.
- **The daily hard-stop.** It is the last thing between the team and a lockout that leaves the user without answers for hours. You never disable it to spend more; if you need to spend more, the lever is parallelism (§5).
- The per-agent floor exemption exists for one case only: a time-boxed measurement of what a **single** worker produces without pauses. It is deliberately not a global switch — **one agent at a time, never the whole team**, and never as a way to go faster.

---

## Anti-patterns

- ❌ Pasting the `bulk-set` the `[PACE-GUARD]` line ends with. That number comes from the most-braked worker and is offered to all of them: applied everywhere it levels the team up to its slowest member and hits the roles that produce the user's result. The command saves you typing once you have decided the values — it does not decide them.
- ❌ Slowing an idle agent to "help". An agent that is not consuming gives nothing back when you brake it — you spent a write and a turn for zero points.
- ❌ Cutting across all agents because the verdict was team-level: you hit the cheap roles, which were returning nothing anyway, before the expensive one.
- ❌ Treating one signal as a permanent state, or stacking a second correction before the first is measurable.
- ❌ Braking on `AVANTI` when the rate has already fallen back in line — the drift is closing by itself and you end the window under target.
- ❌ Chasing pace with the throttle on `LOCKOUT-IMMINENTE`: the brake is nearly saturated there and only the roster moves the outcome.
- ❌ Pushing throttle numbers to agents over tmux (`[INFO] sleep 40s`). Always go through `throttle-config.py` — agents read the config file, they do not parse your tmux body. tmux is only for telling an agent to checkpoint *more or less often*, which is a different axis.

## See also

- `sentinel-orders` — the Sentinella's filtered orders, including `Throttle: N`, freeze and resume. That skill decodes the order; this one decides the split.
- `bridge-pacing` — how to read the 15-min tick's numbers when she forwards them to you.
- `throttle` — the `throttle-config.py` CLI reference and the per-agent state file.
- `pipeline-triage` — which role is the bottleneck, and when the answer is "spawn one more" rather than "release a brake".
- `scaling-calc` — roster + throttle plan when the answer is more workers, not a different pause.
- `agent-emergency` — a burner with cadence ~0 that keeps consuming without producing: the lever there is KILL, not another rung.
