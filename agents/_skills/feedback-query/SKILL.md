---
name: feedback-query
description: Read user feedback (like/dislike/hide/star) from the cloud — one position at a time, or aggregated over a window. Used by the Scorer to apply a multiplier on the final score and carry the user's reason into the note, by the Mentor to count recurring reasons (Pattern F), and by the Scout as a contextual signal. Returns a neutral "no signal" payload when cloud is disabled or unreachable, so callers never hard-fail.
allowed-tools: Bash(python3 *)
---

## Raw/display boundary (`RAW_DISPLAY_BOUNDARY`)

`reason` and `comment` are raw machine input. Never quote, relay, summarize, or expose them to the user. Any user-facing note or message must use only `display_reason` / `display_comment`; theme `label` / `examples` have already crossed the same shared sanitizer. A `note` is only a closed `no-signal:*` enum: treat it as availability state and never turn it into infrastructure detail.

# feedback-query — User feedback per position

The user can click like/dislike/hide/star on any position from the web dashboard. Those clicks are stored in Supabase `position_feedback` (mig 019 base + mig 028 extended) and surfaced to agents via this skill. Schema:

| Column              | Type    | Meaning |
|---------------------|---------|---------|
| `position_legacy_id`| TEXT    | The `legacy_id` (string) of the position in `positions` |
| `action`            | TEXT    | One of `like`, `dislike`, `hide`, `star`, `clear` (mig 059 — the user withdraws the judgement; the latest event wins, so a trailing `clear` means "no judgement") |
| `reason`            | TEXT    | Optional short reason (≤500 char) |
| `comment`           | TEXT    | Optional verbose comment (≤2000 char, mig 028) |
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
     "reason": "too senior", "comment": "5+ anni in Java richiesti, non mi interessa stack legacy",
     "display_reason": "too senior", "display_comment": "5+ anni in Java richiesti, non mi interessa stack legacy",
     "score": 2, "direction": "less_like_this"},
    {"action": "like", "created_at": "2026-05-28T09:00:00Z",
     "reason": null, "comment": null, "display_reason": null,
     "display_comment": null, "score": null, "direction": null}
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

# The reasons the user typed, grouped by similarity
python3 /app/shared/skills/feedback_query.py themes --days 30 --min-positions 3
```

`themes` output:

```json
{"ok": true, "window_days": 30, "field": "both",
 "events_total": 31, "events_with_text": 19,
 "positions_with_text": 17, "positions_cleared": 2,
 "by_action": {"like": 6, "dislike": 21, "hide": 3, "star": 1},
 "min_positions": 3,
 "themes": [
   {"key": "tropp senio", "label": "troppo senior",
    "positions": 7, "events": 8, "share": 0.412,
    "actions": {"dislike": 6, "hide": 2},
    "legacy_ids": ["42", "51", "63"],
    "examples": ["troppo senior", "richiesta troppo seniore — Lead role"]}
 ]}
```

How the grouping works (no exact match required, no new dependencies): lowercase → accents stripped → punctuation dropped → service words removed → every word cut to its first 5 characters (`senior` / `seniority` / `seniore` / `séniorité` collapse onto one key) → count single words and **adjacent pairs**, by **distinct positions**, not by events. A pair absorbs its parts when it covers ≥ 80% of the same positions, so "too senior" wins over "senior"; intensifiers are kept in the stream on purpose. `reason` and `comment` are tokenised separately, so no pair is invented across the two.

Deliberate limits, stated so nobody over-reads the numbers:
- Distant synonyms stay apart (`salary` and `RAL` are two themes) — this is word counting, not semantics. Read the sanitized display `examples` (up to 3) and join with your head.
- Positions whose **latest** event is `clear` are left out (the judgement was withdrawn); `--include-cleared` puts them back.
- `share` = theme positions / `positions_with_text`.
- `--field reason|comment|both` (default `both`), `--top N`, `--days 0` for the whole history.
- Fallback when the aggregate endpoint is not reachable: `--legacy-ids 12,13,14` reads those positions one at a time instead (slower, same output shape).

Flags: `--days` (default 30, `0` = everything), `--limit` (default 500 events), `--min-positions` (default 3), `--text-chars` on `recent` (default 300, truncates long comments).

When the payload carries a closed `note` enum (`no-signal:*`), there is no aggregate. Treat it as "no data", never as "no feedback", and never relay the code.

## How agents use it

**Scorer** (mandatory at scoring time):
1. After computing the base score (sum of weighted components), call `feedback_query check <legacy_id>`.
2. Apply multiplier based on `latest_action`:
   - `like` → final_score = round(base * 1.10), add note `feedback:like+10%`
   - `star` → final_score = round(base * 1.15), add note `feedback:star+15%`
   - `dislike` → final_score = round(base * 0.85), add note `feedback:dislike-15%`
   - `hide` → status=`excluded`, note `feedback:hide`, skip writing score
   - `clear` / `null` → no change (a withdrawn judgement is not a judgement)
3. **Carry the safe display reason into the note**, when present. Take `display_reason` (or, if empty, `display_comment`) from the **same event** as `latest_action` — `actions[0]` — and append it to the note. Never fall back to raw `reason` / `comment`:

   ```
   feedback:dislike-15% — "too senior"
   feedback:star+15% — "exactly the stack I want"
   ```

   No text on that event → the note stays as it is. The reason belongs to **this position only**: never carry it over to another position, never turn it into a rule, never rewrite or summarise it — those are the user's words and they will read them back. Aggregating reasons across positions is the Mentor's job (Pattern F), not the Scorer's.
4. Cap final score at 100 after multiplier.

**Mentor** (Pattern F, read-only): `themes` over the last 30 days to count the reasons the user writes. Thresholds and interpretation live in the `mentor-patterns` skill. The Mentor speaks **to the user** — never issues search instructions off the back of this data.

**Scout** (optional contextual signal):
- Not for per-position skip — that's already handled by dedup (SC-05).
- Use it sparingly when re-evaluating a known position (e.g., promotion logic): if the user explicitly disliked it, do not re-surface even if dedup would normally rescore it.
- **Pattern signal via `direction`** (mig 028): when `latest_direction='less_like_this'` on a position, the user is asking for fewer positions LIKE that one (same company / role_family / location). Deprioritize that source/pattern in subsequent searches. When `latest_direction='more_like_this'`, prioritize replicating the pattern. This is a contextual hint, not a hard rule — combine it with the broader picture (e.g., a single `less_like_this` on a tiny niche may be noise; three on the same company are not).

## Notes

- The skill is **read-only**. Writes happen only from the browser via POST `/api/positions/{legacy_id}/feedback`.
- The bearer token comes from `cloud.json`; no separate env var needed.
- 10s timeout on `check`, 20s on the aggregate call. If you batch-process many positions with `check`, expect ~50–200ms per call — that is exactly what `recent` / `themes` exist to avoid.
- The aggregate is user-scoped server side: it returns this user's feedback and nothing else.
