-- ============================================================
-- Job Hunter Team — Seed data (demo)
-- ============================================================
-- Usa un user_id fittizio. In produzione, Supabase lo popola
-- da auth.users dopo il signup.
--
-- Per eseguire: supabase db reset (applica migration + seed)
-- ============================================================

-- User fittizio per demo (sostituisci con auth.uid() reale)
-- In Supabase Dashboard > SQL Editor puoi cambiare questo UUID
DO $$
DECLARE
    demo_user UUID := '00000000-0000-0000-0000-000000000001';
BEGIN

-- ── PROFILO CANDIDATO ───────────────────────────────────────

INSERT INTO candidate_profiles (user_id, name, email, location, target_role,
    experience_years, experience_months, has_degree,
    languages, skills, seniority_target, job_titles,
    location_preferences, salary_target)
VALUES (
    demo_user,
    'Demo User',
    'demo@example.com',
    'Remote EU',
    'Backend Developer',
    1, 14, false,
    '[{"lingua": "italiano", "livello": "madrelingua"}, {"lingua": "inglese", "livello": "B2"}]'::jsonb,
    '["Python", "FastAPI", "PostgreSQL", "Docker", "Git", "Flask", "SQLite", "Redis"]'::jsonb,
    'junior',
    '["Backend Developer", "Python Developer", "Software Engineer"]'::jsonb,
    '["Remote EU", "Remote Worldwide", "Hybrid Milano"]'::jsonb,
    '{"min": 30000, "max": 50000, "currency": "EUR"}'::jsonb
);

-- ── AZIENDE ─────────────────────────────────────────────────

INSERT INTO companies (user_id, name, website, hq, size, stage, notes) VALUES
    (demo_user, 'EuroTech Solutions', 'https://eurotech.example.com', 'Germania', '50-200', 'growth', 'Stack Python, cultura remote-first'),
    (demo_user, 'Nordic SaaS', 'https://nordicsaas.example.com', 'Svezia', '20-50', 'seed', 'Prodotto B2B, team distribuito'),
    (demo_user, 'DataFlow Labs', 'https://dataflow.example.com', 'Paesi Bassi', '200-500', 'series-b', 'Data pipeline, FastAPI'),
    (demo_user, 'CloudBase', 'https://cloudbase.example.com', 'Irlanda', '500+', 'public', 'Infra cloud, Python heavy');

-- ── POSIZIONI ───────────────────────────────────────────────

INSERT INTO positions (user_id, title, company, url, location, remote_type, status, score,
    source, jd_text, requirements, notes,
    salary_declared_min, salary_declared_max) VALUES

(demo_user, 'Backend Python Developer', 'EuroTech Solutions',
    'https://eurotech.example.com/careers/backend-python',
    'Remote EU', 'full_remote', 'scored', 88,
    'linkedin', 'Junior/Mid Python Backend Developer. Python 3.10+, FastAPI or Flask, PostgreSQL, Docker, Git. 0-2 years. B2 English.',
    'Python, FastAPI, Flask, PostgreSQL, Docker, Git',
    'Stack match eccellente. Remote EU perfetto. Nessun red flag.',
    35000, 50000),

(demo_user, 'Python API Engineer', 'Nordic SaaS',
    'https://nordicsaas.example.com/jobs/api-eng',
    'Remote Worldwide', 'full_remote', 'scored', 82,
    'wellfound', 'Build and maintain REST APIs in Python. FastAPI, PostgreSQL, Redis. Startup pace.',
    'Python, FastAPI, PostgreSQL, Redis',
    'Startup piccola ma prodotto interessante. Full remote worldwide.',
    32000, 45000),

(demo_user, 'Junior Software Engineer', 'DataFlow Labs',
    'https://dataflow.example.com/careers/junior-swe',
    'Amsterdam / Remote', 'hybrid', 'writing', 75,
    'linkedin', 'Data pipeline team. Python, SQL, Docker. Growth opportunity.',
    'Python, SQL, Docker',
    'Hybrid Amsterdam. Buona crescita. Stack parziale match.',
    40000, 55000),

(demo_user, 'Backend Developer', 'CloudBase',
    'https://cloudbase.example.com/jobs/backend',
    'Dublin / Remote EU', 'hybrid', 'checked', NULL,
    'careers-page', 'Infrastructure backend. Python, Go, Kubernetes, AWS. 1-3 years.',
    'Python, Go, Kubernetes, AWS',
    'Go e K8s non nel profilo. Salary buono ma stack match basso.',
    45000, 65000),

(demo_user, 'Full Stack Developer', 'EuroTech Solutions',
    'https://eurotech.example.com/careers/fullstack',
    'Remote EU', 'full_remote', 'new', NULL,
    'linkedin', 'React + Python backend. Full stack role.',
    'React, TypeScript, Python, PostgreSQL',
    NULL,
    38000, 52000),

(demo_user, 'DevOps Engineer', 'DataFlow Labs',
    'https://dataflow.example.com/careers/devops',
    'Amsterdam', 'onsite', 'excluded', NULL,
    'indeed', 'Senior DevOps. 5+ years. Terraform, AWS, Kubernetes.',
    'Terraform, AWS, Kubernetes, CI/CD',
    'Esclusa: 5+ anni richiesti, onsite only, stack non compatibile.',
    NULL, NULL);

-- ── SCORES ──────────────────────────────────────────────────

INSERT INTO scores (user_id, position_id, total_score, experience_fit, skill_match, location_fit, salary_fit)
SELECT demo_user, p.id, 88, 18, 33, 25, 12
FROM positions p WHERE p.title = 'Backend Python Developer' AND p.user_id = demo_user;

INSERT INTO scores (user_id, position_id, total_score, experience_fit, skill_match, location_fit, salary_fit)
SELECT demo_user, p.id, 82, 16, 30, 25, 11
FROM positions p WHERE p.title = 'Python API Engineer' AND p.user_id = demo_user;

INSERT INTO scores (user_id, position_id, total_score, experience_fit, skill_match, location_fit, salary_fit)
SELECT demo_user, p.id, 75, 18, 25, 17, 15
FROM positions p WHERE p.title = 'Junior Software Engineer' AND p.user_id = demo_user;

-- ── APPLICATIONS ────────────────────────────────────────────

INSERT INTO applications (user_id, position_id, cv_path, status, critic_score, critic_verdict, written_at)
SELECT demo_user, p.id, 'data/applications/cv_eurotech_v2.md', 'approved', 8.5, 'PASS', now() - interval '2 days'
FROM positions p WHERE p.title = 'Backend Python Developer' AND p.user_id = demo_user;

INSERT INTO applications (user_id, position_id, cv_path, status, written_at)
SELECT demo_user, p.id, 'data/applications/cv_dataflow_v1.md', 'draft', now() - interval '1 day'
FROM positions p WHERE p.title = 'Junior Software Engineer' AND p.user_id = demo_user;

END $$;
