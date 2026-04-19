import yaml from 'js-yaml'
import fs from 'fs'
import type { CandidateProfile } from './types'
import { JHT_PROFILE_YAML } from './jht-paths'

export function readProfile(_workspacePath?: string): CandidateProfile | null {
  if (!fs.existsSync(JHT_PROFILE_YAML)) return null
  try {
    const raw = yaml.load(fs.readFileSync(JHT_PROFILE_YAML, 'utf8')) as any
    if (!raw) return null
    return mapYamlToProfile(raw)
  } catch {
    return null
  }
}

/**
 * Legge il profilo dal path fisso ~/.jht/profile/candidate_profile.yml.
 * Restituisce null se mancante, vuoto, o con placeholder del template.
 */
export function readWorkspaceProfile(_workspacePath?: string): CandidateProfile | null {
  if (!fs.existsSync(JHT_PROFILE_YAML)) return null
  try {
    const raw = yaml.load(fs.readFileSync(JHT_PROFILE_YAML, 'utf8')) as any
    if (!raw) return null
    const profile = mapYamlToProfile(raw)
    if (!profile.name && !profile.target_role) return null
    if (profile.name === 'Nome Cognome' || profile.email === 'nome.cognome@example.com') return null
    return profile
  } catch (err) {
    console.error(`[profile-reader] failed to parse ${JHT_PROFILE_YAML}:`, err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Gate di completezza: un profilo è considerato "pronto per la dashboard"
 * solo quando contiene identità base + almeno 2 skill, 1 lingua, 1 esperienza
 * lavorativa e 1 titolo di studio. Stessa logica usata dal client in
 * onboarding/page.tsx (canProceed). Se cambi una, cambia anche l'altra.
 */
export function isProfileComplete(profile: CandidateProfile | null): boolean {
  if (!profile) return false
  const hasCore = Boolean(
    profile.name
    && profile.target_role
    && profile.location
    && profile.experience_years != null
    && (profile.positioning?.contacts?.email || profile.email),
  )
  if (!hasCore) return false
  const skills = Object.values(profile.skills ?? {}).flat().filter(Boolean)
  const languages = profile.languages ?? []
  const experience = profile.positioning?.experience ?? []
  const education = profile.positioning?.education ?? []
  return skills.length >= 2 && languages.length >= 1 && experience.length >= 1 && education.length >= 1
}

function mapYamlToProfile(raw: any): CandidateProfile {
  const candidate = raw.candidate ?? {}
  const personal = raw.personal ?? {}

  // Skills: cerca in candidate.skills, raw.skills (dict o lista)
  let skills: Record<string, string[]> | null = null
  const rawSkills = candidate.skills ?? raw.skills
  if (rawSkills && typeof rawSkills === 'object' && !Array.isArray(rawSkills)) {
    skills = rawSkills
  } else if (Array.isArray(rawSkills)) {
    skills = { primary: rawSkills }
  }

  // Languages: normalizza lingua/livello -> language/level
  const rawLangs = candidate.languages ?? raw.languages ?? []
  const languages = Array.isArray(rawLangs)
    ? rawLangs.map((l: any) => ({
        language: l.language ?? l.lingua ?? '',
        level: l.level ?? l.livello ?? '',
      }))
    : null

  // Preferenze di lavoro (nuovo campo standard `preferences`) con retrocompat
  // verso vecchi campi usati dall'agente prima che lo schema venisse fissato:
  // `work_location`, `flexible`, `location_preferences`, `relocation`.
  const rawPrefs = raw.preferences ?? {}
  const rawLoc = raw.location_preferences ?? []
  const legacyWorkMode = raw.work_location ?? rawPrefs.work_mode ?? null
  const work_mode: string | null = legacyWorkMode
    ?? (Array.isArray(rawLoc) && rawLoc.length > 0
      ? (typeof rawLoc[0] === 'string' ? rawLoc[0] : rawLoc[0]?.type ?? null)
      : null)
  const work_mode_flexibility: string | null = rawPrefs.work_mode_flexibility
    ?? (raw.flexible === true ? 'flessibile su altre modalità' : null)
  const relocation: string | boolean | null = rawPrefs.relocation ?? raw.relocation ?? null
  const salary_annual_eur: string | null = rawPrefs.salary_annual_eur ?? null

  const location_preferences = Array.isArray(rawLoc)
    ? rawLoc.map((l: any) => {
        if (typeof l === 'string') return { type: l }
        return l
      })
    : null

  // Salary target
  const rawSalary = raw.salary_target ?? {}
  const salary_target = rawSalary.min != null
    ? {
        currency: rawSalary.currency ?? 'EUR',
        italy_min: rawSalary.min ?? 0,
        italy_max: rawSalary.max ?? 0,
        remote_eu_min: rawSalary.remote_eu_min ?? rawSalary.min ?? 0,
        remote_eu_max: rawSalary.remote_eu_max ?? rawSalary.max ?? 0,
      }
    : null

  // Contacts: cerca in candidate.contacts o personal
  const contacts = candidate.contacts ?? {
    email: personal.email,
    phone: personal.phone,
    linkedin: personal.linkedin,
    github: personal.github,
    website: personal.website,
  }

  return {
    id: 'local',
    user_id: 'local',
    name: candidate.name ?? personal.name ?? raw.name ?? null,
    email: contacts.email ?? personal.email ?? null,
    target_role: candidate.target_role ?? raw.target_role ?? (raw.target_roles?.[0]) ?? null,
    location: raw.location ?? personal.location ?? null,
    experience_years: raw.experience_years ?? null,
    experience_months: null,
    has_degree: raw.has_degree ?? false,
    skills,
    languages,
    location_preferences,
    job_titles: raw.target_roles_priority ?? raw.target_roles ?? null,
    salary_target,
    positioning: {
      seniority_target: raw.seniority_target,
      strengths: candidate.strengths ?? raw.domain_expertise,
      experience: candidate.experience ?? raw.experience,
      education: candidate.education ?? raw.education,
      certifications: candidate.certifications,
      projects: candidate.projects,
      contacts,
      career_goals: candidate.career_goals,
      aspirations: candidate.aspirations,
      free_notes: candidate.free_notes ?? (typeof raw.notes === 'string' ? raw.notes : raw.notes ? Object.entries(raw.notes).map(([k, v]) => `${k}: ${v}`).join('\n') : undefined),
      preferences: (work_mode || work_mode_flexibility || relocation != null || salary_annual_eur) ? {
        work_mode,
        work_mode_flexibility,
        relocation,
        salary_annual_eur,
      } : undefined,
      // Dict aperto per dettagli specifici del settore (cucina, sanità,
      // legale, edile, …). L'assistente popola le chiavi che ha senso per
      // la persona; il frontend le rende come lista key/value generica.
      sector_details: raw.sector_details && typeof raw.sector_details === 'object'
        ? raw.sector_details as Record<string, string | number | boolean | string[] | null>
        : undefined,
    },
    created_at: '',
    updated_at: '',
  }
}
