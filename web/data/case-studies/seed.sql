-- Seed data for /case-studies — populated from docs/about/RESULTS.md
-- Re-run idempotent: DELETE + INSERT (foreign keys ON DELETE CASCADE handle children)

DELETE FROM case_study_metrics;
DELETE FROM case_study_notes;
DELETE FROM coverage_matrix;
DELETE FROM case_studies;
DELETE FROM sqlite_sequence WHERE name IN ('case_studies','case_study_metrics','case_study_notes','coverage_matrix');

-- ─────────────────────────────────────────────────────────────────────────────
-- Case study #1 — the maintainer (legacy team, early 2026)
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
  'maintainer-legacy-claude-max',
  1,
  'The maintainer (legacy team)',
  'the maintainer',
  'Full-stack developer running the original private version of JHT, hardcoded for a single profile. Not actively job-hunting — interviews taken to validate that the pipeline produced submissions strong enough to reach the human stage.',
  NULL, NULL,
  'Claude Max x20', 'weekly cap', 200.00,
  'local', 0.00,
  NULL, NULL, NULL, '2 weeks',
  'published', '#case-study-1--the-maintainer-legacy-team-early-2026'
);

INSERT INTO case_study_metrics (case_study_id, metric_key, metric_label, value_num, value_text, unit, emoji, category, display_order, highlighted) VALUES
(1, 'profile',              'User profile',         NULL, 'Full-stack developer',    NULL,    '👤', 'metadata',  10, 0),
(1, 'duration',              'Period',               NULL, '2 weeks',                  NULL,    '📅', 'metadata',  20, 0),
(1, 'subscription',          'Subscription',         200,  'Claude Max x20 (~€200/mo)', 'EUR', '💳', 'metadata',  30, 0),
(1, 'positions_analyzed',    'Offers analyzed',      200,  '~200',                     'count', '🎯', 'pipeline',  10, 1),
(1, 'applications_sent',     'Applications sent',     20,  '~20',                      'count', '📄', 'pipeline',  20, 1),
(1, 'interview_invites',     'Interview invites',     5,   '5',                        'count', '💬', 'pipeline',  30, 1),
(1, 'offers_received',       'Offers received',       0,   '0 (not the goal — see note)', 'count','🎉', 'pipeline',  40, 0),
(1, 'reply_rate',            'Reply rate vs market', 5,    '~5× typical baseline',     'x',     '✉️', 'quality',   10, 0);

INSERT INTO case_study_notes (case_study_id, note_type, body_md, display_order) VALUES
(1, 'caveat', 'The maintainer was not actively hunting — the 5 interviews were taken to validate that AI-written applications could reach the human stage. The hypothesis was *"if AI-written applications get reply rates above market baseline, the system works."* It did. The system was then rebuilt as the open-source team.', 10);


-- ─────────────────────────────────────────────────────────────────────────────
-- Case study #2 — Beta tester 1 × Codex ProLite
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
  'beta-tester-1-codex-prolite',
  2,
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
(2, 'profile',                 'User profile',                NULL, 'Senior multilingual technical documentation/translation, 10+y',     NULL, '👤', 'metadata', 10, 0),
(2, 'geography',                'Target geography',            NULL, 'Multi-country European search',                                      NULL, '🌍', 'metadata', 20, 0),
(2, 'duration',                 'Period',                      34.84,'34.84h active pipeline time',                                       'h',  '📅', 'metadata', 30, 0),
(2, 'subscription',             'Subscription',                100,  'Codex ProLite ~€100/mo',                                            'EUR','💳', 'metadata', 40, 0),
(2, 'host',                     'Host',                        NULL, 'Hetzner CPX22 VPS (€9.75/mo, ~€0.54 for this run)',                 NULL, '🖥️','metadata', 50, 0),
-- Pipeline
(2, 'positions_analyzed',       'Job offers analyzed',         206,  '206',                                                                'count','🎯','pipeline', 10, 1),
(2, 'companies_vetted',         'Companies vetted',            179,  '179 (120 GO / 59 CAUTIOUS / 0 NO_GO)',                              'count','✅','pipeline', 20, 0),
(2, 'cvs_ready',                'Applications written (PASS)', 105,  '105 (51% pipeline conversion)',                                     'count','📄','pipeline', 30, 1),
(2, 'applications_submitted',   'Applications submitted',      0,    '0 (by-design — user-curated)',                                       'count','📤','pipeline', 40, 0),
(2, 'interview_invites',        'Interview invites',           NULL, 'N/A (no auto-apply)',                                                NULL, '💬','pipeline', 50, 0),
(2, 'offers_received',          'Offers received',             NULL, 'N/A',                                                                NULL, '🎉','pipeline', 60, 0),
-- Quality
(2, 'critic_pass_rate',         'Critic pass rate',            88.2, '88.2% (105 PASS / 14 REJECT)',                                       '%',  '📈','quality',  10, 1),
(2, 'critic_avg_score',         'Critic avg score',            6.35, '6.35 / 10',                                                          '/10','⭐','quality',  20, 0),
-- Economics
(2, 'tokens_weighted',          'LLM tokens consumed (weighted)', 396900000, '396.9M weighted (Codex telemetry)',                          'tokens','💰','economics',10, 1),
(2, 'cost_per_cv',              'Cost per ready CV',           0.95, '€0.95 (sub €100 / 105 CVs)',                                         'EUR','💵','economics',20, 1),
-- Timing
(2, 'time_to_ready_avg',        'Avg time-to-ready',           7.4,  '7.4h (min 12 min, max 18.9h)',                                       'h',  '⏱️','timing',   10, 0),
(2, 'hours_of_user_time',       'Hours of user time',          1,    '<1h setup + occasional monitoring (autonomous)',                      'h',  '🧠','timing',   20, 0);

INSERT INTO case_study_notes (case_study_id, note_type, body_md, display_order) VALUES
(2, 'worked',     '**Niche match excellence** — the candidate''s secondary technical/manufacturing skill set surfaced a small group of rare-but-perfect matches that averaged **87.3/100**, the highest score domain of the run.', 10),
(2, 'worked',     '**Critic loop holds quality** — 88.2% PASS rate confirms the 3-round Critic protocol is *provider-independent*; the LLM is interchangeable as long as the rubric stays consistent.', 20),
(2, 'worked',     '**Fast end-to-end pipeline** — average 7.4 hours from discovery to ready CV+cover letter; bottom decile in 30 minutes.', 30),
(2, 'worked',     '**Curated source > volume** — the curated scout lane (Company 015/Greenhouse-style) produced 22% high-score positions vs the volume scout lane (LinkedIn-heavy) at 14%.', 40),
(2, 'didnt_work', '**Codex Pro weekly cap is a hard ceiling** — the weekly token budget was consumed in ~2.3 days at a 2.7%/h burn rate. Codex ProLite is **not sustainable for 7-day full-throughput hunts**.', 10),
(2, 'didnt_work', '**Company verdict rubric is too lenient** — 0 NO_GO out of 179 companies. Hard requirements (degree, geography lock-in) leaked downstream and were filtered late by the Writer instead of upfront by the Analyst.', 20),
(2, 'didnt_work', '**Writer attribution is broken** — only 8 out of 119 `written_by` fields populated (93% null). Pipeline still works but we lose per-Writer quality breakdown.', 30),
(2, 'tweak',      'Mid-run the user activated **NO CV mode** (search-only) at 2026-05-20 07:42 UTC — Writers went idle by design while Scout/Analyst kept curating.', 10),
(2, 'caveat',     'JHT does not auto-submit applications. The user reviews the ready stack (105 CVs in this run) and clicks send when they want.', 10),
(2, 'caveat',     'This is a ~35-hour snapshot, not a full month of work. A monthly subscription represents ~4 weeks of pacing — these results should be read as *what the pipeline produces under near-burst conditions* rather than steady-state.', 20);


-- ─────────────────────────────────────────────────────────────────────────────
-- Case study #3 — Beta tester 2 × Kimi K2 Pro
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO case_studies (
  id, slug, case_number, title, tester_handle, profile_summary,
  target_geography, target_industry,
  provider_name, provider_tier, subscription_cost_eur,
  host_kind, host_cost_eur_run,
  started_at, ended_at, duration_hours, duration_label,
  status, source_md_anchor
) VALUES (
  3,
  'beta-tester-2-kimi-k2-pro',
  3,
  'Beta tester 2 × Kimi K2 Pro',
  'Beta tester 2',
  'Junior software developer with ~1 year of experience and no formal degree, looking for a first or second professional position.',
  'Single European capital-city metropolitan area',
  'Technology / Fintech',
  'Kimi K2 Pro', 'token-based', 40.00,
  'Hetzner CPX22 VPS', 1.17,
  '2026-05-16 18:30:00', '2026-05-19 21:49:00', 30.22, '75h calendar (30.22h state-tracked)',
  'published', '#-case-study-3--beta-tester-2--kimi-k2-pro-junior-software-developer'
);

INSERT INTO case_study_metrics (case_study_id, metric_key, metric_label, value_num, value_text, unit, emoji, category, display_order, highlighted) VALUES
-- Metadata
(3, 'profile',                 'User profile',                NULL, 'Junior software developer, ~1y experience, no formal degree',       NULL, '👤', 'metadata', 10, 0),
(3, 'geography',                'Target geography',            NULL, 'Single European capital-city metropolitan area',                    NULL, '🌍', 'metadata', 20, 0),
(3, 'industry',                 'Target industry',             NULL, 'Technology / Fintech',                                              NULL, '🏢', 'metadata', 25, 0),
(3, 'duration',                 'Period',                      30.22,'75h calendar (30.22h state-tracked)',                              'h',  '📅', 'metadata', 30, 0),
(3, 'subscription',             'Subscription',                40,   'Kimi K2 Pro ~€40/mo',                                               'EUR','💳', 'metadata', 40, 0),
(3, 'host',                     'Host',                        NULL, 'Hetzner CPX22 VPS (€9.75/mo, ~€1.17 for this run)',                 NULL, '🖥️','metadata', 50, 0),
-- Pipeline
(3, 'positions_analyzed',       'Job offers analyzed',         251,  '251',                                                                'count','🎯','pipeline', 10, 1),
(3, 'companies_vetted',         'Companies vetted',            178,  '178 (158 GO / 20 CAUTIOUS / 0 NO_GO)',                              'count','✅','pipeline', 20, 0),
(3, 'cvs_ready',                'Applications written (PASS)', 56,   '56 (22% pipeline conversion)',                                       'count','📄','pipeline', 30, 1),
(3, 'applications_submitted',   'Applications submitted',      0,    '0 (by-design — user-curated)',                                       'count','📤','pipeline', 40, 0),
(3, 'interview_invites',        'Interview invites',           NULL, 'N/A',                                                                NULL, '💬','pipeline', 50, 0),
(3, 'offers_received',          'Offers received',             NULL, 'N/A',                                                                NULL, '🎉','pipeline', 60, 0),
-- Quality
(3, 'critic_pass_rate',         'Critic pass rate',            51.4, '51.4% (55 PASS / 51 REJECT)',                                        '%',  '📈','quality',  10, 1),
(3, 'critic_avg_score',         'Critic avg score',            5.05, '5.05 / 10',                                                          '/10','⭐','quality',  20, 0),
-- Economics
(3, 'tokens_fresh',             'Fresh tokens',                40700000,  '40.7M (input + output, non-cached)',                            'tokens','💰','economics',10, 0),
(3, 'tokens_cache_read',        'Cache_read tokens',           1574000000,'1.57B (aggressive prompt caching)',                              'tokens','💰','economics',15, 0),
(3, 'tokens_all_in',            'Total tokens (all-in)',       1615000000,'1.61B (aggregated from 16,700 session events)',                  'tokens','💰','economics',20, 1),
(3, 'payg_equivalent_eur',      'Pay-per-use equivalent',      78,   '~€78 (input $5 + output $17 + cache_read $63 at list prices)',       'EUR','💵','economics',30, 0),
(3, 'cost_per_cv',              'Cost per ready CV',           0.71, '€0.71 (sub €40 / 56 CVs)',                                           'EUR','💵','economics',40, 1),
(3, 'sub_vs_payg_ratio',        'Subscription vs pay-per-use', 14,   'Sub 14× cheaper at this usage',                                      'x',  '🏆','economics',50, 1),
-- Timing
(3, 'velocity_pct_h',           'Bridge velocity',             5.37, '5.37%/h (2× faster than Codex 2.7%/h)',                              '%/h','⚡','timing',   10, 0),
(3, 'hours_of_user_time',       'Hours of user time',          1,    '<1h setup + occasional monitoring (autonomous)',                      'h',  '🧠','timing',   20, 0);

INSERT INTO case_study_notes (case_study_id, note_type, body_md, display_order) VALUES
(3, 'worked',     '**Token-based provider sustains long runs** — Kimi has no weekly cap; the team ran 4 calendar days without saturation (vs Codex Pro hitting 96% weekly in 2.3 days).', 10),
(3, 'worked',     '**High scout volume** — 251 positions discovered in the run, peak of 145 on day 2.', 20),
(3, 'worked',     '**Mass-market price point validated** — €40/mo subscription delivered a working pipeline. Cost per ready CV: **€0.71**. At pay-per-use rates the same run would have cost ~€78 — the subscription paid for itself in <4 days.', 30),
(3, 'worked',     '**Aggressive prompt caching pays off** — 1.57B cached input reads vs 33.9M new input tokens means the team re-uses context heavily.', 40),
(3, 'didnt_work', '**Pipeline conversion dropped to 22%** vs case study #2''s 51%. A junior software developer in a saturated capital city is a brutally competitive market.', 10),
(3, 'didnt_work', '**Critic average 5.05/10** vs case study #2''s 6.35/10 — outputs scored lower. Could be Kimi producing weaker CV text, or junior profile mapping poorly to senior-skewed JDs, or both.', 20),
(3, 'didnt_work', '**Scout-2 underperformed on this profile** — 0 high-score positions out of 64. The curated-lane strategy did not transfer to a junior profile.', 30),
(3, 'didnt_work', '**Same company-verdict rubric bug as case study #2** — 0 NO_GO out of 178 companies.', 40),
(3, 'caveat',     '`token-meter.csv` (rolling bridge telemetry) was reset on container restart, so figures here are back-calculated from the durable Kimi session logs (16,700 events across 175MB of wire.jsonl).', 10),
(3, 'caveat',     'Case study #2 and #3 used **different candidate profiles and different providers**. The provider comparison is *not* clean — to isolate provider quality we''d need the same candidate × two providers in parallel.', 20),
(3, 'caveat',     '75 calendar hours of run, with the weekly token cap hit on day 4. These results show **burst usage**, not steady-state. Spread-out monthly usage might produce different cache hit ratios.', 30);


-- ─────────────────────────────────────────────────────────────────────────────
-- Coverage matrix (mirrors docs/guides/BETA.md)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO coverage_matrix (cell_number, persona_label, provider_label, status, linked_case_study_id, display_order) VALUES
(1,  'Full-stack dev (maintainer baseline)',                                  'Claude Max x20',         'done', 1, 1),
(2,  'Senior multilingual technical documentation profile (multi-country EU)','Codex ProLite €100',     'done', 2, 2),
(3,  'Junior software developer (capital city, no degree)',                    'Kimi K2 Pro €40',        'done', 3, 3),
(4,  'Full-stack dev',                                                         'Kimi Pro €40',           'open', NULL, 4),
(5,  'Data engineer',                                                          'Claude Max x20',         'open', NULL, 5),
(6,  'Data engineer',                                                          'Kimi Pro €40',           'open', NULL, 6),
(7,  'Marketing mgr',                                                          'Kimi Pro €40',           'open', NULL, 7),
(8,  'Junior PM',                                                              'Kimi Pro €40',           'open', NULL, 8),
(9,  'Senior backend',                                                         'Codex Pro €100',         'open', NULL, 9),
(10, 'Senior backend',                                                         'Kimi Pro €40',           'open', NULL, 10),
(11, 'Full-stack dev',                                                         'Claude Pro €20 (re-test)','open', NULL, 11),
(12, 'Marketing mgr',                                                          'Codex Plus €20',         'open', NULL, 12);
