import { NextRequest, NextResponse } from 'next/server'
import { isSupabaseConfigured } from '@/lib/workspace'
import { createClient } from '@/lib/supabase/server'
import yaml from 'js-yaml'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

const COOKIE_NAME = 'jht_workspace'

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
  return saveToYaml(req, profile)
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

function saveToYaml(req: NextRequest, profile: Record<string, unknown>) {
  const wsPath = req.cookies.get(COOKIE_NAME)?.value
  if (!wsPath) {
    return NextResponse.json(
      { error: 'workspace non configurato' },
      { status: 500 }
    )
  }

  const profileDir = path.join(wsPath, 'profile')
  fs.mkdirSync(profileDir, { recursive: true })
  const profilePath = path.join(profileDir, 'candidate_profile.yml')
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
    return NextResponse.json({ ok: true, path: profilePath })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'scrittura YAML fallita'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
