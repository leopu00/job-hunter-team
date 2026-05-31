---
name: feedback-query
description: Read user feedback (like/dislike/hide/star) for a given position from the cloud. Used by the Scorer to apply a multiplier on the final score and by the Scout as a contextual signal. Returns a neutral "no signal" payload when cloud is disabled or unreachable, so callers never hard-fail.
allowed-tools: Bash(python3 *)
---

# feedback-query — User feedback per position

The user can click like/dislike/hide/star on any position from the web dashboard. Those clicks are stored in Supabase `position_feedback` (mig 019) and surfaced to agents via this skill. Schema:

| Column              | Type   | Meaning |
|---------------------|--------|---------|
| `position_legacy_id`| TEXT   | The `legacy_id` (string) of the position in `positions` |
| `action`            | TEXT   | One of `like`, `dislike`, `hide`, `star` |
| `reason`            | TEXT   | Optional free text from the user |
| `created_at`        | TS     | Submission time |

The skill calls `GET /api/positions/{legacy_id}/feedback` on the cloud (using the bearer token in `$JHT_HOME/cloud.json`). On cloud-disabled or network failure, the skill **does not error** — it returns `ok=true, latest_action=null` with a `note` field. Agents must keep going.

## Single position lookup

```bash
python3 /app/shared/skills/feedback_query.py check <legacy_id>
```

Output (JSON on stdout):

```json
{
  "ok": true,
  "legacy_id": "42",
  "latest_action": "dislike",
  "count": 2,
  "actions": [
    {"action": "dislike", "created_at": "2026-05-30T14:21:00Z", "reason": "too senior"},
    {"action": "like",    "created_at": "2026-05-28T09:00:00Z", "reason": null}
  ]
}
```

`latest_action` is the most recent click. `actions[]` is ordered DESC by `created_at`. Empty when no feedback exists:

```json
{"ok": true, "legacy_id": "99", "latest_action": null, "count": 0, "actions": []}
```

When cloud is disabled or the endpoint is unreachable, the skill returns:

```json
{"ok": true, "legacy_id": "...", "latest_action": null, "count": 0,
 "actions": [], "note": "no-signal (cloud-disabled)"}
```

## How agents use it

**Scorer** (mandatory at scoring time):
1. After computing the base score (sum of weighted components), call `feedback_query check <legacy_id>`.
2. Apply multiplier based on `latest_action`:
   - `like` → final_score = round(base * 1.10), add note `feedback:like+10%`
   - `star` → final_score = round(base * 1.15), add note `feedback:star+15%`
   - `dislike` → final_score = round(base * 0.85), add note `feedback:dislike-15%`
   - `hide` → status=`excluded`, note `feedback:hide`, skip writing score
   - `null` → no change
3. Cap final score at 100 after multiplier.

**Scout** (optional contextual signal):
- Not for per-position skip — that's already handled by dedup (SC-05).
- Use it sparingly when re-evaluating a known position (e.g., promotion logic): if the user explicitly disliked it, do not re-surface even if dedup would normally rescore it.

## Notes

- The skill is **read-only**. Writes happen only from the browser via POST `/api/positions/{legacy_id}/feedback`.
- The bearer token comes from `cloud.json`; no separate env var needed.
- 10s timeout per call. If you batch-process many positions, expect ~50–200ms per call. For bulk runs, batch into the loop with throttle pauses as usual.
