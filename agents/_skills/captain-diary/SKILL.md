---
name: captain-diary
description: Daily handoff diary for the Captain. The Captain is restarted often (context-refresh, new work window, reboot) and otherwise loses the day's hard-won pacing lessons — repeating the same mistakes (e.g. 3 Scouts at once → an unbrakable spike → a 5h coast to repay the debt). Read the PREVIOUS day's notes at startup (handoff), and APPEND a one-line note whenever something significant happens during the day (a scaling decision, a spike, a kill, a lesson). One append-only file per day.
allowed-tools: Bash(python3 /app/shared/skills/captain_diary.py *)
---

# captain-diary — the handoff between Captains

One file per day in `$JHT_HOME/logs/captain-diary-YYYY-MM-DD.md`, append-only.
Its job is to keep you from **starting over at every restart**: today's pacing
lessons are handed to tomorrow's Captain.

## At wake (ALWAYS, before working)

Read the notes left by the previous day's Captain:

```bash
python3 /app/shared/skills/captain_diary.py handoff
```

It prints **yesterday's** notes (or those of the last day worked) plus whatever
is already recorded **today**. You inherit the lessons → **do not repeat the
same mistakes**. If there is nothing, you are the first: start recording.

## During the day — record the SIGNIFICANT events

One line, whenever something happens that carries a lesson. NOT a diary of
everything: only what tomorrow's Captain would need.

```bash
python3 /app/shared/skills/captain_diary.py add "20:05 — 3 Scouts at once: unbrakable \
spike within 15 min, 5h of coasting to repay the debt. Lesson: max 1 Scout then \
30 min of observation (C-02)."
```

What is worth recording:
- scaling decisions that went badly (or well) — how many workers, which throttle, what happened;
- a spike you could not brake and how you recovered from it;
- a kill and why;
- a pattern that emerged (e.g. "the Scout on site X consumes twice as much");
- anything that, if you knew it tomorrow, would avoid a mistake.

## Reviewing today only

```bash
python3 /app/shared/skills/captain_diary.py today
```

## Rule

- The diary is the **baton**: read it at boot, feed it during the day.
- Notes must be **short and actionable** (one fact + the lesson), not a verbose log.
- The timestamp is added by the tool: you write only the fact and the lesson.
