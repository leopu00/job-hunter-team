import { NextRequest, NextResponse } from 'next/server'
import yaml from 'js-yaml'
import { isSupabaseConfigured } from '@/lib/workspace'
import { verifyBearerToken } from '@/lib/cloud-sync/auth'
import { checkCloudSyncRateLimit } from '@/lib/cloud-sync/rate-limit'

export const dynamic = 'force-dynamic'

interface PositionIn {
  id: number
  title: string
  company: string
  url?: string | null
  location?: string | null
  remote_type?: string | null
  status?: string | null
  notes?: string | null
  source?: string | null
  jd_text?: string | null
  requirements?: string | null
  found_by?: string | null
  found_at?: string | null
  deadline?: string | null
  last_checked?: string | null
  salary_declared_min?: number | null
  salary_declared_max?: number | null
  salary_declared_currency?: string | null
  salary_estimated_min?: number | null
  salary_estimated_max?: number | null
  salary_estimated_currency?: string | null
  salary_estimated_source?: string | null
}

interface ScoreIn {
  position_id: number
  total_score: number
  experience_fit?: number | null
  salary_fit?: number | null
  stack_match?: number | null
  remote_fit?: number | null
  strategic_fit?: number | null
  breakdown?: string | null
  notes?: string | null
  scored_by?: string | null
  scored_at?: string | null
}

interface ApplicationIn {
  position_id: number
  cv_path?: string | null
  cv_pdf_path?: string | null
  cl_path?: string | null
  cl_pdf_path?: string | null
  status?: string | null
  critic_score?: number | null
  critic_verdict?: string | null
  critic_notes?: string | null
  written_at?: string | null
  applied_at?: string | null
  applied_via?: string | null
  response?: string | null
  response_at?: string | null
  written_by?: string | null
  reviewed_by?: string | null
  critic_reviewed_at?: string | null
  applied?: boolean | null
  cv_drive_id?: string | null
  cl_drive_id?: string | null
}

interface ProfileIn {
  yaml: string
  summaries?: Record<string, string>
}

interface PendingMessageIn {
  id: number
  agent: string
  body: string
  kind?: string | null
  related_position_id?: number | null
  delivered_via?: string | null
  delivered_at?: string | null
  acknowledged_at?: string | null
  user_reply?: string | null
  user_reply_at?: string | null
  agent_seen_reply_at?: string | null
  created_at?: string | null
}

interface PushBody {
  positions?: PositionIn[]
  scores?: ScoreIn[]
  applications?: ApplicationIn[]
  pending_user_messages?: PendingMessageIn[]
  profile?: ProfileIn
}

/**
 * Mappa il yaml parsato del candidate_profile.yml al payload della
 * tabella candidate_profiles. Schema tollerante: se i campi top-level
 * mancano, prova a leggerli dalla sezione `candidate:` (lo schema reale
 * scritto dall'Assistente). Tutto cio' che non riconosce va in
 * positioning come freeform.
 */
function mapYamlToProfile(raw: Record<string, unknown>, userId: string) {
  const obj = (v: unknown): Record<string, unknown> =>
    (v && typeof v === 'object' && !Array.isArray(v)) ? (v as Record<string, unknown>) : {}
  const arr = (v: unknown): unknown[] => Array.isArray(v) ? v : []
  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.trim().length > 0 ? v.trim() : null
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v
    : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : null
  const bool = (v: unknown): boolean | null => typeof v === 'boolean' ? v : null

  const cand = obj(raw.candidate)
  const contacts = obj(cand.contacts)
  const name = str(raw.name) ?? str(cand.name) ?? 'Candidato'
  const email = str(raw.email) ?? str(contacts.email)
  const location = str(raw.location) ?? str(cand.location)
  const yearsExp = num(raw.experience_years) ?? num(cand.experience_years) ?? 0
  const monthsExp = num(raw.experience_months) ?? num(cand.experience_months)
    ?? yearsExp * 12

  // positioning: dump dei campi narrativi (headline, summary, industry)
  // che non mappano a colonne strutturate. La dashboard sa leggerli da li'.
  const positioning: Record<string, unknown> = {}
  if (str(cand.headline)) positioning.headline = str(cand.headline)
  if (str(cand.summary)) positioning.summary = str(cand.summary)
  if (str(raw.industry)) positioning.industry = str(raw.industry)
  if (cand.experience) positioning.experience = cand.experience
  if (cand.education) positioning.education = cand.education

  return {
    user_id: userId,
    name,
    email,
    location,
    birth_year: num(raw.birth_year) ?? num(cand.birth_year),
    nationality: str(raw.nationality) ?? str(cand.nationality),
    work_authorization: arr(raw.work_authorization),
    target_role: str(raw.target_role) ?? str(cand.target_role),
    experience_years: Math.round(yearsExp),
    experience_months: Math.round(monthsExp),
    has_degree: bool(raw.has_degree) ?? bool(cand.has_degree) ?? false,
    languages: arr(raw.languages),
    // Skills puo' essere object {primary, secondary} o array piatto:
    // serializziamo as-is, la dashboard sa entrambi i formati.
    skills: (raw.skills && typeof raw.skills === 'object') ? raw.skills : [],
    seniority_target: str(raw.seniority_target) ?? str(cand.seniority_target),
    job_titles: arr(raw.job_titles),
    location_preferences: arr(raw.location_preferences),
    salary_target: obj(raw.salary_target),
    positioning,
  }
}

const ALLOWED_POSITION_STATUS = new Set([
  'new', 'checked', 'excluded', 'scored', 'writing', 'review', 'ready', 'applied', 'response',
])
const ALLOWED_APPLICATION_STATUS = new Set(['draft', 'review', 'approved', 'applied', 'response'])
const ALLOWED_CRITIC_VERDICT = new Set(['PASS', 'NEEDS_WORK', 'REJECT'])
const ALLOWED_MESSAGE_KIND = new Set(['notification', 'question', 'digest', 'alert'])
const ALLOWED_DELIVERED_VIA = new Set(['telegram', 'web'])

function normalizePositionStatus(s: string | null | undefined): string {
  if (!s) return 'new'
  return ALLOWED_POSITION_STATUS.has(s) ? s : 'new'
}

function normalizeApplicationStatus(s: string | null | undefined): string | null {
  if (!s) return null
  return ALLOWED_APPLICATION_STATUS.has(s) ? s : 'draft'
}

function normalizeCriticVerdict(v: string | null | undefined): string | null {
  if (!v) return null
  return ALLOWED_CRITIC_VERDICT.has(v) ? v : null
}

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'cloud sync non disponibile' }, { status: 400 })
  }

  const result = await verifyBearerToken(req)
  if (!result.ok) return result.res
  const { userId, admin } = result.data

  // Push e' write-heavy (positions+scores+applications upsert): cap
  // stretto a 20/min per token. Il limite globale del proxy resta sopra.
  const rl = await checkCloudSyncRateLimit('push', result.data.tokenId, 20)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit superato. Riprova tra poco.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(rl.retryAfterSec),
          'X-RateLimit-Limit': '20',
          'X-RateLimit-Remaining': '0',
        },
      },
    )
  }

  let body: PushBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'body JSON non valido' }, { status: 400 })
  }

  const positions = Array.isArray(body.positions) ? body.positions : []
  const scores = Array.isArray(body.scores) ? body.scores : []
  const applications = Array.isArray(body.applications) ? body.applications : []
  const pendingMessages = Array.isArray(body.pending_user_messages)
    ? body.pending_user_messages
    : []

  let positionsUpserted = 0
  let scoresUpserted = 0
  let applicationsUpserted = 0
  let pendingMessagesUpserted = 0
  const legacyToUuid = new Map<number, string>()

  // 1. Upsert positions via (user_id, legacy_id)
  if (positions.length > 0) {
    const payload = positions
      .filter((p) => typeof p.id === 'number' && p.title && p.company)
      .map((p) => ({
        user_id: userId,
        legacy_id: p.id,
        title: p.title,
        company: p.company,
        url: p.url ?? null,
        location: p.location ?? null,
        remote_type: p.remote_type ?? null,
        status: normalizePositionStatus(p.status),
        notes: p.notes ?? null,
        source: p.source ?? null,
        jd_text: p.jd_text ?? null,
        requirements: p.requirements ?? null,
        found_by: p.found_by ?? null,
        found_at: p.found_at ?? null,
        deadline: p.deadline ?? null,
        last_checked: p.last_checked ?? null,
        salary_declared_min: p.salary_declared_min ?? null,
        salary_declared_max: p.salary_declared_max ?? null,
        salary_declared_currency: p.salary_declared_currency ?? null,
        salary_estimated_min: p.salary_estimated_min ?? null,
        salary_estimated_max: p.salary_estimated_max ?? null,
        salary_estimated_currency: p.salary_estimated_currency ?? null,
        salary_estimated_source: p.salary_estimated_source ?? null,
      }))

    const { data: upserted, error } = await admin
      .from('positions')
      .upsert(payload, { onConflict: 'user_id,legacy_id' })
      .select('id, legacy_id')

    if (error) {
      return NextResponse.json(
        { error: `positions upsert: ${error.message}` },
        { status: 500 }
      )
    }

    positionsUpserted = upserted?.length ?? 0
    for (const row of upserted ?? []) {
      if (row.legacy_id != null) legacyToUuid.set(row.legacy_id, row.id)
    }
  }

  // 2. Upsert scores via position_id UUID
  if (scores.length > 0 && legacyToUuid.size > 0) {
    const payload = scores
      .map((s) => {
        const uuid = legacyToUuid.get(s.position_id)
        if (!uuid || typeof s.total_score !== 'number') return null
        return {
          user_id: userId,
          position_id: uuid,
          total_score: Math.max(0, Math.min(100, Math.round(s.total_score))),
          experience_fit: s.experience_fit ?? null,
          salary_fit: s.salary_fit ?? null,
          stack_match: s.stack_match ?? null,
          remote_fit: s.remote_fit ?? null,
          strategic_fit: s.strategic_fit ?? null,
          breakdown: s.breakdown ?? null,
          notes: s.notes ?? null,
          scored_by: s.scored_by ?? null,
          scored_at: s.scored_at ?? null,
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)

    if (payload.length > 0) {
      const { data: upserted, error } = await admin
        .from('scores')
        .upsert(payload, { onConflict: 'position_id' })
        .select('id')

      if (error) {
        return NextResponse.json(
          { error: `scores upsert: ${error.message}` },
          { status: 500 }
        )
      }
      scoresUpserted = upserted?.length ?? 0
    }
  }

  // 3. Upsert applications via position_id UUID
  if (applications.length > 0 && legacyToUuid.size > 0) {
    const payload = applications
      .map((a) => {
        const uuid = legacyToUuid.get(a.position_id)
        if (!uuid) return null
        return {
          user_id: userId,
          position_id: uuid,
          cv_path: a.cv_path ?? null,
          cv_pdf_path: a.cv_pdf_path ?? null,
          cl_path: a.cl_path ?? null,
          cl_pdf_path: a.cl_pdf_path ?? null,
          status: normalizeApplicationStatus(a.status),
          critic_score: a.critic_score ?? null,
          critic_verdict: normalizeCriticVerdict(a.critic_verdict),
          critic_notes: a.critic_notes ?? null,
          written_at: a.written_at ?? null,
          applied_at: a.applied_at ?? null,
          applied_via: a.applied_via ?? null,
          response: a.response ?? null,
          response_at: a.response_at ?? null,
          written_by: a.written_by ?? null,
          reviewed_by: a.reviewed_by ?? null,
          critic_reviewed_at: a.critic_reviewed_at ?? null,
          applied: a.applied ?? null,
          cv_drive_id: a.cv_drive_id ?? null,
          cl_drive_id: a.cl_drive_id ?? null,
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)

    if (payload.length > 0) {
      const { data: upserted, error } = await admin
        .from('applications')
        .upsert(payload, { onConflict: 'position_id' })
        .select('id')

      if (error) {
        return NextResponse.json(
          { error: `applications upsert: ${error.message}` },
          { status: 500 }
        )
      }
      applicationsUpserted = upserted?.length ?? 0
    }
  }

  // 3b. Upsert pending_user_messages via (user_id, legacy_id).
  // related_position_id (numero locale) -> UUID cloud via legacyToUuid se
  // disponibile. Se non lo conosciamo (push parziale o push successivo dove
  // la position esiste gia' cloud ma non in questo batch), passiamo NULL —
  // la dashboard mostra il messaggio senza link alla posizione, che e' un
  // degrado accettabile. Una soluzione completa farebbe un lookup
  // server-side per legacy_id mancanti, e' rimandata.
  if (pendingMessages.length > 0) {
    const payload = pendingMessages
      .filter((m) => typeof m.id === 'number' && m.agent && m.body)
      .map((m) => {
        const relatedUuid =
          m.related_position_id != null
            ? legacyToUuid.get(m.related_position_id) ?? null
            : null
        return {
          user_id: userId,
          legacy_id: m.id,
          agent: m.agent,
          body: m.body,
          kind: m.kind && ALLOWED_MESSAGE_KIND.has(m.kind) ? m.kind : 'notification',
          related_position_id: relatedUuid,
          delivered_via:
            m.delivered_via && ALLOWED_DELIVERED_VIA.has(m.delivered_via)
              ? m.delivered_via
              : null,
          delivered_at: m.delivered_at ?? null,
          acknowledged_at: m.acknowledged_at ?? null,
          user_reply: m.user_reply ?? null,
          user_reply_at: m.user_reply_at ?? null,
          agent_seen_reply_at: m.agent_seen_reply_at ?? null,
          // created_at lato cloud usa il default now() solo se l'INSERT lo
          // omette. Forziamo a quello locale cosi' l'ordinamento per timestamp
          // riflette quando l'agente ha scritto, non quando il push e' arrivato.
          ...(m.created_at ? { created_at: m.created_at } : {}),
        }
      })

    if (payload.length > 0) {
      const { data: upserted, error } = await admin
        .from('pending_user_messages')
        .upsert(payload, { onConflict: 'user_id,legacy_id' })
        .select('id')

      if (error) {
        return NextResponse.json(
          { error: `pending_user_messages upsert: ${error.message}` },
          { status: 500 }
        )
      }
      pendingMessagesUpserted = upserted?.length ?? 0
    }
  }

  // 4. Profile upsert (opzionale, indipendente da positions/scores/apps)
  let profileUpserted = false
  let profileError: string | null = null
  if (body.profile && typeof body.profile.yaml === 'string') {
    const yamlRaw = body.profile.yaml
    if (yamlRaw.length > 64 * 1024) {
      profileError = 'profile yaml troppo grande (>64 KB)'
    } else {
      try {
        const parsed = yaml.load(yamlRaw, { schema: yaml.CORE_SCHEMA })
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const profileRow = mapYamlToProfile(parsed as Record<string, unknown>, userId)
          const { error: pe } = await admin
            .from('candidate_profiles')
            .upsert(profileRow, { onConflict: 'user_id' })
          if (pe) {
            profileError = pe.message
          } else {
            profileUpserted = true
          }
        } else {
          profileError = 'yaml non e\' un oggetto top-level'
        }
      } catch (e) {
        profileError = `yaml parse: ${(e as Error).message}`
      }
    }
  }

  return NextResponse.json({
    ok: true,
    positions: { upserted: positionsUpserted },
    scores: { upserted: scoresUpserted },
    applications: { upserted: applicationsUpserted },
    pending_user_messages: { upserted: pendingMessagesUpserted },
    profile: { upserted: profileUpserted, error: profileError },
  })
}
