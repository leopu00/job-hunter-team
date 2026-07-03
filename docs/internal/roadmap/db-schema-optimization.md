# 🗄️ Database schema optimization — plan (idea, not scheduled)

> Moved from `docs/about/ROADMAP.md` in the 2026-07-03 docs restructure. Ties into mission **M7** (fine-grained observability): `position_events` is the enabler for the who-did-what-when timeline.

The current `jobs.db` schema is functional but **lossy**: state transitions, Critic rounds, and inter-agent feedback all evaporate after the fact, and `positions.notes` hides 5 structured analysis fields as plain text.

```
⬜ positions.claimed_by + claimed_at — explicit per-record lock so agents can
   batch-claim atomically (UPDATE … LIMIT 5) instead of running CHECK/CLAIM/
   NOTIFY × N rounds via tmux. Stale-claim handling left to the agent's
   judgement (no hardcoded TTL — production agents run for months without
   dying; the rare orphan reclaim must verify peer is actually dead first).
⬜ Real-time agent activity for the UI dashboard — first pass via VIEW/JOIN on
   existing tables (positions.claimed_by, applications.written_by, scores.scored_by);
   dedicated agent_activity table only if the view proves insufficient.
⬜ position_events  — audit trail of every status change (timeline + replay)
⬜ application_reviews — persist all 3 Critic rounds, not just the final score
⬜ agent_messages — log inter-agent [FEEDBACK]/[REQ]/[RES] for pattern analysis
⬜ position_analysis — promote ESCLUSA-tag + 5-field analyst notes to columns
⬜ application_artifacts — consolidate cv/cl × md/pdf paths (single artifacts table)
⬜ Drop redundancies: positions.applied (BOOL) duplicates applications.applied_at;
                     applications.status overlaps positions.status
⬜ interview_log — replace single interview_round INT with full interview history
⬜ user_feedback — capture user reactions ("tone off" / "good — applying")
⬜ captain_decisions — orchestration log (spawn +1 analyst, freeze, throttle, etc.)
```

**Anti-collision mechanism — descriptive, not unified.** The five worker roles (Scout · Analyst · Scorer · Writer · Critic) do genuinely different work and use different lock strategies (Scout pre-INSERT URL dedup · Analyst/Scorer `last_checked` watermark · Writer `status = writing` flip). Forcing one common pattern adds friction for marginal gain. The new `claimed_by/at` columns sit alongside the existing role-specific mechanisms, primarily to enable the batch-claim shortcut and the UI activity view.

→ Detailed analysis: [`agents/_manual/db-schema.md`](../../../agents/_manual/db-schema.md). Highest-ROI single change is `position_events` — unlocks dashboard timeline + debug + analytics with one new table and zero changes to the existing flow.
