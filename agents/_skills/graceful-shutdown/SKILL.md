---
name: graceful-shutdown
description: Close the working day on request from the user. Triggered by a `[SHUTDOWN]` message from @utente. The user is closing the application and every agent is about to be killed mid-task; before that happens each one must record where it got to, so tomorrow the team resumes instead of restarting. Stop the agents one by one, then create the flag that lets the application exit. NEVER use this for routine pacing decisions — it ends the whole team.
allowed-tools: Bash(jht-tmux-send *), Bash(node /app/cli/bin/jht.js team *), Bash(touch /jht_home/.shutdown-ready.flag), Bash(python3 /app/shared/skills/captain_diary.py *)
---

# graceful-shutdown — closing the day when the user leaves

The user is closing the application. Without you the agents would be cut off
mid-work: a Scout halfway through a board sweep, a Writer with a half-written
CV. **Your job is that nobody loses the point they had reached.**

The game sent you `[@utente -> @capitano] [SHUTDOWN] …` and is now **waiting for
a flag from you**: until you create it, the window stays open and shows the user
how many agents are still working.

## Procedure

1. **Ask everyone to write down where they are and stop.** To every live session
   send:

   ```bash
   jht-tmux-send SCOUT-1 "[@capitano -> @scout-1] [SHUTDOWN] Shutdown requested by the user. Write in your agenda where you got to (last board, last position saved, what is left), then stop. Do not start new work."
   ```

   One line per agent, with its real name. Whoever is writing to disk finishes
   the current file: interrupting a write is worse than waiting a few seconds.

2. **Record the day yourself** in the diary, so tomorrow's Captain picks up the
   thread:

   ```bash
   python3 /app/shared/skills/captain_diary.py append "Shutdown requested by the user: <who was doing what>"
   ```

3. **Stop the agents** once they have confirmed (or after a reasonable wait: do
   not keep the user waiting more than a couple of minutes for an agent that
   does not answer):

   ```bash
   node /app/cli/bin/jht.js team stop --all
   node /app/cli/bin/jht.js team stop assistente
   ```

4. **Create the flag.** It is the last thing you do: it tells the game it can
   shut the container down and exit.

   ```bash
   touch /jht_home/.shutdown-ready.flag
   ```

## Rules

- **The flag must ALWAYS be created**, even if something went wrong. If you do
  not create it, the user is left staring at a window waiting for you — and will
  end up force-quitting, which is exactly what this skill prevents.
- **Do not negotiate the shutdown.** The user has decided: your job is to make
  it orderly, not to argue with it or postpone it.
- **No new work** from the moment you receive `[SHUTDOWN]`: no spawns, no new
  sweeps, no scaling up.
- If an agent does not answer, note it in the diary and move on: better to lose
  the resume point of ONE agent than to block the shutdown for everyone.
