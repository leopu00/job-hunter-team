-- Seed data for /case-studies — populated from docs/about/RESULTS.md + raw VPS extraction.
-- Re-run idempotent: DELETE + INSERT (foreign keys ON DELETE CASCADE handle children).
--
-- Note 2026-05-24: case study #1 (the maintainer × Claude Max legacy team) has been
-- intentionally excluded from the published seed. The original 2-week legacy run was
-- not measured with the same rigor as #2 and #3 — the numbers are recollections, not
-- VPS-extracted telemetry. The corresponding coverage matrix cell stays as 'open'
-- so the maintainer profile remains a target for a future formal test.

DELETE FROM case_study_windows;
DELETE FROM case_study_metrics;
DELETE FROM case_study_notes;
DELETE FROM coverage_matrix;
DELETE FROM case_studies;
DELETE FROM sqlite_sequence WHERE name IN ('case_studies','case_study_metrics','case_study_notes','coverage_matrix','case_study_windows');


-- ─────────────────────────────────────────────────────────────────────────────
-- Case study #1 — Beta tester 1 × Codex ProLite (renumbered: was #2 internally)
-- Now the FIRST published case study because legacy Claude data was withdrawn.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO case_studies (
  id, slug, case_number, title, tester_handle, profile_summary,
  target_geography, target_industry,
  provider_name, provider_tier, subscription_cost_eur,
  host_kind, host_cost_eur_run,
  started_at, ended_at, duration_hours, duration_label,
  status, source_md_anchor
) VALUES (
  1,
  'beta-tester-1-codex-prolite',
  1,
  'Beta tester 1 × Codex ProLite',
  'Beta tester 1',
  'Senior professional with 10+ years of experience in multilingual technical documentation, translation, and localization, with secondary technical/manufacturing skills.',
  'Multi-country European search (primary + secondary markets + EU remote)',
  NULL,
  'Codex ProLite', 'weekly cap', 100.00,
  'Hetzner CPX22 VPS', 0.54,
  '2026-05-19 20:30:00', '2026-05-21 07:20:00', 34.84, '34.84h active',
  'published', '#-case-study-2--beta-tester-1--codex-prolite-senior-multilingual-technical-profile'
);

INSERT INTO case_study_metrics (case_study_id, metric_key, metric_label, value_num, value_text, unit, emoji, category, display_order, highlighted) VALUES
-- Metadata
(1, 'profile',                 'User profile',                NULL, 'Senior multilingual technical documentation/translation, 10+y',     NULL, '👤', 'metadata', 10, 0),
(1, 'geography',                'Target geography',            NULL, 'Multi-country European search',                                      NULL, '🌍', 'metadata', 20, 0),
(1, 'duration',                 'Period',                      34.84,'34.84h active pipeline time',                                       'h',  '📅', 'metadata', 30, 0),
(1, 'subscription',             'Subscription',                100,  'Codex ProLite ~€100/mo',                                            'EUR','💳', 'metadata', 40, 0),
(1, 'host',                     'Host',                        NULL, 'Hetzner CPX22 VPS (€9.75/mo, ~€0.54 for this run)',                 NULL, '🖥️','metadata', 50, 0),
-- Pipeline
(1, 'positions_analyzed',       'Job offers analyzed',         206,  '206',                                                                'count','🎯','pipeline', 10, 1),
(1, 'companies_vetted',         'Companies vetted',            179,  '179 (120 GO / 59 CAUTIOUS / 0 NO_GO)',                              'count','✅','pipeline', 20, 0),
(1, 'cvs_ready',                'Applications written (PASS)', 105,  '105 (51% pipeline conversion)',                                     'count','📄','pipeline', 30, 1),
(1, 'applications_submitted',   'Applications submitted',      0,    '0 (by-design — user-curated)',                                       'count','📤','pipeline', 40, 0),
-- Quality
(1, 'critic_pass_rate',         'Critic pass rate',            88.2, '88.2% (105 PASS / 14 REJECT)',                                       '%',  '📈','quality',  10, 1),
(1, 'critic_avg_score',         'Critic avg score',            6.35, '6.35 / 10',                                                          '/10','⭐','quality',  20, 0),
-- Economics
(1, 'tokens_weighted',          'LLM tokens consumed (weighted)', 396900000, '396.9M weighted (Codex telemetry)',                          'tokens','💰','economics',10, 1),
(1, 'cost_per_cv',              'Cost per ready CV',           0.95, '€0.95 (sub €100 / 105 CVs)',                                         'EUR','💵','economics',20, 1),
-- Timing
(1, 'velocity_pct_h',           'Bridge velocity',             2.70, '2.70%/h (steady)',                                                   '%/h','⚡','timing',   5, 0),
(1, 'time_to_ready_avg',        'Avg time-to-ready',           7.4,  '7.4h (min 12 min, max 18.9h)',                                       'h',  '⏱️','timing',   10, 0),
(1, 'hours_of_user_time',       'Hours of user time',          1,    '<1h setup + 1 manual doctor mass-restart (see notes)',               'h',  '🧠','timing',   20, 0),
-- Pipeline stage breakdown (Codex has full state-transition coverage)
(1, 'pipeline_new',             'Stage: new',                  206,  '206 positions discovered',                                           'count','📥','pipeline',100,0),
(1, 'pipeline_checked',         'Stage: checked',              196,  '196 made it past triage',                                            'count','🔍','pipeline',101,0),
(1, 'pipeline_scored',          'Stage: scored',               168,  '168 reached scoring',                                                'count','📊','pipeline',102,0),
(1, 'pipeline_writing',         'Stage: writing',              138,  '138 assigned to a Writer',                                           'count','✍️','pipeline',103,0),
(1, 'pipeline_ready',           'Stage: ready',                105,  '105 CV+critic PASS',                                                 'count','✅','pipeline',104,0),
(1, 'pipeline_excluded_at_new',     'Excluded at triage',     10,   '10 (rejected without checking)',                                      'count','✂️','pipeline',110,0),
(1, 'pipeline_excluded_at_checked', 'Excluded after checking',23,   '23 (failed pre-check)',                                                'count','✂️','pipeline',111,0),
(1, 'pipeline_excluded_at_scored',  'Excluded after scoring', 3,    '3 (score too low for write)',                                          'count','✂️','pipeline',112,0),
(1, 'pipeline_excluded_at_writing', 'Excluded in writing',    27,   '27 (writer-side rejection)',                                          'count','✂️','pipeline',113,0),
(1, 'pipeline_excluded_total',  'Excluded total',              63,   '63 (30.6% of pool)',                                                  'count','❌','pipeline',114,0);

INSERT INTO case_study_notes (case_study_id, note_type, body_md, display_order) VALUES
(1, 'worked',     '**Niche match excellence** — the candidate''s secondary technical/manufacturing skill set surfaced a small group of rare-but-perfect matches that averaged **87.3/100**, the highest score domain of the run.', 10),
(1, 'worked',     '**Critic loop holds quality** — 88.2% PASS rate confirms the 3-round Critic protocol is *provider-independent*; the LLM is interchangeable as long as the rubric stays consistent.', 20),
(1, 'worked',     '**Fast end-to-end pipeline** — average 7.4 hours from discovery to ready CV+cover letter; bottom decile in 30 minutes.', 30),
(1, 'worked',     '**Curated source > volume** — the curated scout lane (Ashby/Greenhouse-style) produced 22% high-score positions vs the volume scout lane (LinkedIn-heavy) at 14%.', 40),
(1, 'didnt_work', '**Codex Pro weekly cap is a hard ceiling** — the weekly token budget was consumed in ~2.3 days at a 2.7%/h burn rate. Codex ProLite is **not sustainable for 7-day full-throughput hunts**.', 10),
(1, 'didnt_work', '**Company verdict rubric is too lenient** — 0 NO_GO out of 179 companies. Hard requirements (degree, geography lock-in) leaked downstream and were filtered late by the Writer instead of upfront by the Analyst.', 20),
(1, 'didnt_work', '**Writer attribution is broken** — only 8 out of 119 `written_by` fields populated (93% null). Pipeline still works but we lose per-Writer quality breakdown.', 30),
(1, 'tweak',      'Mid-run the user activated **NO CV mode** (search-only) at 2026-05-20 07:42 UTC — Writers went idle by design while Scout/Analyst kept curating.', 10),
(1, 'tweak',      '**One manual intervention**: the maintainer launched a single doctor mass-restart mission when no agents were being auto-restarted. Each agent woke up with a fresh context and re-discovered the team state on its own. Future runs will have doctors auto-restart every agent at least once per day for context freshness.', 20),
(1, 'caveat',     'JHT does not auto-submit applications. The user reviews the ready stack (105 CVs in this run) and clicks send when they want.', 10),
(1, 'caveat',     'This is a **~35-hour snapshot, not a full month** of work. A monthly subscription represents ~4 weeks of pacing — these results should be read as *what the pipeline produces under near-burst conditions* rather than steady-state.', 20),
(1, 'caveat',     '**This is the most reliable data point** in the published case studies: one continuous run, only one manual intervention, telemetry intact from start to finish.', 30);

-- Codex windows: 1 weekly window (interrupted at peak, would have exceeded the cap)
INSERT INTO case_study_windows (case_study_id, window_number, label, kind, started_at, ended_at, duration_hours, peak_usage_pct, positions_found, ready_cvs, conversion_pct, notes_md, burn_curve_json, display_order) VALUES
(1, 1, 'Single weekly window — interrupted at peak', 'weekly',
 '2026-05-19 20:30:00', '2026-05-21 07:20:00', 34.84, 96,
 206, 105, 51.0,
 'The run consumed **96% of the weekly Codex Pro budget in 34.84h** (avg burn rate **2.70%/h**). Without the manual halt at 07:20 UTC the team would have hit 100% before the weekly reset (2026-05-26). This single window is the cleanest data point we have — continuous run, one manual doctor mass-restart only.',
 '[{"t":"20:17","w":0},{"t":"21:01","w":2},{"t":"00:05","w":11},{"t":"03:02","w":19},{"t":"06:05","w":27},{"t":"09:01","w":33},{"t":"12:00","w":41},{"t":"15:09","w":48},{"t":"18:02","w":57},{"t":"21:00","w":67},{"t":"00:02","w":78},{"t":"03:00","w":84},{"t":"06:05","w":94},{"t":"frozen","w":97}]',
 10);


-- ─────────────────────────────────────────────────────────────────────────────
-- Case study #2 — Beta tester 2 × Kimi K2 Pro (renumbered: was #3)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO case_studies (
  id, slug, case_number, title, tester_handle, profile_summary,
  target_geography, target_industry,
  provider_name, provider_tier, subscription_cost_eur,
  host_kind, host_cost_eur_run,
  started_at, ended_at, duration_hours, duration_label,
  status, source_md_anchor
) VALUES (
  2,
  'beta-tester-2-kimi-k2-pro',
  2,
  'Beta tester 2 × Kimi K2 Pro',
  'Beta tester 2',
  'Junior software developer with ~1 year of experience and no formal degree, looking for a first or second professional position.',
  'Single European capital-city metropolitan area',
  'Technology / Fintech',
  'Kimi K2 Pro', 'token-based', 40.00,
  'Hetzner CPX22 VPS', 1.17,
  '2026-05-16 18:30:00', '2026-05-19 21:49:00', 30.22, '~1.8 weekly windows (1st ~80%, 2nd 100%)',
  'published', '#-case-study-3--beta-tester-2--kimi-k2-pro-junior-software-developer'
);

INSERT INTO case_study_metrics (case_study_id, metric_key, metric_label, value_num, value_text, unit, emoji, category, display_order, highlighted) VALUES
-- Metadata
(2, 'profile',                 'User profile',                NULL, 'Junior software developer, ~1y experience, no formal degree',       NULL, '👤', 'metadata', 10, 0),
(2, 'geography',                'Target geography',            NULL, 'Single European capital-city metropolitan area',                    NULL, '🌍', 'metadata', 20, 0),
(2, 'industry',                 'Target industry',             NULL, 'Technology / Fintech',                                              NULL, '🏢', 'metadata', 25, 0),
(2, 'duration',                 'Period',                      NULL, '~1.8 weekly cycles used (1st ~80%, 2nd 100%)',                      NULL, '📅', 'metadata', 30, 0),
(2, 'subscription',             'Subscription',                40,   'Kimi K2 Pro ~€40/mo',                                               'EUR','💳', 'metadata', 40, 0),
(2, 'host',                     'Host',                        NULL, 'Hetzner CPX22 VPS (€9.75/mo, ~€1.17 for this run)',                 NULL, '🖥️','metadata', 50, 0),
-- Pipeline (note: numbers here are for the SECOND weekly window, the only one with full telemetry)
(2, 'positions_analyzed',       'Job offers analyzed',         251,  '251 (2nd weekly window only — 1st not telemetered)',                'count','🎯','pipeline', 10, 1),
(2, 'companies_vetted',         'Companies vetted',            178,  '178 (158 GO / 20 CAUTIOUS / 0 NO_GO)',                              'count','✅','pipeline', 20, 0),
(2, 'cvs_ready',                'Applications written (PASS)', 55,   '55 (22% avg — but see pre/post LinkedIn windows below; status at cutoff)','count','📄','pipeline', 30, 1),
(2, 'applications_submitted',   'Applications submitted',      0,    '0 (by-design — user-curated)',                                       'count','📤','pipeline', 40, 0),
-- Quality
(2, 'critic_pass_rate',         'Critic pass rate',            51.4, '51.4% (55 PASS / 51 REJECT)',                                        '%',  '📈','quality',  10, 1),
(2, 'critic_avg_score',         'Critic avg score',            5.05, '5.05 / 10',                                                          '/10','⭐','quality',  20, 0),
-- Economics
(2, 'tokens_fresh',             'Fresh tokens',                40700000,  '40.7M (input + output, non-cached)',                            'tokens','💰','economics',10, 0),
(2, 'tokens_cache_read',        'Cache_read tokens',           1574000000,'1.57B (aggressive prompt caching)',                              'tokens','💰','economics',15, 0),
(2, 'tokens_all_in',            'Total tokens (all-in)',       1615000000,'1.61B (aggregated from 16,700 session events)',                  'tokens','💰','economics',20, 1),
(2, 'payg_equivalent_eur',      'Pay-per-use equivalent',      78,   '~€78 (input $5 + output $17 + cache_read $63 at list prices)',       'EUR','💵','economics',30, 0),
(2, 'cost_per_cv',              'Cost per ready CV',           0.71, '€0.71 (sub €40 / 56 CVs)',                                           'EUR','💵','economics',40, 1),
(2, 'sub_vs_payg_ratio',        'Subscription vs pay-per-use', 14,   'Sub 14× cheaper at this usage',                                      'x',  '🏆','economics',50, 1),
-- Timing
(2, 'velocity_pct_h',           'Bridge velocity',             5.37, '5.37%/h (2× faster than Codex 2.7%/h)',                              '%/h','⚡','timing',   10, 0),
(2, 'hours_of_user_time',       'Hours of user time',          1,    '<1h setup + occasional monitoring (autonomous)',                      'h',  '🧠','timing',   20, 0),
-- Pipeline stage breakdown — Kimi 5-stage cascade (status reconstructed at cutoff 2026-05-20 00:00 UTC).
-- Caveat: bug #14 (state_transitions logging) was fixed mid-run on 17/05 17:11 UTC.
-- 83 positions excluded BEFORE the fix have no per-stage transition log and are
-- conservatively attributed to 'excluded_at_new' (= exclusion during scouting).
(2, 'pipeline_new',             'Stage: new (cumulative terminal)', 218, '218 reached a terminal decision',                                'count','📥','pipeline',100,0),
(2, 'pipeline_checked',         'Stage: checked',              117,  '117 made it past triage',                                            'count','🔍','pipeline',101,0),
(2, 'pipeline_scored',          'Stage: scored',                96,  '96 reached scoring',                                                 'count','📊','pipeline',102,0),
(2, 'pipeline_writing',         'Stage: writing',               93,  '93 assigned to a Writer',                                            'count','✍️','pipeline',103,0),
(2, 'pipeline_ready',           'Stage: ready',                 55,  '55 CV + critic PASS',                                                'count','✅','pipeline',104,0),
(2, 'pipeline_excluded_at_new',     'Excluded at scouting',    101, '101 (18 tracked + 83 pre-bug#14-fix aggregated)',                     'count','✂️','pipeline',110,0),
(2, 'pipeline_excluded_at_checked', 'Excluded after checking',  21,  '21 (failed Analista pre-check)',                                      'count','✂️','pipeline',111,0),
(2, 'pipeline_excluded_at_scored',  'Excluded after scoring',    3,  '3 (score too low)',                                                  'count','✂️','pipeline',112,0),
(2, 'pipeline_excluded_at_writing', 'Excluded in writing',      38,  '38 (Critic rejection)',                                              'count','✂️','pipeline',113,0),
(2, 'pipeline_excluded_total',  'Excluded total',              163, '163 (65% of decided pool)',                                           'count','❌','pipeline',114,0),
-- Source breakdown (Kimi only — LinkedIn enabled mid-run is a key insight)
(2, 'source_linkedin_total',    'LinkedIn positions found',    124,  '124 (LinkedIn enabled at 17/05 21:35 UTC)',                          'count','💼','pipeline',120,0),
(2, 'source_linkedin_ready',    'LinkedIn → ready',            34,   '34 PASS (27.4% conversion on LinkedIn-sourced)',                     'count','💼','pipeline',121,0),
(2, 'source_other_total',       'Other-source positions',      127,  '127 (websearch + Greenhouse + Lever + RemoteOK)',                    'count','🔗','pipeline',122,0),
(2, 'source_other_ready',       'Other-source → ready',        21,   '21 PASS (16.5% conversion on non-LinkedIn)',                         'count','🔗','pipeline',123,0);

INSERT INTO case_study_notes (case_study_id, note_type, body_md, display_order) VALUES
(2, 'worked',     '**Token-based provider sustains long runs** — Kimi has no weekly cap; the team consumed ~1.8 weekly cycles cumulatively (first window ~80% peak, second window 100%).', 10),
(2, 'worked',     '**Mass-market price point validated** — €40/mo subscription delivered a working pipeline. Cost per ready CV: **€0.71**. At pay-per-use rates the same run would have cost ~€78 — the subscription paid for itself in <4 days.', 20),
(2, 'worked',     '**Conversion almost doubled after enabling LinkedIn scouting** — pre-LinkedIn 17.8% → post-LinkedIn 26.3%. See the windows section below for the full split. Source quality drives downstream success more than provider choice.', 30),
(2, 'worked',     '**Aggressive prompt caching pays off** — 1.57B cached input reads vs 33.9M new input tokens means the team re-uses context heavily.', 40),
(2, 'didnt_work', '**Headline 22% conversion is misleading** — it averages a "no LinkedIn" period (17.8%) with a "LinkedIn enabled" period (26.3%). The post-LinkedIn rate is the one that reflects the production configuration.', 10),
(2, 'didnt_work', '**Critic average 5.05/10** vs case study #1''s 6.35/10 — outputs scored lower. Could be Kimi producing weaker CV text, the junior profile mapping poorly to senior-skewed JDs, or noise from low-quality websearch sources before LinkedIn was enabled.', 20),
(2, 'didnt_work', '**Same company-verdict rubric bug as case study #1** — 0 NO_GO out of 178 companies.', 30),
(2, 'tweak',      'Mid-run the team was stopped to **enable LinkedIn scout skills**. Two-phase split visible in the windows section below.', 10),
(2, 'caveat',     '`token-meter.csv` (rolling bridge telemetry) was reset on container restart, so figures here are back-calculated from the durable Kimi session logs (16,700 events across 175MB of wire.jsonl).', 10),
(2, 'caveat',     '**Only the second weekly window has full telemetry**. The first weekly window (~80% peak) is recalled from the maintainer''s memory — the sentinel log for that period was not retained.', 20),
(2, 'caveat',     'Case study #1 and #2 used **different candidate profiles and different providers**. The provider comparison is *not* clean — to isolate provider quality we''d need the same candidate × two providers in parallel.', 30);

-- Kimi windows: 2 weekly + 2 phases (pre/post LinkedIn) inside window 2
INSERT INTO case_study_windows (id, case_study_id, window_number, label, kind, parent_window_id, started_at, ended_at, duration_hours, peak_usage_pct, positions_found, ready_cvs, conversion_pct, notes_md, burn_curve_json, display_order) VALUES
(10, 2, 1, 'First weekly window — pre-telemetry', 'weekly', NULL,
 NULL, NULL, NULL, 80,
 NULL, NULL, NULL,
 'Cumulatively about **80% of the weekly budget** consumed. Sentinel/bridge logging for this window was not retained — figures are recalled from the maintainer''s notes during the run. No per-day breakdown available.',
 NULL,
 10),
(11, 2, 2, 'Second weekly window — full telemetry', 'weekly', NULL,
 '2026-05-16 17:19:00', '2026-05-19 01:26:00', 56.1, 100,
 251, 55, 21.9,
 'Hit the weekly cap (100%) on day 4. This window contains the LinkedIn enablement event around 2026-05-17 21:35 UTC, which materially changed the conversion rate. See the two phase rows below. *Counts reconstructed at cutoff 2026-05-20 00:00 UTC.*',
 NULL,
 20),
(12, 2, 1, 'Phase: Pre-LinkedIn enable', 'phase', 11,
 '2026-05-16 17:19:00', '2026-05-17 21:35:00', 28.3, NULL,
 118, 20, 16.9,
 'Scouts limited to websearch + curated boards (Greenhouse, Lever, RemoteOK). High noise → low conversion. **~2/10 positions made it through** — matches the maintainer''s real-time impression.',
 NULL,
 21),
(13, 2, 2, 'Phase: Post-LinkedIn enable', 'phase', 11,
 '2026-05-17 21:35:00', '2026-05-19 01:26:00', 27.9, NULL,
 133, 35, 26.3,
 'After stopping the team, enabling LinkedIn scout skills (`linkedin_check`), and restarting. **Conversion rose ~+48% relative** (17.8% → 26.3%). The first day post-enable peaked at 38.9% before regressing as the cap approached saturation.',
 NULL,
 22);


-- ─────────────────────────────────────────────────────────────────────────────
-- Coverage matrix (mirrors docs/guides/BETA.md — case #1 Claude legacy = open
-- because the original 2-week run was not measured with the same rigor as
-- the published case studies)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO coverage_matrix (cell_number, persona_label, provider_label, status, linked_case_study_id, display_order) VALUES
(1,  'Full-stack dev (maintainer baseline)',                                  'Claude Max x20',         'open', NULL, 1),
(2,  'Senior multilingual technical documentation profile (multi-country EU)','Codex ProLite €100',     'done', 1,    2),
(3,  'Junior software developer (capital city, no degree)',                    'Kimi K2 Pro €40',        'done', 2,    3),
(4,  'Full-stack dev',                                                         'Kimi Pro €40',           'open', NULL, 4),
(5,  'Data engineer',                                                          'Claude Max x20',         'open', NULL, 5),
(6,  'Data engineer',                                                          'Kimi Pro €40',           'open', NULL, 6),
(7,  'Marketing mgr',                                                          'Kimi Pro €40',           'open', NULL, 7),
(8,  'Junior PM',                                                              'Kimi Pro €40',           'open', NULL, 8),
(9,  'Senior backend',                                                         'Codex Pro €100',         'open', NULL, 9),
(10, 'Senior backend',                                                         'Kimi Pro €40',           'open', NULL, 10),
(11, 'Full-stack dev',                                                         'Claude Pro €20 (re-test)','open', NULL, 11),
(12, 'Marketing mgr',                                                          'Codex Plus €20',         'open', NULL, 12);
