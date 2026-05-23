-- Schema for the public /case-studies page
-- Dev: SQLite (case-studies.db, gitignored)
-- Prod target: same schema applied as Supabase migration
--
-- Source of truth for case studies = docs/about/RESULTS.md
-- This DB is a structured representation for UI rendering + queries
-- (charts, comparisons, coverage aggregates).

CREATE TABLE IF NOT EXISTS case_studies (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  slug                  TEXT UNIQUE NOT NULL,
  case_number           INTEGER NOT NULL,                       -- 1, 2, 3 ...
  title                 TEXT NOT NULL,
  tester_handle         TEXT NOT NULL,                          -- "the maintainer" | "Beta tester 1" | ...
  profile_summary       TEXT NOT NULL,                          -- 1-3 sentences, anonymized
  target_geography      TEXT,                                   -- "multi-country EU" | "single capital city"
  target_industry       TEXT,                                   -- "tech/fintech" | ...
  provider_name         TEXT NOT NULL,                          -- "Claude Max x20" | "Codex ProLite" | "Kimi K2 Pro"
  provider_tier         TEXT,                                   -- "weekly cap" | "token-based"
  subscription_cost_eur DECIMAL,                                -- ~100, ~40, ~200
  host_kind             TEXT,                                   -- "local" | "Hetzner CPX22" | ...
  host_cost_eur_run     DECIMAL,                                -- vps cost only for the run window
  started_at            TIMESTAMP,
  ended_at              TIMESTAMP,
  duration_hours        DECIMAL,                                -- active pipeline time
  duration_label        TEXT,                                   -- "2 weeks" | "34.84h" | "75h calendar / 30.22h state-tracked"
  status                TEXT NOT NULL DEFAULT 'published',      -- 'published' | 'draft' | 'archived'
  source_md_anchor      TEXT,                                   -- "#case-study-2--beta-tester-1-..." for deep-link to RESULTS.md
  published_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CHECK (status IN ('published','draft','archived'))
);

CREATE INDEX IF NOT EXISTS idx_cs_case_number ON case_studies(case_number);
CREATE INDEX IF NOT EXISTS idx_cs_status      ON case_studies(status, published_at DESC);

-- Per-study KPIs/metrics (positions analyzed, ready CVs, critic pass rate, tokens, ecc.)
CREATE TABLE IF NOT EXISTS case_study_metrics (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  case_study_id   INTEGER NOT NULL,
  metric_key      TEXT NOT NULL,                                -- snake_case: 'positions_analyzed', 'cvs_ready', ...
  metric_label    TEXT NOT NULL,                                -- user-facing: "Job offers analyzed", ...
  value_num       DECIMAL,                                      -- numeric value when applicable
  value_text      TEXT,                                         -- formatted text fallback: "≈€78", "N/A (no auto-apply)"
  unit            TEXT,                                         -- '%', 'count', 'EUR', 'hours', 'tokens', ...
  emoji           TEXT,                                         -- semantic emoji for header (e.g. '🎯', '📄', '💰')
  category        TEXT NOT NULL,                                -- 'metadata' | 'pipeline' | 'quality' | 'economics' | 'timing'
  display_order   INTEGER DEFAULT 0,
  highlighted     INTEGER DEFAULT 0,                            -- 0/1 — show as KPI hero card
  FOREIGN KEY (case_study_id) REFERENCES case_studies(id) ON DELETE CASCADE,
  UNIQUE (case_study_id, metric_key)
);

CREATE INDEX IF NOT EXISTS idx_csm_case ON case_study_metrics(case_study_id, category, display_order);

-- Narrative notes per case study: "what worked", "what didn't", "tweaks", "caveats"
CREATE TABLE IF NOT EXISTS case_study_notes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  case_study_id   INTEGER NOT NULL,
  note_type       TEXT NOT NULL,                                -- 'worked' | 'didnt_work' | 'tweak' | 'caveat'
  body_md         TEXT NOT NULL,                                -- markdown allowed
  display_order   INTEGER DEFAULT 0,
  FOREIGN KEY (case_study_id) REFERENCES case_studies(id) ON DELETE CASCADE,
  CHECK (note_type IN ('worked','didnt_work','tweak','caveat'))
);

CREATE INDEX IF NOT EXISTS idx_csn_case ON case_study_notes(case_study_id, note_type, display_order);

-- Coverage matrix cells (mirrors docs/guides/BETA.md, shown in /case-studies)
CREATE TABLE IF NOT EXISTS coverage_matrix (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  cell_number     INTEGER UNIQUE NOT NULL,                      -- 1..N
  persona_label   TEXT NOT NULL,
  provider_label  TEXT NOT NULL,
  status          TEXT NOT NULL,                                -- 'done' | 'open' | 'in_progress'
  linked_case_study_id INTEGER,                                  -- nullable
  notes           TEXT,
  display_order   INTEGER DEFAULT 0,
  FOREIGN KEY (linked_case_study_id) REFERENCES case_studies(id) ON DELETE SET NULL,
  CHECK (status IN ('done','open','in_progress'))
);

CREATE INDEX IF NOT EXISTS idx_cov_status ON coverage_matrix(status, display_order);

-- Schema version stamp (for future migrations)
CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR REPLACE INTO schema_meta(key, value) VALUES ('version', '1');
INSERT OR REPLACE INTO schema_meta(key, value) VALUES ('created_at', CURRENT_TIMESTAMP);
