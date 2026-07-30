---
name: session-refresh
description: "Doctor-only. Context-refresh round: for each agent session read its real context occupancy (provider client-side command, zero tokens) and refresh ONLY sessions whose context window is >50% full — do a retrospective (capture + interview + analytics), append a dense synthesis to the growing daily journal, then KILL + recreate + resume the session with continuation context, so its context window is cleared without losing where it was. Runs 2× per work window (at +30min and at mid). Skips fresh, low-context (≤50%), and Capitano-parked sessions — EXCEPT past the 12h session TTL (JHT_AGENT_MAX_SESSION_AGE_H), which overrides every skip: age alone decides, no exceptions."
allowed-tools: Bash(tmux *), Bash(python3 *), Bash(bash /app/.launcher/start-agent.sh *), Bash(jht-tmux-send *), Bash(/app/agents/_skills/tmux-send/jht-tmux-send *), Bash(sleep *), Bash(cat *), Bash(grep *), Bash(echo *)
---

# session-refresh — clear agent context, keep continuity

You (the Dottore) are spawned at a scheduled slot (`+30min` from the work-window start, or at `mid` window). Your job this round is **not** liveness-pinging — it is to **refresh the context** of the active agent sessions: each long-running session accumulates a bloated context window; you summarize what it did, persist it, then recreate the session fresh and hand back the continuation.

> Why this exists: the old Dottore burned ~51% of team budget pinging `[HEALTH]` every 2h with zero useful checks. This round is rare (2×/window) and produces a durable, dense journal of the team's work.

## Step 0 — window start (the analytics window)
```bash
WIN_START=$(python3 -c "import sys; sys.path.insert(0,'/app'); from shared.skills.working_hours import current_window_bounds as b; w=b(); print(w[0].isoformat() if w else '')")
# 24/7 (no window): fall back to the last 6h
[ -z "$WIN_START" ] && WIN_START=$(python3 -c "import datetime; print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(hours=6)).isoformat())")
ROUND_ID=$(date -u +%Y%m%dT%H%M%SZ)
DAY=$(date -u +%F)
JOURNAL=/jht_home/logs/doctor-retrospective.jsonl
```

## Step 1 — list sessions + age, decide order
```bash
tmux list-sessions -F '#{session_name}|#{session_created}'
```
- **Order**: worker sessions FIRST (`SCOUT-N · ANALISTA-N · SCORER-N · SCRITTORE-N · CRITICO-S*`), coordinators LAST and with care (`ASSISTENTE · MENTOR · SENTINELLA · CAPITANO`). "With care" means **capture their state well and compact them — NOT skip them** (they are the top consumers; see Rules). Never refresh `DOTTORE` / `DOCTOR-WATCHDOG` (yourself / the scheduler).
- **FRESH skip** (cheap pre-filter before the context check): `age = now - session_created`. If `age < 40 min` → SKIP entirely (nothing to summarize yet, and refreshing would throw away a session that just started). Log `action=skipped_fresh`. Everything that survives this pre-filter goes through **Step 1.4 (TTL)** and then **Step 1.5 (context check)** — that `>50%` measurement, not age, is what decides the *ordinary* refresh.

## Step 1.4 — TTL: **every agent session lives at most 12 hours**
```bash
TTL_H="${JHT_AGENT_MAX_SESSION_AGE_H:-12}"
AGE_H=$(( ( $(date -u +%s) - $(tmux display-message -p -t "$S" '#{session_created}') ) / 3600 ))
[ "$AGE_H" -ge "$TTL_H" ] && echo "TTL EXPIRED ($AGE_H h) → refresh MANDATORY"
```
**If `AGE_H ≥ TTL_H` the session is refreshed. Full stop.** The TTL is checked **before**
everything else and **overrides every skip in this skill** — there is no exception, no
override, no "but":

| would normally skip | past the TTL |
|---|---|
| `skipped_fresh` (age < 40min) | impossible past 12h, but the TTL wins anyway |
| `skipped_lowctx` (context ≤ 50%) | **ignored** — a session at 4% after 30h is still refreshed |
| `skipped_parked` (PARKED, Step 4) | **ignored** — parked or not, the TTL applies |
| "the agent is working" | **ignored** — capture its state in the seed and recreate |
| outside the working-hours window | **ignored** — the TTL is never suspended (see Rules) |

Log `action=recreated` with `reason=ttl` and the measured `session_age_h`. Then go straight
to Steps 2 → 7 (capture, analytics, synthesis, recreate + resume): **skip Step 1.5 and
Step 4 entirely**, they can only produce a skip and a skip is not available here.

Why age alone, with no health heuristic on top: in the 2026-07-28/29 incident the sessions
were **38.5 · 29.5 · 27.0 · 14.5 · 14.2 hours** old, every heuristic reported "healthy", and
the team was paralysed for eleven hours. Contexts were under 50%, so nothing touched them.
A TTL has no heuristics to get wrong.

## Step 1.5 — CONTEXT CHECK (the *ordinary* refresh trigger: **>50%**)
Only for sessions that did **not** trip the TTL in Step 1.4.
**Refresh ONLY sessions whose context window is more than 50% full.** Read the real occupancy with the provider's **client-side** context command — it costs **zero tokens** (rendered locally, no LLM call) and is instant. Age is NOT the trigger anymore: an old-but-empty session (e.g. an idle Mentor at 2%) must be SKIPPED, a bloated session must be refreshed.

Two hard requirements — ignore them and you *burn* budget instead of saving it:
- The session MUST be **idle** (no active turn). If a spinner / `esc to interrupt` is showing, it's working → SKIP this round (the next Doctor catches it). Never send keys mid-turn.
- **Clear the input line first.** Otherwise the command concatenates with residual text and gets submitted as an LLM prompt (burns tokens). Send `Escape` then `C-u` before typing.

```bash
S=<session>
# provider → command:  claude → /context   ·   codex → /status   ·   kimi → (verify on its TUI)
tmux send-keys -t "$S" Escape; sleep 1
tmux send-keys -t "$S" C-u;    sleep 1          # clear the input line (mandatory)
tmux send-keys -t "$S" "/context"; sleep 1
tmux send-keys -t "$S" Enter;  sleep 3
PCT=$(tmux capture-pane -p -t "$S" | grep -aoE '[0-9.]+k?/[0-9.]+[km] tokens \([0-9]+%\)' | tail -1 | grep -aoE '\([0-9]+%\)' | tr -dc '0-9')
tmux send-keys -t "$S" Escape                   # dismiss the panel
echo "context=$PCT%"
```
Decide from `$PCT` (parsed from a line like `24.9k/1m tokens (2%)`):
- **`PCT` ≤ 50** → SKIP **unless the TTL tripped in Step 1.4**. Do NOT recreate an under-TTL session, even if it is old-ish. Log `action=skipped_lowctx` with the measured `%`. Move to the next session.
- **`PCT` > 50** → proceed to refresh (Steps 2–7).
- **command didn't render / parse failed** → fall back to the age heuristic (`age ≥ 40min` → refresh) and log `ctx=unparsed`.

## Step 2 — per session: capture (wide + salient)
Capture the WHOLE scrollback once, then the salient lines — do NOT load thousands of lines into your own context, grep the highlights:
```bash
tmux capture-pane -p -S - -t "$S" > /tmp/cap_$S.txt          # full scrollback to file
tail -n 60 /tmp/cap_$S.txt                                    # recent state
grep -nE '\[ERROR\]|Traceback|throttle|EXCLUDED|inserted|\[FEEDBACK\]|\[RETRO\]|spawn|Killed' /tmp/cap_$S.txt | tail -40   # salient moments
```

## Step 3 — analytics (objective numbers, not just the agent's story)
```bash
python3 /app/shared/skills/doctor_analytics.py "$S" "$WIN_START"
```
Returns JSON: `produced{found,analyzed,scored,written,reviewed}`, `communications{sent,received,top_peers}`, `throttles{events,max_sleep_s}`, `last_captain_msg`, `session_age_h`, `role`, `instance`.

## Step 4 — PARKED check (data-driven, do NOT guess)
A session is **PARKED** (the Capitano deliberately left it on but is not using it — e.g. a Scout left over from the previous window that the Capitano did not assign today) when **all** hold:
- age ≥ 40min (not fresh), AND
- `produced` is all-zero in the window, AND
- `last_captain_msg` is null or older than the window start.

If PARKED → **do NOT recreate to restart it**. Write the synthesis (Step 6) with `action=skipped_parked` and move on. (Recreating it would turn a deliberate park into work the Capitano did not want.) If you do recreate it for hygiene, the resume message MUST say it was idle: `[RESUME] you were in STANDBY — stay idle until the Capitano assigns you a queue.`

**Two hard exceptions to PARKED — this rule described the incident exactly and kept the Doctor's hands off precisely when the team needed it most:**
1. **Past the TTL (Step 1.4), PARKED does not apply.** Parked or not, a 12h+ session gets recreated.
2. **A blocked agent is not a parked agent.** "not fresh + produced == 0 + no recent captain message" is also the exact fingerprint of a team whose coordination is broken. The objective signal that separates them: **an agent retrying at another agent with no answer is not parked, it is blocked** (the `retry_loop` entries from `agent-unblock`'s scan, and the pane shows the attempts). Same for "every operative idle while quota is available". In those cases do NOT log `skipped_parked` — clear the block (`agent-unblock`), then continue this round.

## Step 5 — interview the agent
```bash
/app/agents/_skills/tmux-send/jht-tmux-send "$S" "[@dottore -> @${s_lower}] [RETRO] Inizio-giornata: 1) intoppi in questa sessione? 2) imparato qualcosa di utile? 3) cosa stavi facendo proprio ora (per il resume)? Rispondi denso, 3-4 righe."
sleep 45
tmux capture-pane -p -S -40 -t "$S" | tail -25   # read the reply
```
(Skip the interview for PARKED/fresh sessions — there is nothing in-flight to ask about.)

## Step 6 — append the DENSE synthesis (append-only, grows daily)
One JSONL entry per agent per round. Combine analytics + interview into a tight summary. NEVER overwrite — multiple Doctors across the day all append.
```bash
python3 - "$S" "$ROUND_ID" "$DAY" "$JOURNAL" <<'PY'
import json, sys, datetime
session, round_id, day, journal = sys.argv[1:5]
entry = {
  "ts": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00","Z"),
  "round_id": round_id, "day": day,
  "timing": "start+30",          # or "mid"  — set to the slot you were spawned for
  "session": session, "role": "<role>", "session_age_h": 0.0,
  "analytics": { },              # paste the doctor_analytics.py JSON here
  "interview": {"intoppi": "...", "imparato": "...", "summary_denso": "..."},
  "action": "recreated",         # recreated | skipped_lowctx | skipped_parked | skipped_fresh
  "context_pct": 0,              # measured context occupancy from Step 1.5 (the >50% gate)
  "resume_msg_sent": False,
}
with open(journal, "a") as f:
    f.write(json.dumps(entry, ensure_ascii=False) + "\n")
print("appended", session)
PY
```

## Step 7 — recreate + resume (if the TTL tripped, OR context **>50%** and NOT fresh, NOT parked)
Atomic refresh — you already captured the context in Step 2, so killing is safe:
```bash
ROLE=<role>; N=<instance>      # from analytics; recreate the SAME number (no dice — the die is for NEW spawns only)
tmux kill-session -t "$S"
bash /app/.launcher/start-agent.sh "$ROLE" "$N"
sleep 8
# CAPITANO only: the [MODALITA' CORRENTE] section, read FROM DISK right now (never
# from the context you are throwing away). Same section heartbeat-bridge.py injects
# every hour. Workers do not get it — the mode is applied by the Capitano.
MODE=""
if [ "$ROLE" = "capitano" ]; then MODE=" $(python3 /app/shared/skills/mode_banner.py line)"; fi
/app/agents/_skills/tmux-send/jht-tmux-send "$S" "[@dottore -> @${s_lower}] [RESUME] Contesto pre-refresh: stavi facendo <X>; avevi completato <Y> (analytics: produced=<...>); il prossimo passo era <Z>. Riprendi da li'. Coda: <next-for-role>.$MODE"
```
Set `resume_msg_sent=True` in the journal entry. Then move to the next session (pace ~15-20s between agents).

## Rules
- **The 12h TTL has no loopholes and no off-switch.** `JHT_AGENT_MAX_SESSION_AGE_H`, default `12`. Neither PARKED, nor skip-fresh, nor the context threshold, nor "it is working", nor the working-hours gate can cancel it. **Stagger it**: sessions are born in waves and would expire together — refresh at most one over-TTL session per pass and order them by **decreasing age**, so the oldest goes first and the team is never recreated all at once.
- **Outside the working-hours window the round does not run — but the TTL still does.** The round is skipped at night because interviewing agents would burn budget for nothing; a 30-hour session is recreated anyway, because one kick-off costs nothing next to a lost day. `agent-watchdog.sh` enforces the same ceiling deterministically (same env var) for when the Doctor is stopped, blocked or never spawned — which is exactly what happened on 2026-07-28/29. Both paths are meant to exist: this one is the *rich* refresh (retrospective + resume), that one is the safety net that guarantees the ceiling at any cost.
- **`working_hours: null` (or absent, or empty) means NO time restriction** — the team is 24/7 and the round runs normally. It never means "always outside the window". In the incident `working_hours` was null exactly because the user's answer about the timezone was the line stuck in the Capitano's composer.
- **Unblock before you refresh.** Run the `agent-unblock` phase first: refreshing a paralysed team just recreates the paralysis with a clean context window.
- **One Doctor does all sessions this round** (user order: single Doctor for now). Use the file-based capture + grep so you never blow your own context window.
- **CAPITANO & SENTINELLA are the TOP token consumers** (their context is almost always bloated — the Sentinella ticks every ~15min, the Capitano coordinates continuously). They still go through the **>50% context gate** like everyone else (Step 1.5) — but in practice they measure well above 50%, so they get refreshed almost every round. Do them **last** (after the workers), and **compact, don't reset** — the dense-synthesis refresh preserves continuity, a raw kill loses it. If one measures ≤50% (rare), skip it that round like any other low-context session.
- **CAPITANO**: it's the coordinator with in-flight state (worker assignments, active throttle config, last pacing order, pending decisions). In the interview (Step 5) explicitly capture that coordination state and put it in the seed (Step 7) so it doesn't lose the thread. **If `$JHT_HOME/profile/capitano-maintenance.json` exists, read it and put its active `orders` (maintenance mode + `stop_search` / `discard_expired_rotating` / weekly-recheck / geocoding) in the seed too** — dropping that maintenance order from the seed silenced an entire maintenance week on 2026-07-12 (the Capitano then re-reads the file anyway per its own rule C-18, but carry it forward so it never depends on that). **And append to the `[RESUME]` the `[MODALITÀ CORRENTE]` section produced by `python3 /app/shared/skills/mode_banner.py line`** — the same one `heartbeat-bridge.py` injects every hour, read from disk and not from the context you are throwing away: that way the order depends neither on you summarising it well nor on your round running at all (it did not, and eighteen days of maintenance went missing). Capitano only: workers never get it. Do it LAST; if it's handling a live EMERGENZA (visible orchestration in the pane right now), let it stabilize first, otherwise compact it.
- **SENTINELLA**: it is **near-stateless** — its working state lives in the bridge/config and `sentinel-data.jsonl`, not in its chat. That makes it the **safest and highest-value to compact**: refresh it every round, last, with a minimal seed: `[RESUME] sei la Sentinella; il tuo stato vive nel bridge + sentinel-data.jsonl — riprendi il monitoraggio del pacing dal prossimo tick.` The `agent-watchdog` age-based recreate (past `JHT_SENTINELLA_MAX_CTX_AGE_H`, default 24h) stays only as a **fallback** for when the Dottore isn't running; since you now compact it every round it won't reach that age, so there is no race.
- **Never** `tmux new-session` by hand — always `start-agent.sh` (see `spawn-agent`).
- Log every action in the journal (`recreated`/`skipped_lowctx`/`skipped_parked`/`skipped_fresh`) with the measured `context_pct` — the journal is the audit trail and grows every day.
