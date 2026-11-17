---
name: recheck-batch
description: Paced recheck of CARE MODE at minimum cost. The script does the mechanical work on a batch (tiered check of every URL, updates last_checked for the verified OPEN ones); you judge ONLY the ambiguous cases. Measured at 78-86kT per position with the manual round — with the batch you spend one turn for 10 positions, not 10 turns. Exclusion is ALWAYS your decision, never the script's.
allowed-tools: Bash(python3 /app/shared/skills/recheck_batch.py *), Bash(python3 /app/shared/skills/db_update.py *), Bash(python3 /app/shared/skills/recheck_liveness.py *)
---

# recheck-batch — the care mode recheck, without wasting a turn per position

## Why it exists
Rechecking an ALREADY analyzed position is a fraction of checking a new
position: no re-analysis, no re-reading of the JD, no metadata. The manual
round (queue → one position → recheck-liveness → db_update → repeat) cost
78-86kT per position because every step was an LLM turn. This batch
compresses the whole mechanical part into ONE command.

## How to use it (ONE turn per batch)
```sh
python3 /app/shared/skills/recheck_batch.py            # batch di 10 dalla coda
python3 /app/shared/skills/recheck_batch.py --limit 5
```
It takes the positions from the `next-for-recheck-due` queue (alive, score ≥
policy, not verified for > 14 days, SCORE DESC: best ones first) and for each
one runs the tiered check of `recheck_liveness.py` (curl → browser, never a
false-open).

The report has three outcomes:
- **OK open and updated** — verified `OPEN`: `last_checked` is already
  updated, they leave the queue for 14 days. **Don't touch them, don't
  re-read them, zero work for you.**
- **TO JUDGE** — evidence of closure (404/410, closed-marker, or a past
  `expires_at`). This is where YOU come in.
- **NOT VERIFIABLE** — JS/authwall host and inconclusive browser. This is
  where YOU come in (one-shot).

## The judgment is yours — the script NEVER excludes (user order 2026-07-30)
A static script can be wrong and throw away a position that is still alive.
For each position **TO JUDGE**: look at the reported evidence; if needed,
ONE single direct look at the page. If you are 100% sure it is
expired/closed:
```sh
python3 /app/shared/skills/db_update.py position <ID> --status excluded \
  --is-open false --last-open-check now --notes "[SCADUTO] <evidenza>"
```
If instead it is still alive (a false positive of the script):
```sh
python3 /app/shared/skills/db_update.py position <ID> --is-open true --last-checked now
```
For each **NOT VERIFIABLE** one: one-shot with the browser on the URL; then
decide as above. If it stays unverifiable → `--last-checked now` + note
`[OPEN_UNVERIFIED]`, `is_open` unchanged (never pass it off as open).

## Cost discipline (the point of the skill)
- **One batch = one turn.** Don't do a round per position, don't re-analyze,
  don't re-read JD or company: the recheck only decides "still open?".
- Bounded batch (default 10): do NOT raise the limit to "finish the queue in
  one go" — the cadence spreads the work, the Capitano paces it (C-09/C-18).
- Queue OFF by enrichment-policy = intended state: stop, don't work around it.
