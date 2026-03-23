// ── Position ──────────────────────────────────────────────────────
export type PositionStatus =
  | 'new'
  | 'checked'
  | 'excluded'
  | 'scored'
  | 'writing'
  | 'review'
  | 'ready'
  | 'applied'
  | 'response'

export interface Position {
  id: string
  legacy_id: number | null
  title: string
  company: string
  company_id: string | null
  location: string | null
  remote_type: 'full_remote' | 'hybrid' | 'onsite' | null
  salary_declared_min: number | null
  salary_declared_max: number | null
  salary_declared_currency: string | null
  salary_estimated_min: number | null
  salary_estimated_max: number | null
  salary_estimated_currency: string | null
  salary_estimated_source: string | null
  url: string | null
  source: string | null
  jd_text: string | null
  requirements: string | null
  found_by: string | null
  found_at: string
  deadline: string | null
  status: PositionStatus
  notes: string | null
  last_checked: string | null
}

// ── Score ──────────────────────────────────────────────────────────
export interface Score {
  id: string
  position_id: string
  total_score: number
  stack_match: number | null
  remote_fit: number | null
  salary_fit: number | null
  experience_fit: number | null
  strategic_fit: number | null
  breakdown: string | null
  notes: string | null
  scored_by: string | null
  scored_at: string
}

// ── PositionHighlight ──────────────────────────────────────────────
export interface PositionHighlight {
  id: string
  position_id: string
  type: 'pro' | 'con'
  text: string
}

// ── Company ────────────────────────────────────────────────────────
export interface Company {
  id: string
  name: string
  website: string | null
  hq: string | null
  sector: string | null
  size: string | null
  glassdoor_rating: number | null
  red_flags: string | null
  culture_notes: string | null
  analyzed_by: string | null
  analyzed_at: string | null
  verdict: 'GO' | 'CAUTIOUS' | 'NO_GO' | null
}

// ── Application ────────────────────────────────────────────────────
export type ApplicationStatus = 'draft' | 'review' | 'approved' | 'applied' | 'response' | 'ready'

export interface Application {
  id: string
  position_id: string
  cv_path: string | null
  cl_path: string | null
  cv_pdf_path: string | null
  cl_pdf_path: string | null
  cv_drive_id: string | null
  cl_drive_id: string | null
  critic_verdict: 'PASS' | 'NEEDS_WORK' | 'REJECT' | null
  critic_score: number | null
  critic_notes: string | null
  status: ApplicationStatus
  written_at: string | null
  applied_at: string | null
  applied_via: string | null
  response: string | null
  response_at: string | null
  written_by: string | null
  reviewed_by: string | null
  applied: boolean
  interview_round: number | null
}

// ── CandidateProfile ───────────────────────────────────────────────
export interface Language {
  language: string
  level: string
}

export interface LocationPreference {
  type: string
  region?: string
  cities?: string[]
  max_days?: number
  note?: string
}

export interface CandidateProfile {
  id: string
  user_id: string
  name: string | null
  email: string | null
  target_role: string | null
  location: string | null
  experience_years: number | null
  experience_months: number | null
  has_degree: boolean
  skills: Record<string, string[]> | null
  languages: Language[] | null
  location_preferences: LocationPreference[] | null
  job_titles: string[] | null
  salary_target: { currency: string; italy_min: number; italy_max: number; remote_eu_min: number; remote_eu_max: number } | null
  positioning: Record<string, any> | null
  created_at: string
  updated_at: string
}

// ── Dashboard Stats ────────────────────────────────────────────────
export interface DashboardStats {
  total: number
  checked: number
  scored: number
  writing: number
  ready: number
  applied: number
  excluded: number
  response: number
  review: number
  new: number
}

// ── Composite types ────────────────────────────────────────────────
export interface PositionWithScore extends Position {
  score?: number
  scores?: Score
}

export interface ApplicationWithPosition extends Application {
  positions: Pick<Position, 'id' | 'title' | 'company' | 'status' | 'url'>
}
