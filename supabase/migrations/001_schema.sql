-- ============================================================
-- Job Hunter Team — Schema PostgreSQL multi-tenant (Supabase)
-- Migration 001: tabelle base + RLS
-- ============================================================

-- ── CANDIDATE PROFILES ──────────────────────────────────────

CREATE TABLE candidate_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT,
    location TEXT,
    birth_year INTEGER,
    nationality TEXT,
    work_authorization JSONB DEFAULT '[]'::jsonb,
    target_role TEXT,
    experience_months INTEGER DEFAULT 0,
    experience_years INTEGER DEFAULT 0,
    has_degree BOOLEAN DEFAULT FALSE,
    languages JSONB DEFAULT '[]'::jsonb,
    skills JSONB DEFAULT '[]'::jsonb,
    seniority_target TEXT,
    job_titles JSONB DEFAULT '[]'::jsonb,
    location_preferences JSONB DEFAULT '[]'::jsonb,
    salary_target JSONB DEFAULT '{}'::jsonb,
    positioning JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (user_id)
);

-- ── COMPANIES ───────────────────────────────────────────────

CREATE TABLE companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    website TEXT,
    hq TEXT,
    size TEXT,
    stage TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ── POSITIONS ───────────────────────────────────────────────

CREATE TABLE positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    url TEXT,
    location TEXT,
    remote_type TEXT CHECK (remote_type IN ('full_remote', 'hybrid', 'onsite')),
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN (
        'new', 'checked', 'excluded', 'scored', 'writing',
        'review', 'ready', 'applied', 'response'
    )),
    score INTEGER,
    found_at TIMESTAMPTZ DEFAULT now(),
    source TEXT,
    jd_text TEXT,
    requirements TEXT,
    notes TEXT,
    last_checked TIMESTAMPTZ,
    salary_declared_min INTEGER,
    salary_declared_max INTEGER,
    salary_estimated_min INTEGER,
    salary_estimated_max INTEGER,
    salary_estimated_source TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ── SCORES ──────────────────────────────────────────────────

CREATE TABLE scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    position_id UUID NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
    total_score INTEGER NOT NULL CHECK (total_score BETWEEN 0 AND 100),
    experience_fit INTEGER,
    skill_match INTEGER,
    location_fit INTEGER,
    salary_fit INTEGER,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (position_id)
);

-- ── APPLICATIONS ────────────────────────────────────────────

CREATE TABLE applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    position_id UUID NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
    cv_path TEXT,
    cv_pdf_path TEXT,
    status TEXT DEFAULT 'draft' CHECK (status IN (
        'draft', 'review', 'approved', 'applied', 'response'
    )),
    critic_score REAL,
    critic_verdict TEXT CHECK (critic_verdict IN ('PASS', 'NEEDS_WORK', 'REJECT')),
    written_at TIMESTAMPTZ,
    applied_at TIMESTAMPTZ,
    response TEXT,
    response_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (position_id)
);

-- ── INDICI ──────────────────────────────────────────────────

CREATE INDEX idx_positions_user_id ON positions(user_id);
CREATE INDEX idx_positions_status ON positions(user_id, status);
CREATE INDEX idx_positions_score ON positions(score DESC NULLS LAST);
CREATE INDEX idx_companies_user_id ON companies(user_id);
CREATE INDEX idx_scores_user_id ON scores(user_id);
CREATE INDEX idx_scores_position_id ON scores(position_id);
CREATE INDEX idx_applications_user_id ON applications(user_id);
CREATE INDEX idx_applications_position_id ON applications(position_id);

-- ── TRIGGER updated_at ──────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_candidate_profiles_updated_at
    BEFORE UPDATE ON candidate_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── ROW LEVEL SECURITY ─────────────────────────────────────

ALTER TABLE candidate_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;

-- candidate_profiles
CREATE POLICY "Users can view own profile"
    ON candidate_profiles FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own profile"
    ON candidate_profiles FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own profile"
    ON candidate_profiles FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own profile"
    ON candidate_profiles FOR DELETE
    USING (auth.uid() = user_id);

-- companies
CREATE POLICY "Users can view own companies"
    ON companies FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own companies"
    ON companies FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own companies"
    ON companies FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own companies"
    ON companies FOR DELETE
    USING (auth.uid() = user_id);

-- positions
CREATE POLICY "Users can view own positions"
    ON positions FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own positions"
    ON positions FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own positions"
    ON positions FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own positions"
    ON positions FOR DELETE
    USING (auth.uid() = user_id);

-- scores
CREATE POLICY "Users can view own scores"
    ON scores FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own scores"
    ON scores FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own scores"
    ON scores FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own scores"
    ON scores FOR DELETE
    USING (auth.uid() = user_id);

-- applications
CREATE POLICY "Users can view own applications"
    ON applications FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own applications"
    ON applications FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own applications"
    ON applications FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own applications"
    ON applications FOR DELETE
    USING (auth.uid() = user_id);
