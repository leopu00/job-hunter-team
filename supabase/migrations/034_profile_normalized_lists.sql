-- ============================================================
-- Job Hunter Team — Profile redesign (2/3): liste L1 normalizzate
-- Migration 034.  Vedi candidate-profile-cloud-sync-redesign-2026-06-05.md
--
-- Entita' ripetute del core (L1), tipizzate e interrogabili. Popolate dal
-- push con strategia replace-all-per-user (DELETE WHERE user_id + INSERT,
-- in transazione) — Fase 2.
--
-- Convenzioni (coerenti con lo schema esistente + lezioni incident RobertHalf):
--   - user_id FK ON DELETE CASCADE + indice (no unindexed_foreign_keys)
--   - RLS select-own con (select auth.uid()) (no auth_rls_initplan, vedi mig 025)
--   - scrittura server-side via service role (nessuna policy INSERT/UPDATE al client)
--   - CHECK char_length sui testi liberi (no row da 4394 char come RobertHalf)
--   - `ord` per preservare l'ordine deciso dall'assistente
-- Additivo e idempotente.
-- ============================================================

-- ── candidate_experiences (kind=timeline lato UI) ────────────
CREATE TABLE IF NOT EXISTS candidate_experiences (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    company    TEXT NOT NULL,
    role       TEXT NOT NULL,
    period     TEXT,                          -- raw, es. "Sep 2021 - Feb 2023"
    start_date TEXT,                          -- normalizzato YYYY-MM per ordinamento
    end_date   TEXT,                          -- YYYY-MM | 'present'
    location   TEXT,
    summary    TEXT CHECK (summary IS NULL OR char_length(summary) <= 8000),
    ord        INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── candidate_education (formazione + certificazioni) ────────
CREATE TABLE IF NOT EXISTS candidate_education (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL DEFAULT 'education'
                CHECK (kind IN ('education', 'certification')),
    institution TEXT NOT NULL,
    degree      TEXT,
    year        TEXT,
    period      TEXT,
    location    TEXT,
    details     TEXT CHECK (details IS NULL OR char_length(details) <= 8000),
    ord         INT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── candidate_skills ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS candidate_skills (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    category   TEXT NOT NULL DEFAULT 'primary'
               CHECK (category IN ('primary', 'secondary')),
    ord        INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── candidate_languages ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS candidate_languages (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    language   TEXT NOT NULL,                 -- chiave canonica 'language'
    level      TEXT NOT NULL,
    ord        INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── candidate_work_authorization ─────────────────────────────
CREATE TABLE IF NOT EXISTS candidate_work_authorization (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    region     TEXT NOT NULL,                 -- es. eu, ch, uk, us
    status     TEXT NOT NULL,
    ord        INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── candidate_location_preferences ───────────────────────────
CREATE TABLE IF NOT EXISTS candidate_location_preferences (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    value      TEXT NOT NULL,
    ord        INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indici FK + RLS select-own (loop su tutte le tabelle) ────
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'candidate_experiences', 'candidate_education', 'candidate_skills',
        'candidate_languages', 'candidate_work_authorization',
        'candidate_location_preferences'
    ] LOOP
        EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%1$s_user ON %1$s(user_id)', t);
        EXECUTE format('ALTER TABLE %1$s ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS "%1$s select own" ON %1$s', t);
        EXECUTE format(
            'CREATE POLICY "%1$s select own" ON %1$s FOR SELECT USING ((select auth.uid()) = user_id)', t);
    END LOOP;
END $$;
