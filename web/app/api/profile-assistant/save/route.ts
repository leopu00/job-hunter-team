import { NextRequest, NextResponse } from 'next/server'
import { isSupabaseConfigured } from '@/lib/workspace'
import { createClient } from '@/lib/supabase/server'
import yaml from 'js-yaml'
import fs from 'fs'
import path from 'path'
import {
  JHT_CONFIG_PATH,
  JHT_PROFILE_DIR,
  JHT_PROFILE_YAML,
  JHT_USER_DIR,
} from '@/lib/jht-paths'

export const dynamic = 'force-dynamic'

const GLOBAL_CONFIG_PATH = JHT_CONFIG_PATH

export async function POST(req: NextRequest) {
  let body: { profile?: Record<string, unknown>; confirmed?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON non valido' }, { status: 400 })
  }

  if (!body.confirmed) {
    return NextResponse.json(
      { error: 'conferma utente richiesta (confirmed: true)' },
      { status: 400 }
    )
  }

  const profile = body.profile
  if (!profile || typeof profile !== 'object') {
    return NextResponse.json({ error: 'dati profilo richiesti' }, { status: 400 })
  }

  if (!profile.name || typeof profile.name !== 'string') {
    return NextResponse.json({ error: 'campo "name" richiesto' }, { status: 400 })
  }

  if (isSupabaseConfigured) {
    return await saveToSupabase(profile)
  }
  return saveToYaml(profile)
}

async function saveToSupabase(profile: Record<string, unknown>) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'non autenticato' }, { status: 401 })
  }

  const positioning = (profile.positioning ?? {}) as Record<string, unknown>

  const row = {
    user_id: user.id,
    name: profile.name,
    email: profile.email ?? null,
    location: profile.location ?? null,
    target_role: profile.target_role ?? null,
    experience_years: profile.experience_years ?? 0,
    experience_months: profile.experience_months ?? 0,
    has_degree: profile.has_degree ?? false,
    skills: profile.skills ?? [],
    languages: profile.languages ?? [],
    seniority_target: profile.seniority_target ?? null,
    job_titles: profile.job_titles ?? [],
    location_preferences: profile.location_preferences ?? [],
    salary_target: profile.salary_target ?? {},
    positioning: {
      strengths: positioning.strengths ?? [],
      experience: positioning.experience ?? [],
      education: positioning.education ?? [],
      certifications: positioning.certifications ?? [],
      projects: positioning.projects ?? [],
      contacts: positioning.contacts ?? {},
      career_goals: positioning.career_goals ?? {},
      aspirations: positioning.aspirations ?? {},
      free_notes: positioning.free_notes ?? '',
    },
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('candidate_profiles')
    .upsert(row, { onConflict: 'user_id' })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, profile: data })
}

function saveToYaml(profile: Record<string, unknown>) {
  fs.mkdirSync(JHT_PROFILE_DIR, { recursive: true })
  const profilePath = JHT_PROFILE_YAML
  const positioning = (profile.positioning ?? {}) as Record<string, unknown>
  const contacts = (positioning.contacts ?? {}) as Record<string, string>

  // Struttura YAML compatibile con candidate_profile.yml
  const yamlData: Record<string, unknown> = {
    name: profile.name,
    target_role: profile.target_role ?? '',
    location: profile.location ?? '',
    experience_years: profile.experience_years ?? 0,
    has_degree: profile.has_degree ?? false,
    seniority_target: profile.seniority_target ?? 'junior',
  }

  // Skills lista piatta (top-level)
  if (profile.skills && typeof profile.skills === 'object' && !Array.isArray(profile.skills)) {
    yamlData.skills = Object.values(profile.skills as Record<string, string[]>).flat()
  }

  // Lingue
  if (Array.isArray(profile.languages)) {
    yamlData.languages = (profile.languages as { language?: string; lingua?: string; level?: string; livello?: string }[]).map((l) => ({
      lingua: l.language ?? l.lingua ?? '',
      livello: l.level ?? l.livello ?? '',
    }))
  }

  // Location preferences
  if (Array.isArray(profile.location_preferences)) {
    yamlData.location_preferences = (profile.location_preferences as (string | { type?: string })[]).map((lp) =>
      typeof lp === 'string' ? lp : (lp.type ?? '')
    )
  }

  // Ruoli target
  if (Array.isArray(profile.job_titles)) {
    yamlData.target_roles_priority = profile.job_titles
  }

  // Salary target
  const salary = profile.salary_target as Record<string, unknown> | undefined
  if (salary) {
    yamlData.salary_target = {
      currency: salary.currency ?? 'EUR',
      min: salary.italy_min ?? salary.min ?? 0,
      max: salary.italy_max ?? salary.max ?? 0,
    }
  }

  // Sezione candidate (dettagliata)
  yamlData.candidate = {
    name: profile.name,
    target_role: profile.target_role ?? '',
    contacts: {
      email: profile.email ?? contacts.email ?? '',
      phone: contacts.phone ?? '',
      linkedin: contacts.linkedin ?? '',
      github: contacts.github ?? '',
      website: contacts.website ?? '',
    },
    skills: profile.skills ?? {},
    experience: positioning.experience ?? [],
    education: positioning.education ?? [],
    certifications: positioning.certifications ?? [],
    projects: positioning.projects ?? [],
    languages: Array.isArray(profile.languages)
      ? (profile.languages as { language?: string; lingua?: string; level?: string; livello?: string }[]).map((l) => ({
          lingua: l.language ?? l.lingua ?? '',
          livello: l.level ?? l.livello ?? '',
        }))
      : [],
    strengths: positioning.strengths ?? [],
    career_goals: positioning.career_goals ?? {},
    aspirations: positioning.aspirations ?? {},
    free_notes: positioning.free_notes ?? '',
  }

  try {
    const yamlStr = yaml.dump(yamlData, { lineWidth: 120, noRefs: true })
    fs.writeFileSync(profilePath, yamlStr, 'utf-8')
    syncTuiProfileCache(profile)
    return NextResponse.json({ ok: true, path: profilePath })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'scrittura YAML fallita'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

function syncTuiProfileCache(profile: Record<string, unknown>) {
  const existing = fs.existsSync(GLOBAL_CONFIG_PATH)
    ? JSON.parse(fs.readFileSync(GLOBAL_CONFIG_PATH, 'utf-8')) as Record<string, unknown>
    : {}

  const fullName = String(profile.name ?? '').trim()
  const parts = fullName.split(/\s+/).filter(Boolean)
  const skills = profile.skills && typeof profile.skills === 'object' && !Array.isArray(profile.skills)
    ? Object.values(profile.skills as Record<string, string[]>).flat().filter(Boolean)
    : []
  const locationPreferences = Array.isArray(profile.location_preferences)
    ? (profile.location_preferences as Array<string | { type?: string }>).map((item) => typeof item === 'string' ? item : (item.type ?? '')).filter(Boolean)
    : []
  const contacts = ((profile.positioning ?? {}) as Record<string, unknown>).contacts as Record<string, unknown> | undefined
  const salary = profile.salary_target as Record<string, unknown> | undefined

  const tuiProfile = {
    nome: parts[0] ?? '',
    cognome: parts.slice(1).join(' '),
    dataNascita: '',
    headline: '',
    targetRoles: Array.isArray(profile.job_titles) ? profile.job_titles : (profile.target_role ? [profile.target_role] : []),
    seniorityTarget: typeof profile.seniority_target === 'string' ? profile.seniority_target : '',
    competenze: skills,
    zona: typeof profile.location === 'string' ? profile.location : '',
    locationPreferences,
    tipoLavoro: '',
    languages: Array.isArray(profile.languages)
      ? (profile.languages as Array<Record<string, unknown>>).map((item) => [item.language ?? item.lingua, item.level ?? item.livello].filter(Boolean).join(' ').trim()).filter(Boolean)
      : [],
    strengths: Array.isArray(((profile.positioning ?? {}) as Record<string, unknown>).strengths)
      ? (((profile.positioning ?? {}) as Record<string, unknown>).strengths as string[]).filter(Boolean)
      : [],
    email: typeof profile.email === 'string' ? profile.email : String(contacts?.email ?? ''),
    linkedin: String(contacts?.linkedin ?? ''),
    portfolio: String(contacts?.website ?? contacts?.github ?? ''),
    salaryTarget: salary && (salary.italy_min != null || salary.min != null)
      ? `${salary.italy_min ?? salary.min}-${salary.italy_max ?? salary.max} ${salary.currency ?? 'EUR'}`
      : '',
    availability: '',
    workAuthorization: '',
    completato: Boolean(parts[0] && parts.slice(1).join(' ') && skills.length > 0 && locationPreferences.length > 0 && (Array.isArray(profile.job_titles) ? profile.job_titles.length > 0 : profile.target_role)),
    nomeCompleto: fullName,
  }

  const updated = {
    ...existing,
    workspace: JHT_USER_DIR,
    workspacePath: JHT_USER_DIR,
    profile: tuiProfile,
  }

  fs.mkdirSync(path.dirname(GLOBAL_CONFIG_PATH), { recursive: true })
  fs.writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(updated, null, 2) + '\n', 'utf-8')
}
