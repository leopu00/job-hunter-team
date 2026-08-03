import { load as loadYaml } from 'js-yaml'
import fs from 'fs'
import path from 'path'
import type { CandidateProfile } from './types'

export function readProfile(workspacePath: string): CandidateProfile | null {
  // Cerca: 1) workspace, 2) repo root
  const paths = [
    path.join(workspacePath, 'profile', 'candidate_profile.yml'),
    path.join(workspacePath, 'candidate_profile.yml'),
    path.resolve(process.cwd(), '..', 'candidate_profile.yml'),
  ]

  for (const p of paths) {
    if (fs.existsSync(p)) {
      try {
        const raw = asRecord(loadYaml(fs.readFileSync(p, 'utf8')))
        if (!Object.keys(raw).length) return null
        return mapYamlToProfile(raw)
      } catch {
        return null
      }
    }
  }
  return null
}

/**
 * Legge il profilo SOLO dalla cartella workspace (nessun fallback globale).
 * Restituisce null se il file non esiste, è vuoto, o mancano i campi chiave.
 * Usare questa funzione per il check "profilo configurato" in dashboard.
 */
export function readWorkspaceProfile(workspacePath: string): CandidateProfile | null {
  // Cerca prima in profile/, poi fallback alla root per compatibilita'
  let p = path.join(workspacePath, 'profile', 'candidate_profile.yml')
  if (!fs.existsSync(p)) {
    p = path.join(workspacePath, 'candidate_profile.yml')
  }
  if (!fs.existsSync(p)) return null
  try {
    const raw = asRecord(loadYaml(fs.readFileSync(p, 'utf8')))
    if (!Object.keys(raw).length) return null
    const profile = mapYamlToProfile(raw)
    if (!profile.name && !profile.target_role) return null
    // Rigetta il file template non compilato (valori placeholder dell'esempio)
    if (profile.name === 'Nome Cognome' || profile.email === 'nome.cognome@example.com') return null
    return profile
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : null
}

function mapYamlToProfile(raw: Record<string, unknown>): CandidateProfile {
  const candidate = asRecord(raw.candidate)
  const personal = asRecord(raw.personal)

  // Skills: cerca in candidate.skills, raw.skills (dict o lista)
  let skills: Record<string, string[]> | null = null
  const rawSkills = candidate.skills ?? raw.skills
  if (rawSkills && typeof rawSkills === 'object' && !Array.isArray(rawSkills)) {
    skills = Object.fromEntries(
      Object.entries(rawSkills).map(([key, value]) => [key, stringArray(value) ?? []]),
    )
  } else if (Array.isArray(rawSkills)) {
    skills = { primary: rawSkills.filter((item): item is string => typeof item === 'string') }
  }

  // Languages: normalizza lingua/livello -> language/level
  const rawLangs = candidate.languages ?? raw.languages ?? []
  const languages = Array.isArray(rawLangs)
    ? rawLangs.map((value) => {
        const language = asRecord(value)
        return {
          language: optionalString(language.language ?? language.lingua) ?? '',
          level: optionalString(language.level ?? language.livello) ?? '',
        }
      })
    : null

  // Location preferences
  const rawLoc = raw.location_preferences ?? []
  const location_preferences = Array.isArray(rawLoc)
    ? rawLoc.flatMap((value) => {
        if (typeof value === 'string') return [{ type: value }]
        const location = asRecord(value)
        const type = optionalString(location.type)
        if (!type) return []
        return [{
          type,
          region: optionalString(location.region) ?? undefined,
          cities: stringArray(location.cities) ?? undefined,
          max_days: optionalNumber(location.max_days) ?? undefined,
          note: optionalString(location.note) ?? undefined,
        }]
      })
    : null

  // Salary target
  const rawSalary = asRecord(raw.salary_target)
  const salaryMin = optionalNumber(rawSalary.min)
  const salaryMax = optionalNumber(rawSalary.max)
  const salary_target = salaryMin != null
    ? {
        currency: optionalString(rawSalary.currency) ?? 'EUR',
        italy_min: salaryMin,
        italy_max: salaryMax ?? 0,
        remote_eu_min: optionalNumber(rawSalary.remote_eu_min) ?? salaryMin,
        remote_eu_max: optionalNumber(rawSalary.remote_eu_max) ?? salaryMax ?? 0,
      }
    : null

  // Contacts: cerca in candidate.contacts o personal
  const contacts = Object.keys(asRecord(candidate.contacts)).length
    ? asRecord(candidate.contacts)
    : {
        email: personal.email,
        phone: personal.phone,
        linkedin: personal.linkedin,
        github: personal.github,
        website: personal.website,
      }
  const notes = asRecord(raw.notes)

  return {
    id: 'local',
    user_id: 'local',
    name: optionalString(candidate.name ?? personal.name ?? raw.name),
    email: optionalString(contacts.email ?? personal.email),
    target_role: optionalString(candidate.target_role ?? raw.target_role) ?? stringArray(raw.target_roles)?.[0] ?? null,
    location: optionalString(raw.location ?? personal.location),
    experience_years: optionalNumber(raw.experience_years),
    experience_months: null,
    has_degree: typeof raw.has_degree === 'boolean' ? raw.has_degree : false,
    skills,
    languages,
    location_preferences,
    job_titles: stringArray(raw.target_roles_priority) ?? stringArray(raw.target_roles),
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
      free_notes: optionalString(candidate.free_notes) ?? (typeof raw.notes === 'string' ? raw.notes : Object.keys(notes).length ? Object.entries(notes).map(([k, v]) => `${k}: ${String(v)}`).join('\n') : undefined),
    },
    created_at: '',
    updated_at: '',
  }
}
