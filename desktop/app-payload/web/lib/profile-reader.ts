import yaml from 'js-yaml'
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
        const raw = yaml.load(fs.readFileSync(p, 'utf8')) as any
        if (!raw) return null
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
    const raw = yaml.load(fs.readFileSync(p, 'utf8')) as any
    if (!raw) return null
    const profile = mapYamlToProfile(raw)
    if (!profile.name && !profile.target_role) return null
    // Rigetta il file template non compilato (valori placeholder dell'esempio)
    if (profile.name === 'Nome Cognome' || profile.email === 'nome.cognome@example.com') return null
    return profile
  } catch {
    return null
  }
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

  // Location preferences
  const rawLoc = raw.location_preferences ?? []
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
    },
    created_at: '',
    updated_at: '',
  }
}
