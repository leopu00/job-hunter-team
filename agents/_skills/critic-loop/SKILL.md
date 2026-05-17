---
name: critic-loop
description: Run the mandatory 3-round CV review loop with the Critico — autonomously, without going through the Capitano. For each round you spawn a FRESH `CRITICO-S<N>` session (same N as your Scrittore session: SCRITTORE-2 → CRITICO-S2), send PDF + JD, wait for the structured verdict, kill the Critic, correct the CV, regenerate the PDF, and start the next round with another fresh instance. Three rounds are non-negotiable — neither 1 nor 2. After the 3rd round, gate: `critic_score ≥ 5` → `ready`, else `excluded`. Owned by the Scrittore.
allowed-tools: Bash(tmux *), Bash(jht-tmux-send *), Bash(jht-throttle *), Bash(jht-throttle-check *), Bash(jht-throttle-wait *), Bash(python3 *), Bash(unset *)
---

# critic-loop — 3 fresh rounds, no shortcuts

The 3-round protocol catches what one Critic alone cannot:
- A fresh Critic carries **no anchoring bias** from the previous round's score — it reads the corrected CV with new eyes and tends to be more honest, not more lenient.
- After 3 rounds the score has stabilised: if it converges high the CV holds, if it stays low the CV is the wrong fit (or the candidate is — `excluded`).

**You manage the loop yourself. The Capitano does not.** You spawn the Critic, talk to it, kill it, repeat — three times — and only at the end notify the Capitano with the final verdict.

## Setup variables (already in your env)

```bash
MY_SESSION=$(tmux display-message -p '#S')          # e.g. SCRITTORE-2
MY_NUMBER=$(echo "$MY_SESSION" | grep -o '[0-9]*$') # e.g. 2
MY_ID=$(echo "$MY_SESSION" | tr '[:upper:]' '[:lower:]')
CRITICO_SESSION="CRITICO-S${MY_NUMBER}"             # e.g. CRITICO-S2
```

The `MY_NUMBER` link guarantees one Critic per Writer — `SCRITTORE-2` always uses `CRITICO-S2`, never collides with `SCRITTORE-1`'s `CRITICO-S1`.

## Per-round sequence (repeat 3 times)

### Step 1 — Spawn a FRESH Critic

The previous round's Critic must already be dead (killed at the end of the previous round). For round 1 the session does not yet exist.

```bash
tmux kill-session -t "$CRITICO_SESSION" 2>/dev/null
tmux new-session -d -s "$CRITICO_SESSION" -c "$(pwd | sed 's|/[^/]*$||')/critico"
```

### Step 2 — Pick the right CLI for the active provider

Hardcoding `claude` makes the Critic crash when the team runs on Codex or Kimi (the `claude` CLI is not installed in those containers). Read the provider from `$JHT_CONFIG`:

```bash
PROVIDER=$(python3 -c "import json,os; print(json.load(open(os.environ.get('JHT_CONFIG','/jht_home/jht.config.json')))['active_provider'])" 2>/dev/null)
case "$PROVIDER" in
  ""|anthropic|claude) CRITICO_CMD="unset CLAUDECODE && claude --dangerously-skip-permissions --model claude-sonnet-4-6 --effort high" ;;
  openai)              CRITICO_CMD="codex --yolo" ;;
  kimi|moonshot)       CRITICO_CMD="kimi --yolo" ;;
  *)                   CRITICO_CMD="codex --yolo" ;;
esac

# Minimal env for the global CLIs installed under /jht_home
tmux send-keys -t "$CRITICO_SESSION" "export HOME=/jht_home && export PATH=/app/agents/_tools:/jht_home/.npm-global/bin:\$PATH" Enter
tmux send-keys -t "$CRITICO_SESSION" "$CRITICO_CMD" Enter
```

### Step 3 — Wait for the Critic to boot

8 seconds is a safe lower bound for the TUI to be ready. `sleep` is acceptable here (boot only):

```bash
sleep 8
```

### Step 4 — Send PDF + JD via `jht-tmux-send`

The Critic is now an active agent — use `jht-tmux-send`, not raw `send-keys`:

```bash
jht-tmux-send "$CRITICO_SESSION" "[@$MY_ID -> @critico] [REQ] Review cieca: PDF: $JHT_USER_DIR/cv/CV_<Candidato>_<Company>.pdf — JD: <JD-URL> — Local JD file: $JHT_AGENT_DIR/tmp/jd-<position-id>.txt — Read your CLAUDE.md/AGENTS.md and produce an honest verdict."
```

Provide the local JD file path so the Critic has a fallback if the live URL is blocked.

### Step 5 — Poll for the verdict (NEVER plain `sleep`)

Use the `throttle` skill so the wait is logged on the dashboard. Plain `sleep` here would make the wait invisible to the Capitano's pacing analysis.

```bash
jht-throttle-check "$MY_ID" || jht-throttle-wait "$MY_ID"
jht-throttle --agent "$MY_ID" --reason "wait critico round <n> #<position_id>"
tmux capture-pane -t "$CRITICO_SESSION" -p -S -50
```

**MANDATORY** — pass an explicit `timeout: <duration>+30` to the shell tool call when invoking `jht-throttle <N>`. Without it the parent bash dies at the CLI's default 60s timeout (Kimi) and the throttle is executed wrong. See `agents/_skills/throttle/DESIGN-NOTES.md`.

Repeat the throttle+capture cycle until the Critic has published its review (look for the structured `## SCORE: X.X/10` block in the pane / file).

### Step 6 — Read the review

The Critic saves the review under `$JHT_USER_DIR/critiche/review-<company>-<date>.md` (its skill, see `agents/critico/critico.md`). Read it with `Read`. Extract:
- Numerical score `X.X/10`
- "What does NOT work" bullets
- "Concrete actions (prioritized)" list

These three feed Step 8 (correction).

### Step 7 — Persist the round score in the DB

```bash
python3 /app/shared/skills/db_update.py application <POSITION_ID> \
  --critic-score <X.X> --critic-round <N>
```

`<POSITION_ID>` is the position ID, NOT the application ID — the `db_update.py application` is an UPSERT that finds the row by position.

### Step 8 — Kill the Critic (mandatory)

```bash
tmux kill-session -t "$CRITICO_SESSION"
```

If you reuse the same instance for round 2 the score carries the round-1 anchoring bias and the protocol breaks. **Always kill, always respawn fresh.**

### Step 9 — Correct the CV between rounds

Apply the actions from Step 6 to the CV markdown. Regenerate the PDF (`pandoc input.md -o output.pdf --pdf-engine=typst`). Validate the PDF opens before round N+1.

A score that drops between rounds 1 and 2 is **fine** — a fresh Critic is more honest than the previous one. Keep correcting based on the *content* of the review, not the number.

## After the 3rd round — final gate

Two writes on the application row: verdict + score (always), and the
status promotion to `ready` (only on PASS). The promotion is what the
user's `/ready` dashboard reads; skipping it leaves the row in `draft`
and the CV invisible (bug #21).

```bash
if [[ "<final_verdict>" == "PASS" ]]; then
  # PASS → application becomes user-visible
  python3 /app/shared/skills/db_update.py application <POSITION_ID> \
    --critic-verdict PASS \
    --critic-score <final> \
    --critic-round 3 \
    --critic-notes "Round 1: X.X, Round 2: Y.Y, Round 3: Z.Z. Gap: [...]. Verdict: [...]" \
    --status ready
else
  # FAIL → critic data persists, status stays 'draft'
  python3 /app/shared/skills/db_update.py application <POSITION_ID> \
    --critic-verdict FAIL \
    --critic-score <final> \
    --critic-round 3 \
    --critic-notes "Round 1: X.X, Round 2: Y.Y, Round 3: Z.Z. Gap: [...]. Verdict: [...]"
fi
```

Position status:
- `critic_score ≥ 5` → `db_update.py position <POSITION_ID> --status ready`
- `critic_score < 5` → `db_update.py position <POSITION_ID> --status excluded`

Then notify the Capitano:
```bash
jht-tmux-send CAPITANO "[@$MY_ID -> @capitano] [REPORT] Position #<id> — 3 rounds done. Final score: X.X/10 (PASS|FAIL). PDF: $JHT_USER_DIR/cv/CV_<Candidato>_<Company>.pdf"
```

## Hard rules

- **3 rounds. Not 1, not 2.** A "good" round 1 score is not a reason to stop.
- **One Critic per round.** Always kill after the review; always spawn fresh.
- **Mandatory correction between rounds.** If you do not change the CV, the next Critic sees the same input → same review → wasted budget. Edit the markdown + regenerate the PDF before round N+1.
- **Don't be afraid of a falling score.** Round 2 < Round 1 is honest, not bad. The score that matters is round 3.
- **Pass `timeout: N+30`** to every `jht-throttle <N>` shell call. Otherwise the parent bash dies at 60s.

## Anti-patterns

- ❌ Reusing the same Critic instance for multiple rounds — scoring bias breaks the protocol.
- ❌ Hardcoding `claude` in the spawn script — crashes the loop on Codex/Kimi installations.
- ❌ Plain `sleep N` while polling — invisible to the Capitano's throttle dashboard, breaks pacing analysis.
- ❌ Recording `--critic-verdict` after only 1 or 2 rounds — the gate is final, no rollback.
- ❌ Treating the Capitano as the orchestrator — this loop is fully yours, the Capitano only sees the final REPORT.

## See also

- `cv-structure` — what to write before invoking this loop, and how to apply the Critic's corrections in Step 9.
- `application-flow` — anti-rewriting check + claim before you ever start writing for a position.
- `throttle` (and `agents/_skills/throttle/DESIGN-NOTES.md`) — wrapper internals + the `timeout: N+30` design.
- `agents/critico/critico.md` — the Critic's blind-review prompt this loop talks to.
