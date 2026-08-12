---
name: team-modes
description: The team-mode manual — one card per mode (search / harvest / care / calibration / saving). Open it whenever the hourly [MODALITÀ CORRENTE] banner names a mode and you do not remember what it implies operationally, at wake after a context refresh, or when the user switches mode from the game. The mode is ALWAYS the user's choice - this skill tells you how to RUN the current one, never to change it.
allowed-tools: Bash(python3 /app/shared/skills/mode_banner.py *), Bash(python3 /app/shared/skills/db_query.py *), Bash(python3 /app/shared/skills/feedback_query.py *), Bash(python3 /app/shared/skills/team_directives.py *)
---

# team-modes — what the current mode means, in thirty seconds

The team has one persistent mode at a time. It lives in
`$JHT_HOME/profile/capitano-maintenance.json` (historical filename — do NOT
expect a renamed file) under the key `"mode"`, a **closed enum of five
values**. The hourly `[MODALITÀ CORRENTE]` banner carries the compact spec;
this skill is the full card. If the banner and your context disagree, **the
file on disk wins** — your context may have been wiped by a refresh.

| value | meaning |
|---|---|
| `search` | default: accumulate (scout → analysis → score) |
| `harvest` | stop sourcing, convert the best already-found positions into CVs |
| `care` | keep the found portfolio fresh: cadenced recheck, discard expired (C-18) |
| `calibration` | read the user's feedback and re-aim the search **priority** |
| `saving` | bare survival minimum, no autonomous enrichment |

- **No file → `search`.** Legacy values: `"normal"` → search, `"maintenance"`
  → care (live installs still carry them — honor them, same mode).
- **File present but unreadable → mode `sconosciuto`**: treat it as an ACTIVE
  order (sourcing stays off), open the file yourself before deciding anything.
- A value outside the enum is still an order from the user: report it, do not
  normalize it away.

Every mode declares **four things** — the same four the banner compresses:
**(1)** which queues are active, **(2)** what is suspended, **(3)** where the
budget goes, **(4)** when its work is DONE. Point 4 is the one that was
missing historically: no mode ended by itself, and a team once sat 18 days in
maintenance with nobody noticing. When the banner says the mode's work is
exhausted, **tell the user** — never switch mode on your own, but silence is
not allowed either.

The `orders` vocabulary (`stop_search`, `discard_expired_rotating`,
`cv_min_score`, `pre_check_liveness_for_cv`, plus hand-written keys) composes
with EVERY mode: an explicit key in `orders` always overrides the mode's
default. A live production VPS runs `care` with those orders active today.

---

## `search` — ricerca (default: accumulate)

1. **Active queues**: the full pipeline — Scouts source, `next-for-analista`,
   `next-for-scorer`; Scrittore/Critico stay on-demand (C-10).
2. **Suspended**: nothing. C-05/C-05c (anti-idle sourcing) are in force.
3. **Budget priority**: sourcing first, then analysis/score; balance the
   intake toward SCORED positions (the shortlist is the product).
4. **Exit condition**: none — continuous mode. It does not finish; the user
   moves you out of it (typically to `harvest` or `care` when the scored
   backlog outgrows their reading time).

**What you do**: normal regime — C-02 staged calibration, C-07 throttle
ladder, C-09 weekly awareness. **With C-25**: `[SCOUT-ESAUSTO]` + downstream
queues empty + headroom → C-25's default useful work is already this mode's
work; keep the pace at target, never idle with headroom. **Do NOT**: treat
"no file" as "no rules" — the board (`team_directives`) still applies.

## `harvest` — raccolto (stop sourcing, convert the best)

1. **Active queues**: the already-found portfolio, best score first. CV flow:
   `next-for-scrittore` (user-flagged) plus the positions the user picks when
   you surface the top of the shortlist; Critico reviews as usual.
2. **Suspended**: sourcing — **NO Scout** (`stop_search` defaults to true:
   C-05/C-05c suspended, the `new` queue empty is the WANTED state).
3. **Budget priority**: Scrittore/Critico first; Analista only for the
   pre-CV liveness check (`pre_check_liveness_for_cv` — never write a CV for
   a dead offer).
4. **Exit condition**: no live position ≥ the CV threshold
   (`orders.cv_min_score`, default 75) is left without a CV. The banner
   evaluates this read-only against the DB; when it says HARVEST DONE,
   report it to the user and ask where to go next.

**What you do**: kill/do-not-spawn Scouts; spawn Scrittore on-demand per
C-10 as the user flags positions; keep the flagged queue moving; surface the
best unwritten positions to the user so they can flag them. **With C-25**:
harvest exhausted + budget headroom → surplus goes back to sourcing (1 Scout,
normal pacing) UNLESS the user explicitly forbade sourcing (board, C-26) —
then you stay put and tell the user there is spare budget. **Do NOT**: write
CVs for positions below the threshold "to use the budget", or spawn Scouts
"to avoid idling" while unwritten candidates remain.

## `care` — cura (keep the portfolio fresh; full rule: C-18)

1. **Active queues**: `next-for-recheck-due` (live, score ≥ 70, >14 days,
   best first, via `recheck-batch`), `next-for-geocode-missing`,
   `next-for-logo-missing`, plus the expired set (`discard_expired_rotating`).
2. **Suspended**: sourcing with `stop_search: true` (its default here) —
   C-05/C-05c suspended.
3. **Budget priority**: portfolio upkeep, spread over the active hours (slow,
   steady — never front-loaded); CV only on user request and ≥
   `cv_min_score` (default 90).
4. **Exit condition**: ALL FOUR care queues empty. The 14-day cadence will
   re-mature positions, so "done" is done-for-now — the banner says so, and
   per C-18 point 4 + C-25 the surplus goes back to sourcing unless forbidden.

**What you do**: Analisti are the engine — one distinct queue per instance
(C-13), stated in the kick-off. Exclusion of a position is ALWAYS the
Analista's judgment, never a script's. The enrichment queues honor
`enrichment-policy.json` IN CODE: a queue that comes back empty with a policy
reason is a wanted state, not a bug. **Do NOT**: burn all rechecks in one
shot, retry a policy-disabled queue, or spawn Scouts while care queues have
work.

## `calibration` — calibrazione (re-aim the search priority)

1. **Active queues**: the user's feedback (`feedback_query.py recent` — it
   lives on the cloud), the score profile, the `role_family` taxonomy.
2. **Suspended**: mass sourcing — until the priority is updated, new
   positions would be found with the OLD aim (that is the waste this mode
   prevents). `stop_search` defaults to true.
3. **Budget priority**: reading feedback + re-aiming: adjust search
   priorities/circles for the Scouts, re-score the affected positions in a
   bounded batch if the criteria shifted.
4. **Exit condition**: the recent feedback batch has been read and the
   priority updated. NOT machine-checkable from disk (feedback lives on the
   cloud) — the banner says "not evaluable" by design; YOU declare completion
   to the user, with what changed (e.g. "de-prioritized on-site Berlin,
   boosted fintech — 12 positions re-scored").

**What you do**: pull feedback, extract the pattern (what they liked/hidden/
starred), translate it into scout priorities and — if warranted — a bounded
re-score. Then report and wait for the user to switch mode. **With C-25**:
calibration done + headroom → surplus back to sourcing (now with the NEW
priority) unless forbidden. **Do NOT**: re-score the whole DB, invent
preferences the feedback does not show, or keep sourcing with the old aim.

## `saving` — risparmio (survival minimum)

1. **Active queues**: none autonomous. Only what the user explicitly asks:
   chat replies, tickets (C-15), user-driven flags (write/geocode/recheck
   requested — those never pass through a policy).
2. **Suspended**: sourcing AND every autonomous enrichment (recheck, geocode,
   logo). Workers not needed for pending user requests are killed or left
   unspawned.
3. **Budget priority**: near zero. The only spend is answering the user.
4. **Exit condition**: `mode_until` if the user gave one — at that date the
   mode expires **on its own**, orders included, and the team is back in
   `search` (the file still says `saving`: the deadline wins, and the banner
   declares it). Without `mode_until` it lasts until the user lifts it, and
   that is worth saying out loud: the weekly budget is a **window, not a
   balance** — whatever is unspent at the reset is destroyed, so a saving left
   by inertia does not conserve the cycle, it discards it. Tell the user they
   can give it an end date, and where: the Console has an «Until when» field
   (days and hours, next to the mode selector), and from a shell it is
   `jht coordinator set-mode saving --until <iso>`. Both write the same key in
   the same file.

**What you do**: keep Capitano/Assistente/Mentor responsive; nothing else
moves without a direct user request. **With C-25**: saving IS an explicit
user prohibition on autonomous spend — C-25 does NOT unlock sourcing here;
if budget is going to waste, you TELL the user (that is C-25's other half),
you do not spend it. **Do NOT**: reinterpret "minimum" as "a little sourcing
won't hurt".

---

## Cross-mode rules

- **C-25 (never waste the budget)** composes with every mode: mode's own work
  DONE + headroom → default useful work is sourcing at 1-Scout pace — except
  where the mode or the user explicitly forbids spend (saving; an explicit
  board prohibition), where the correct move is reporting the spare budget.
  C-25 never overrides a brake: weekly/daily caps, `work_phase=OFF`, C-23
  gates and user throttles all win.
- **Pacing gates are mode-independent**: no mode authorizes bursting or
  ignoring `vel_target`; a mode only changes WHERE the paced budget goes.
- **Exit ≠ switch.** When a mode reports its work exhausted, notify the user
  and keep honoring the mode until THEY change it. The file is written on the
  user's behalf — by the game Console (deadline included) or by
  `jht coordinator` when they ask for it — and never on your own initiative.

## See also

- `mode_banner.py` (`shared/skills/`) — composes the hourly banner from disk;
  `python3 /app/shared/skills/mode_banner.py show` re-reads it on demand.
- **C-18** in your identity file — the full care-mode rule.
- `sentinel-orders`, `pipeline-triage`, `scaling-calc` — the levers each mode
  points at different queues.
