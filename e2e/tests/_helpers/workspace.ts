import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { expect, type APIRequestContext, type Page } from '@playwright/test'

export const SEEDED_WORKSPACE_PATH = process.env.JHT_E2E_WORKSPACE || '/tmp/jht-e2e-seeded'

const SEED_SQL = `
PRAGMA foreign_keys = OFF;

DELETE FROM position_highlights;
DELETE FROM applications;
DELETE FROM scores;
DELETE FROM positions;
DELETE FROM companies;
DELETE FROM sqlite_sequence WHERE name IN ('companies', 'positions', 'scores', 'position_highlights', 'applications');

INSERT INTO companies (id, name, website, hq_country, sector, size, glassdoor_rating, analyzed_by, verdict)
VALUES
  (1, 'Acme Remote Labs', 'https://acme.example/jobs', 'IT', 'Software', '51-200', 4.5, 'analista-1', 'GO'),
  (2, 'Beta Hybrid Systems', 'https://beta.example/careers', 'IT', 'Platform', '201-500', 4.1, 'analista-1', 'GO'),
  (3, 'Gamma Insights', 'https://gamma.example/openings', 'IT', 'Analytics', '11-50', 3.9, 'analista-1', 'CAUTIOUS');

INSERT INTO positions (
  id, title, company, company_id, location, remote_type,
  salary_declared_min, salary_declared_max, salary_declared_currency,
  url, source, jd_text, requirements, found_by, found_at, status, notes
)
VALUES
  (
    1, 'Frontend Engineer', 'Acme Remote Labs', 1, 'Remote / Italy', 'full_remote',
    55000, 70000, 'EUR',
    'https://acme.example/jobs/frontend-engineer', 'linkedin',
    'Build a Next.js dashboard for job-search automation.',
    'React, TypeScript, testing, product ownership.',
    'scout-1', '2026-04-06 09:00:00', 'ready', 'Seed data for e2e coverage'
  ),
  (
    2, 'Platform Engineer', 'Beta Hybrid Systems', 2, 'Milan', 'hybrid',
    65000, 80000, 'EUR',
    'https://beta.example/careers/platform-engineer', 'greenhouse',
    'Own backend integrations, automation pipelines and observability.',
    'Node.js, APIs, automation, infrastructure.',
    'scout-1', '2026-04-05 09:00:00', 'applied', 'Seed data for e2e coverage'
  ),
  (
    3, 'Data Analyst', 'Gamma Insights', 3, 'Rome', 'onsite',
    40000, 52000, 'EUR',
    'https://gamma.example/openings/data-analyst', 'company-site',
    'Analyze job-market datasets and company signals.',
    'SQL, analytics, communication.',
    'scout-1', '2026-04-04 09:00:00', 'new', 'Seed data for e2e coverage'
  );

INSERT INTO scores (
  id, position_id, total_score, stack_match, remote_fit, salary_fit, experience_fit, strategic_fit, notes, scored_by, scored_at
)
VALUES
  (1, 1, 88, 34, 20, 16, 8, 10, 'Strong fit for frontend automation work.', 'scorer-1', '2026-04-06 10:00:00'),
  (2, 2, 72, 28, 14, 15, 6, 9, 'Good platform fit with hybrid compromise.', 'scorer-1', '2026-04-05 10:00:00'),
  (3, 3, 43, 16, 4, 10, 5, 8, 'Useful reference role, lower strategic priority.', 'scorer-1', '2026-04-04 10:00:00');

INSERT INTO position_highlights (id, position_id, type, text)
VALUES
  (1, 1, 'pro', 'Remote-first team with strong TypeScript stack'),
  (2, 1, 'con', 'Fast-paced roadmap with tight weekly releases'),
  (3, 2, 'pro', 'Clear platform ownership and observability budget'),
  (4, 2, 'con', 'Hybrid attendance requested twice per week');

INSERT INTO applications (
  id, position_id, cv_path, cl_path, cv_pdf_path, cl_pdf_path,
  critic_verdict, critic_score, critic_notes, status, written_at,
  applied_at, applied_via, written_by, reviewed_by, critic_reviewed_at,
  applied, interview_round, cv_drive_id, cl_drive_id
)
VALUES
  (
    1, 1, '/tmp/cv-frontend.md', '/tmp/cl-frontend.md', '/tmp/cv-frontend.pdf', '/tmp/cl-frontend.pdf',
    'PASS', 9.1, 'Ready to submit', 'ready', '2026-04-06 10:30:00',
    NULL, NULL, 'scrittore-1', 'critico', '2026-04-06 10:45:00',
    0, NULL, 'seed-cv-frontend-123', 'seed-cl-frontend-123'
  ),
  (
    2, 2, '/tmp/cv-platform.md', '/tmp/cl-platform.md', '/tmp/cv-platform.pdf', '/tmp/cl-platform.pdf',
    'PASS', 8.4, 'Submitted successfully', 'applied', '2026-04-05 10:30:00',
    '2026-04-05 12:00:00', 'LinkedIn', 'scrittore-1', 'critico', '2026-04-05 10:45:00',
    1, 1, 'seed-cv-platform-456', 'seed-cl-platform-456'
  );

PRAGMA foreign_keys = ON;
`

export async function ensureSeededWorkspace(
  request: APIRequestContext,
  workspacePath = SEEDED_WORKSPACE_PATH,
): Promise<void> {
  const res = await request.post('/api/workspace/init', {
    data: { path: workspacePath },
  })

  if (!res.ok()) {
    throw new Error(`Workspace init failed with ${res.status()}`)
  }

  const dbPath = path.join(workspacePath, 'jobs.db')
  execFileSync('sqlite3', [dbPath], { input: SEED_SQL })
}

export async function loginToSeededWorkspace(
  page: Page,
  workspacePath = SEEDED_WORKSPACE_PATH,
): Promise<void> {
  await page.goto('/?login=true')

  const input = page.locator('input[placeholder="/percorso/alla/cartella"]')
  await expect(input).toBeVisible({ timeout: 10_000 })
  await input.fill(workspacePath)
  await input.press('Enter')

  const confirm = page.getByText('OK, usa questa cartella')
  await expect(confirm).toBeVisible({ timeout: 10_000 })
  await confirm.click()

  await page.waitForURL(/\/dashboard$/, { timeout: 15_000 })

  const onboardingSkip = page.getByRole('button', { name: /salta|skip/i })
  if (await onboardingSkip.isVisible().catch(() => false)) {
    await onboardingSkip.click()
    await expect(onboardingSkip).toBeHidden({ timeout: 10_000 })
  }
}
