---
name: feedback-query
description: Read user feedback (like/dislike/hide/star) from the cloud — one position at a time, or aggregated over a window. Used by the Scorer as contextual preference evidence for future positions while excluding the current position, by the Mentor to count recurring reasons (Pattern F), and by the Scout as a contextual signal. Returns a neutral "no signal" payload when cloud is disabled or unreachable, so callers never hard-fail.
allowed-tools: Bash(python3 *)
---

## Raw/display boundary (`RAW_DISPLAY_BOUNDARY`)

The `reason` of a judgement is a **code** of a closed list (`too_senior`, `too_junior`, `wrong_location`, `salary_low`, `wrong_stack`, `company`, `scam_or_gone`, `closed`, `already_applied`, `other`). What the user writes in their own words is a private note that this skill never returns: there is no text of the user in any field, and nothing to quote, relay or paraphrase. Theme `label` is a fixed phrase for the code. A `note` is only a closed `no-signal:*` enum: treat it as availability state and never turn it into infrastructure detail.

# feedback-query — User feedback per position

The user can click like/dislike/hide/star on any position from the web dashboard. Those clicks are stored in Supabase `position_feedback` (mig 019 base + mig 028 extended) and surfaced to agents via this skill. Schema:

| Column              | Type    | Meaning |
|---------------------|---------|---------|
| `position_legacy_id`| TEXT    | The `legacy_id` (string) of the position in `positions` |
| `action`            | TEXT    | One of `like`, `dislike`, `hide`, `star`, `clear` (mig 059 — the user withdraws the judgement; the latest event wins, so a trailing `clear` means "no judgement") |
| `reason`            | TEXT    | Optional reason: one code of the closed list above |
| `score`             | INTEGER | Optional 1-5 granular score (mig 028) |
| `direction`         | TEXT    | Optional `more_like_this` / `less_like_this` — pattern signal for the Scout, NOT per-position skip (mig 028) |
| `created_at`        | TS      | Submission time |

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
  "latest_direction": "less_like_this",
  "count": 2,
  "actions": [
    {"action": "dislike", "created_at": "2026-05-30T14:21:00Z",
     "reason": "too_senior", "score": 2, "direction": "less_like_this"},
    {"action": "like", "created_at": "2026-05-28T09:00:00Z",
     "reason": null, "score": null, "direction": null}
  ]
}
```

`latest_action` is the most recent click. `latest_direction` is the most recent NON-NULL value of `direction` in history (anywhere in the actions[], not necessarily the latest action). `actions[]` is ordered DESC by `created_at`. Empty when no feedback exists:

```json
{"ok": true, "legacy_id": "99", "latest_action": null,
 "latest_direction": null, "count": 0, "actions": []}
```

When cloud is disabled or the endpoint is unreachable, the skill returns:

```json
{"ok": true, "legacy_id": "...", "latest_action": null,
 "latest_direction": null, "count": 0, "actions": [],
 "note": "no-signal:cloud-disabled"}
```

## Aggregate lookup (window over all positions)

One HTTP call instead of N: `GET /api/positions/feedback?days=&limit=`, same bearer token, same neutral fallback.

```bash
# Every feedback event in the window, newest first
python3 /app/shared/skills/feedback_query.py recent --days 30

# The reason codes, counted over distinct positions
python3 /app/shared/skills/feedback_query.py themes --days 30 --min-positions 3
```

`themes` output:

```json
{"ok": true, "window_days": 30,
 "events_total": 31, "events_with_reason": 19,
 "positions_with_reason": 17, "positions_cleared": 2,
 "by_action": {"like": 6, "dislike": 21, "hide": 3, "star": 1},
 "min_positions": 3,
 "themes": [
   {"key": "too_senior", "label": "too senior",
    "positions": 7, "events": 7, "share": 0.412,
    "actions": {"dislike": 6, "hide": 1},
    "legacy_ids": ["42", "51", "63"]}
 ]}
```

How the counting works: each position counts **once**, with the reason of its **latest** judgement, and only reasons that are a code of the list count (an old free-text reason reads as `other`). There is no text to group and nothing is interpreted. `other` is counted but says nothing specific.

Deliberate limits, stated so nobody over-reads the numbers:
- A theme is a code, so it is as coarse as the list: `wrong_location` does not say which city. Nothing the user wrote is available to refine it.
- Positions whose **latest** event is `clear` are left out (the judgement was withdrawn); `--include-cleared` puts them back.
- `share` = theme positions / `positions_with_reason`.
- `--top N`, `--days 0` for the whole history. (`--field` is accepted and ignored, for older prompts.)
- Fallback when the aggregate endpoint is not reachable: `--legacy-ids 12,13,14` reads those positions one at a time instead (slower, same output shape).

Flags: `--days` (default 30, `0` = everything), `--limit` (default 500 events), `--min-positions` (default 3).

When the payload carries a closed `note` enum (`no-signal:*`), there is no aggregate. Treat it as "no data", never as "no feedback", and never relay the code.

## How agents use it

**Scorer — `FUTURE_FEEDBACK_ONLY`:** call `themes --days 30 --min-positions 1 --top 10 --exclude-legacy-id <legacy_id>`. Use the `key` / `label` codes only as contextual preference evidence when evaluating that future position. The feedback attached to an already-voted position never changes its score, status, or notes: no fixed bonus/malus, no feedback marker, no backfill. Existing scores remain unchanged. O-70 explicit re-evaluation is a separate user-requested flow.

**Mentor** (Pattern F, read-only): `themes` over the last 30 days to count the reason codes the user picks. Thresholds and interpretation live in the `mentor-patterns` skill. The Mentor speaks **to the user** — never issues search instructions off the back of this data.

**Scout** (optional contextual signal):
- Not for per-position skip — that's already handled by dedup (SC-05).
- Use it sparingly when re-evaluating a known position (e.g., promotion logic): if the user explicitly disliked it, do not re-surface even if dedup would normally rescore it.
- **Pattern signal via `direction`** (mig 028): when `latest_direction='less_like_this'` on a position, the user is asking for fewer positions LIKE that one (same company / role_family / location). Deprioritize that source/pattern in subsequent searches. When `latest_direction='more_like_this'`, prioritize replicating the pattern. This is a contextual hint, not a hard rule — combine it with the broader picture (e.g., a single `less_like_this` on a tiny niche may be noise; three on the same company are not).

## Notes

- The skill is **read-only**. Writes happen only from the browser via POST `/api/positions/{legacy_id}/feedback`.
- The bearer token comes from `cloud.json`; no separate env var needed.
- 10s timeout on `check`, 20s on the aggregate call. If you batch-process many positions with `check`, expect ~50–200ms per call — that is exactly what `recent` / `themes` exist to avoid.
- The aggregate is user-scoped server side: it returns this user's feedback and nothing else.
