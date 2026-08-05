# 🐛 Issue triage workflow

Internal contract for how we handle incoming issues post-launch. Linked from
`CONTRIBUTING.md` (public SLA paragraph) and from `BACKLOG.md` (JHT-LAUNCH-08).

## SLA

- **Triage label within 48h** of issue creation. "Triage" means: a maintainer
  has read it, applied surface + severity labels, and either reproduced it
  (→ `confirmed`) or asked for more info.
- **No fix SLA while we're in beta.** We won't block on a missing fix, but
  the issue stays open and visible.
- **Blockers (`severity:blocker`)** get a maintainer comment within 24h
  acknowledging that we've seen it, even if the fix takes longer.

This SLA only binds the maintainer team. Community PRs are welcome on any
labelled-`help-wanted` issue and we'll review them in the same 48h window.

## The pipeline

Every incoming issue moves through these states. The kanban board mirrors
them as columns; the labels are the source of truth so the board can be
rebuilt from scratch.

```
[ triage ] → [ confirmed ] → [ in-progress ] → [ done (closed) ]
                   ↓
              [ blocked ]
                   ↓
           [ wontfix / duplicate / invalid (closed) ]
```

### `triage` — the front door
- Default label, auto-applied by the issue templates.
- Maintainer action: read, add surface + severity labels, decide:
  - Need more info? Ask, leave `triage` label, snooze.
  - Reproduced? Drop `triage`, add `confirmed`.
  - Already tracked? Close as `duplicate`, link the original.
  - Off-scope? Close as `wontfix` with a one-paragraph reason
    (point to the relevant ADR if one applies).

### `confirmed` — we've seen it
- A maintainer (or a second independent reporter) has reproduced the bug
  on a known-good environment.
- This is where most issues will sit for a while during beta. No
  embarrassment in having a long `confirmed` backlog — it's honest.

### `in-progress` — somebody is working on it
- Single owner. Add the owner as the GitHub assignee.
- Drop the `in-progress` label if the owner steps away >7 days, so the
  issue can be picked up by someone else.

### `blocked` — waiting on something
- Add a comment explaining what blocks it (upstream fix, vendor reply,
  pending ADR, contributor unresponsive).
- Re-check weekly. If the blocker is real and long-lived, close with a
  pointer to the tracking issue/ADR.

### Closing
- `wontfix` requires a one-paragraph rationale. Be polite — most reporters
  who get a `wontfix` never file another issue, and that's fine; what we
  don't want is a `wontfix` that reads like dismissal.
- `duplicate` requires a link to the original.
- `invalid` is for "not reproducible after best-effort investigation" or
  "this is intended behaviour" — explain which.

## The in-app channel

Most reports will not arrive through the issue templates. The desktop app has
a **Segnala un problema** section (own sidebar group, second entrance from
Advanced) that posts an anonymous, redacted report to `POST /api/feedback` on
jobhunterteam.ai. Three consequences for whoever is on triage:

- **They come in labelled `in-app`** on top of `bug` + `triage`, and the title
  is prefixed `[in-app]`. That label means "written by someone who did not
  choose to be on GitHub" — the environment section is already filled in by
  the app, so do not ask for it.
- **No reporter contact reaches any destination.** The endpoint drops the
  legacy `contact` field; mail, a public issue and a webhook all receive the
  same anonymous report. Answering an in-app report means fixing it and
  shipping, nothing else.
- **The attached diagnostic is already redacted**, on both sides — client and
  server. If you see `[email]`, `[ip]`, `/Users/[user]` or `[secret]` in a
  report, that is the system working, not a corrupted upload. Never ask a
  reporter to send unredacted logs "just this once": that is precisely the
  thing this channel exists to avoid.

Configuration lives in `web/.env.example` under "Segnalazioni in-app". With no
destination configured the endpoint answers 503 and the app tells the user the
report is saved locally — so a missing token means **silence from the users**,
not errors in a dashboard. Check that the channel actually delivers before a
release, not after.

## Labels — see `.github/labels.yml`

Canonical list lives in [`.github/labels.yml`](../../../.github/labels.yml).
Buckets:

- **Surface** (`installer`, `monitoring`, `desktop`, `web`, `cli`,
  `container`, `agents`, `docs`) — where the bug lives.
- **Provider** (`provider:claude`, `provider:kimi`, `provider:codex`) —
  which agent CLI is implicated (skip if the bug is provider-agnostic).
- **State** (`triage`, `confirmed`, `in-progress`, `blocked`) — kanban
  column.
- **Severity** (`severity:blocker`, `severity:major`, `severity:minor`) —
  set during triage, can change.
- **Type** (`bug`, `enhancement`, `security`, `question`) — pre-applied by
  the template, sometimes adjusted.
- **Outcomes** (`wontfix`, `duplicate`, `invalid`) — only on closed issues.

## Syncing labels to GitHub

Until we wire a `label-sync` action, do it once by hand from a maintainer
checkout with `gh` installed:

```bash
# From repo root, with $REPO set to leopu00/job-hunter-team
python3 - <<'PY'
import subprocess, yaml, sys
labels = yaml.safe_load(open(".github/labels.yml"))
for l in labels:
    name, color, desc = l["name"], l["color"], l["description"]
    # `gh label create` is idempotent with --force
    subprocess.run([
        "gh", "label", "create", name,
        "--color", color, "--description", desc, "--force",
    ], check=True)
PY
```

If you'd rather avoid the inline Python, install `github-label-sync` or
`EndBug/label-sync@v2` in a workflow — both eat `.github/labels.yml`
verbatim.

## Project board

Single board, single repo:

- **Name:** `JHT — Triage`
- **Columns:** `triage` → `confirmed` → `in-progress` → `blocked` → `done`
- **Automation:** "Item added to project" when an issue gets a state label;
  column moves when the state label changes. Configure once in the
  GitHub Projects UI under Settings → Workflows.

(The board can be rebuilt from the label state at any time, so don't treat
it as load-bearing.)

## Pre-launch checklist (do once before posting on HN)

- [ ] Labels synced (`gh label list` shows the canonical set).
- [ ] Project board created with the 5 columns above and the state-label
      automation turned on.
- [ ] `CONTRIBUTING.md` SLA paragraph points here.
- [ ] Issue templates verified by filing one bug and one feature on a
      test branch.
- [ ] A `severity:blocker` notification path exists for the maintainer
      (GitHub mobile notifications on, or a webhook into the team
      Telegram bot).

## What we'll learn (not blocking, but track)

After ~2 weeks of post-launch triage, revisit:

- Median time-to-triage (should stay under 48h; expect spikes the first
  week).
- Most-hit surface label (drives where the next fix sprint goes).
- `wontfix` rate (if >25%, the install / onboarding docs are probably
  the problem, not the issues).
