---
name: application-flow
description: DB + filesystem contract every Scrittore follows when taking a position from `scored` (≥50) to `ready`/`excluded`. Three gates BEFORE writing a single line of CV (anti-rewriting, anti-collision, link verification), one canonical path for deliverables, one final gate after the 3rd Critic round. Skipping any of these produces duplicate work, overwrites another Writer's claim, or — worst — pushes an `excluded`-grade CV to the user as `ready`. Owned by the Scrittore.
allowed-tools: Bash(python3 *), Bash(curl *), Bash(mkdir -p *), Bash(find *), Bash(test *)
---

# application-flow — claim, write, gate

The Writer touches only two areas of the DB:
- `positions.status` (writing → ready | excluded)
- `applications` (INSERT + UPDATE via UPSERT)

Everything else is off-limits: never `scores`, `companies`, `position_highlights`, `positions.notes` (Analyst territory), `positions.applied` (Capitano/user only). T09 + scrittore role boundary.

## Step 1 — Pull the next position

```bash
python3 /app/shared/skills/db_query.py next-for-scrittore
```

Priority: `score ≥ 70` first, then `50-69` descending. The script already orders.

## Step 2 — Anti-rewriting gate (MUST run before claim)

A position whose Critic verdict is already set is FINAL — never re-review.

```bash
if python3 /app/shared/skills/db_query.py application "$ID" >/dev/null; then
  : # exit 0 → application missing, OR application without verdict → procedi
else
  : # exit 1 → critic_verdict gia' valorizzato → SKIP ASSOLUTO
  continue
fi
```

Exit codes:
- `0` → no application yet, or application without verdict → proceed to Step 3.
- `1` → `critic_verdict` already set → **SKIP ABSOLUTE**, the Critic's vote is final.

> ⚠️ `sqlite3` CLI is NOT installed in the container. Always use `db_query.py`. Never `python3 -c "import sqlite3 ..."` workarounds — they bypass the script's invariants.

## Step 3 — Anti-collision claim

Verify the position is not already claimed by another Writer, then claim it atomically by flipping the status.

```bash
# Check current state
python3 /app/shared/skills/db_query.py position "$ID"

# If status is already `writing` → another Writer has it, SKIP
# Otherwise claim:
python3 /app/shared/skills/db_update.py position "$ID" --status writing
```

Optional but recommended: announce the claim to peers via tmux so they don't even start the gate sequence on the same ID.

```bash
for s in $(tmux list-sessions -F '#{session_name}' | grep -E '^SCRITTORE-[0-9]+$' | grep -v "^${MY_SESSION}$"); do
  jht-tmux-send "$s" "[@$MY_ID -> @${s,,}] [INFO] Sto prendendo position #$ID"
done
```

Anti-collision contract details: `agents/_manual/anti-collision.md`.

## Step 4 — Link verification

A JD that died between Phase 2 (Analyst) and now should NOT consume Critic budget. Two-level check:

```bash
# Level 1 — curl with browser UA
curl -s -L -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' "<JD-URL>" \
  | grep -i 'no longer accepting\|closed-job\|position has been filled\|expired\|job not found'
```

If match → mark excluded and exit:
```bash
python3 /app/shared/skills/db_update.py position "$ID" --status excluded \
  --notes "ESCLUSA: [LINK_MORTO] verificato dallo Scrittore prima di scrivere"
```

Level 2 (only if Level 1 inconclusive) — fetch MCP, look for "No longer accepting" / "applications closed" in the rendered DOM.

## Step 5 — INSERT the application row + write the CV

After link is valid, create the application row. **Always via `db_update.py application` (UPSERT)** — never raw `python3 -c "import sqlite3 ... INSERT INTO applications ..."`.

```bash
python3 /app/shared/skills/db_insert.py application \
  --position-id "$ID" \
  --cv-path "$JHT_USER_DIR/cv/CV_<Candidato>_<Company>.md" \
  --cv-pdf-path "$JHT_USER_DIR/cv/CV_<Candidato>_<Company>.pdf" \
  --written-by "$MY_ID" --written-at now
```

> ⚠️ Never pass the literal string `'now'` as a timestamp value to a hand-rolled SQL — it gets stored as the string `"now"` instead of an ISO timestamp. The wrapper handles `--written-at now` correctly; the wrapper is the only safe path.

Then write the CV (skill `cv-structure`) → generate PDF → run `critic-loop`.

## Step 6 — Path discipline (T11) + unique naming (bug #25)

Final deliverables MUST live under `$JHT_USER_DIR`, NEVER under `$JHT_AGENT_DIR`. **Filename must include `position_id`** so 2+ openings at the same company don't overwrite each other:

| Artifact                       | Path                                                                                |
|--------------------------------|--------------------------------------------------------------------------------------|
| CV markdown                    | `$JHT_USER_DIR/cv/CV_<Candidato>_<position_id>_<CompanySlug>_<TitleSlug>.md`         |
| CV PDF                         | `$JHT_USER_DIR/cv/CV_<Candidato>_<position_id>_<CompanySlug>_<TitleSlug>.pdf`        |
| Cover Letter (only if asked)   | `$JHT_USER_DIR/allegati/CoverLetter_<Candidato>_<position_id>_<CompanySlug>.{md,pdf}` |

- `<Candidato>` = `Nome_Cognome` from profile.
- `<position_id>` = `positions.id` (integer, monotonic, unique).
- `<CompanySlug>` = company lowercased, non-alphanumeric → `-`. Es. `canonical`, `bending-spoons`.
- `<TitleSlug>` = title lowercased + truncated to ~30 chars. Es. `observability`, `junior-ubuntu`.

Example for 2 Canonical openings (bug #25 case):
```
CV_LeoneEmanuelPuglisi_28_canonical_observability.pdf
CV_LeoneEmanuelPuglisi_62_canonical_junior-ubuntu.pdf
```

Before bug #25 fix both saved as `CV_LeoneEmanuelPuglisi_Canonical.pdf` → second overwrote first → DB had 2 application rows pointing to the same file → silent data corruption visible only when the user opened the PDF and read content from the *other* application.

When recording the path in the DB (`--cv-path`, `--cv-pdf-path`), record the `$JHT_USER_DIR/...` path. Never a path under `$JHT_AGENT_DIR` (that's scratch — see workspace below).

## Step 7 — Final gate (after `critic-loop` reaches round 3)

The `critic-loop` skill records each round's score; here you persist the verdict, flip the application status, and align the position status.

> ⚠️ **Single-writer rule (bug #21).** `applications.status='ready'` is set **only here, by you, after Critic PASS**. The Critic never writes `applications.status` directly — its only output is `critic_verdict` + `critic_score`. You own the final transition.

```bash
# Final UPSERT on the application — verdict + score + ready/draft promotion
# `--reviewed-by` must be set to the LAST Critic's session id you spawned
# (e.g. CRITICO-S3 if round 3 was the final one). Without it, `reviewed_by`
# stays NULL — observed 95% null pre-2026-05-22 (vps1-run-postmortem #1).
LAST_CRITIC="${LAST_CRITIC:-CRITICO-S3}"   # set by critic-loop on round spawn

if [[ <final_verdict> == "PASS" ]]; then
  python3 /app/shared/skills/db_update.py application "$ID" \
    --critic-verdict PASS \
    --critic-score <X.X> \
    --critic-round 3 \
    --critic-notes "Round 1: A.A, Round 2: B.B, Round 3: X.X. Gap: [...]" \
    --reviewed-by "$LAST_CRITIC" \
    --status ready
else
  python3 /app/shared/skills/db_update.py application "$ID" \
    --critic-verdict <NEEDS_WORK|REJECT> \
    --critic-score <X.X> \
    --critic-round 3 \
    --critic-notes "Round 1: A.A, Round 2: B.B, Round 3: X.X. Gap: [...]" \
    --reviewed-by "$LAST_CRITIC"
  # status resta 'draft' — l'application non è pronta per l'utente.
fi

# Position status — automatic from final score
if [[ <final_score>_int >= 5 ]]; then
  python3 /app/shared/skills/db_update.py position "$ID" --status ready
else
  python3 /app/shared/skills/db_update.py position "$ID" --status excluded
fi
```

The `applications.status='ready'` promotion is what makes the CV visible on the user's `/ready` dashboard. Skipping it leaves the row in `'draft'` forever — Capitano reports a ready count that the DB and the dashboard don't agree with.

Then notify Capitano with a `[REPORT]` (skill `tmux-send`).

## Workspace — `tools/` + `tmp/`, housekeeping at boot (T12)

Your `$JHT_AGENT_DIR` has 2 canonical subdirs created by the launcher:

| Subdir                       | What                                                              | Lifetime                                |
|------------------------------|-------------------------------------------------------------------|------------------------------------------|
| `$JHT_AGENT_DIR/tools/`      | helper scripts you wrote for yourself (one-off JD parsers, etc.)  | as long as useful; audit each boot       |
| `$JHT_AGENT_DIR/tmp/`        | scratch: downloaded JDs, draft CV revisions between rounds         | wiped at boot if older than 7 days       |

**Boot housekeeping (FIRST step in your loop, before Step 1):**

```bash
mkdir -p "$JHT_AGENT_DIR/tools" "$JHT_AGENT_DIR/tmp"
find "$JHT_AGENT_DIR/tmp" -type f -mtime +7 -delete 2>/dev/null || true
```

Repeat every ~6h of continuous run or every ~50 main-loop iterations. NOT inside a tight loop — costs FS calls.

> 🚫 **Out of bounds:** never `find -delete` outside `$JHT_AGENT_DIR/tmp/`. Never wipe `$JHT_USER_DIR` (deliverables), never wipe sibling agents' workspaces. T12.

## Hard rules

- **Anti-rewriting before claim, always.** Skipping Step 2 means re-running the Critic on a finalised application = wasted Opus tokens and possibly overwriting a final verdict.
- **Claim before write.** A CV written without claim risks two Writers producing parallel CVs for the same position.
- **Path under `$JHT_USER_DIR/cv/`, never `$JHT_AGENT_DIR/`.** The user looks under `$JHT_USER_DIR`; CVs scattered in agent workspaces are invisible to them. T11.
- **No raw SQL.** Always `db_query.py` / `db_update.py` / `db_insert.py`. The wrappers enforce invariants the team relies on.
- **No git.** No `git add`, no `git commit`, no `git push` (T02).

## Anti-patterns

- ❌ Skipping Step 2 (anti-rewriting) "because the position looks fresh" — exit 1 means the Critic already voted, never invisible.
- ❌ Claiming a position then writing the CV under `$JHT_AGENT_DIR/cv/` — the user can't see it; the path in the DB is wrong; T11 violation.
- ❌ `python3 -c "import sqlite3; INSERT INTO applications ..."` — bypasses UPSERT logic, garbage data in the DB.
- ❌ Passing `'now'` as a literal string when not using the wrapper — stored as string instead of ISO timestamp.
- ❌ Touching `positions.notes` (Analyst's column) — role boundary violation, breaks Analyst's structured fields.
- ❌ Setting `positions.applied` from here — only Capitano or user can flip that flag.

## See also

- `cv-structure` — what to write between Step 5 and `critic-loop`.
- `critic-loop` — the 3-round review that produces the final score for Step 7.
- `agents/_manual/anti-collision.md` — full multi-Writer coordination contract.
- `agents/_manual/db-schema.md` — `applications` columns + role boundaries.
- `agents/_team/team-rules.md` T11 (deliverables path) + T12 (workspace housekeeping).
