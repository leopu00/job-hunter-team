import { NextRequest, NextResponse } from "next/server";
import yaml from "js-yaml";
import { isSupabaseConfigured } from "@/lib/workspace";
import { verifyBearerToken } from "@/lib/cloud-sync/auth";
import { checkCloudSyncRateLimit } from "@/lib/cloud-sync/rate-limit";
import { mapYamlToCanonical, syncProfileToSupabase } from "@/lib/profile-sync";

export const dynamic = "force-dynamic";

interface PositionIn {
  id: number;
  title: string;
  company: string;
  url?: string | null;
  location?: string | null;
  remote_type?: string | null;
  status?: string | null;
  notes?: string | null;
  source?: string | null;
  jd_text?: string | null;
  requirements?: string | null;
  found_by?: string | null;
  found_at?: string | null;
  deadline?: string | null;
  last_checked?: string | null;
  // Istanza dell'ultimo agente che ha agito (es. analista-4). Il team la scrive
  // in SQLite positions.last_actor; senza questo campo l'Analista resta generico
  // sul cloud. Mig Supabase 039.
  last_actor?: string | null;
  // Metadati location/categoria (Parte B sync, 2026-06-14): prodotti
  // dall'analista, alimentano i grafici categoria/mappa della dashboard
  // (che esiste già). Colonne cloud già presenti — nessuna migration.
  role_family?: string | null;
  loc_city?: string | null;
  loc_region?: string | null;
  loc_country?: string | null;
  loc_country_code?: string | null;
  loc_continent?: string | null;
  work_mode?: string | null;
  work_country?: string | null;
  work_country_code?: string | null;
  location_notes?: string | null;
  office_address?: string | null;
  office_lat?: number | null;
  office_lon?: number | null;
  // SQLite invia 0|1 integer; Supabase ha BOOLEAN — coerce sul payload
  // (stesso pattern di write_requested/geocode_requested).
  is_multi_location?: number | boolean | null;
  office_geocoded?: number | boolean | null;
  office_verified?: number | boolean | null;
  salary_declared_min?: number | null;
  salary_declared_max?: number | null;
  salary_declared_currency?: string | null;
  salary_estimated_min?: number | null;
  salary_estimated_max?: number | null;
  salary_estimated_currency?: string | null;
  salary_estimated_source?: string | null;
  // Writer-on-demand (V6): user-driven flag per spawn Scrittori on-demand.
  // Mig Supabase 024. Il valore arriva da SQLite (0|1 integer) e va mappato
  // a BOOLEAN sul payload upsert.
  write_requested?: number | boolean | null;
  write_requested_at?: string | null;
  // Geocoding-on-demand (V8): user-driven flag per office-geocoding
  // precision. Mig Supabase 027. Stesso pattern di write_requested.
  geocode_requested?: number | boolean | null;
  geocode_requested_at?: string | null;
}

interface ScoreIn {
  position_id: number;
  total_score: number;
  experience_fit?: number | null;
  salary_fit?: number | null;
  stack_match?: number | null;
  remote_fit?: number | null;
  strategic_fit?: number | null;
  breakdown?: string | null;
  notes?: string | null;
  scored_by?: string | null;
  scored_at?: string | null;
}

interface ApplicationIn {
  position_id: number;
  cv_path?: string | null;
  cv_pdf_path?: string | null;
  cl_path?: string | null;
  cl_pdf_path?: string | null;
  status?: string | null;
  critic_score?: number | null;
  critic_verdict?: string | null;
  critic_notes?: string | null;
  written_at?: string | null;
  applied_at?: string | null;
  applied_via?: string | null;
  response?: string | null;
  response_at?: string | null;
  written_by?: string | null;
  reviewed_by?: string | null;
  critic_reviewed_at?: string | null;
  applied?: boolean | null;
  cv_drive_id?: string | null;
  cl_drive_id?: string | null;
}

interface ProfileIn {
  yaml: string;
  summaries?: Record<string, string>;
}

interface PendingMessageIn {
  id: number;
  agent: string;
  body: string;
  kind?: string | null;
  related_position_id?: number | null;
  delivered_via?: string | null;
  delivered_at?: string | null;
  acknowledged_at?: string | null;
  user_reply?: string | null;
  user_reply_at?: string | null;
  agent_seen_reply_at?: string | null;
  created_at?: string | null;
}

interface SentinelTickIn {
  sample_key?: string | null;
  ts: string;
  provider: string;
  usage: number;
  delta?: number | null;
  velocity?: number | null;
  velocity_smooth?: number | null;
  velocity_ideal?: number | null;
  projection?: number | null;
  projection_naive?: number | null;
  velocity_decreasing?: boolean | null;
  status?: string | null;
  throttle?: number | null;
  reset_at?: string | null;
  weekly_usage?: number | null;
  source?: string | null;
  session_id?: string | null;
  host?: Record<string, unknown> | null;
  host_level?: string | null;
  raw?: Record<string, unknown> | null;
}

// Tombstones (SQLite V7): righe (table_name, legacy_id, deleted_at)
// emesse dai trigger BEFORE DELETE su positions/scores/applications.
// Il receive le interpreta come soft-delete cloud: UPDATE deleted_at.
// Vedi mig 025 + shared/skills/_db.py _migrate_v6_to_v7_tombstones.
interface TombstoneIn {
  table_name: "positions" | "scores" | "applications";
  legacy_id: number;
  deleted_at: string; // ISO timestamp client-side (preserva il "quando")
}

interface PushBody {
  positions?: PositionIn[];
  scores?: ScoreIn[];
  applications?: ApplicationIn[];
  pending_user_messages?: PendingMessageIn[];
  sentinel_ticks?: SentinelTickIn[];
  tombstones?: TombstoneIn[];
  profile?: ProfileIn;
}

const ALLOWED_POSITION_STATUS = new Set([
  "new",
  "checked",
  "excluded",
  "scored",
  "writing",
  "review",
  "ready",
  "applied",
  "response",
]);
const ALLOWED_APPLICATION_STATUS = new Set([
  "draft",
  "review",
  "approved",
  "applied",
  "response",
]);
const ALLOWED_CRITIC_VERDICT = new Set(["PASS", "NEEDS_WORK", "REJECT"]);
const ALLOWED_MESSAGE_KIND = new Set([
  "notification",
  "question",
  "digest",
  "alert",
]);
const ALLOWED_DELIVERED_VIA = new Set(["telegram", "web"]);

function normalizePositionStatus(s: string | null | undefined): string {
  if (!s) return "new";
  return ALLOWED_POSITION_STATUS.has(s) ? s : "new";
}

function normalizeApplicationStatus(
  s: string | null | undefined,
): string | null {
  if (!s) return null;
  return ALLOWED_APPLICATION_STATUS.has(s) ? s : "draft";
}

function normalizeCriticVerdict(v: string | null | undefined): string | null {
  if (!v) return null;
  return ALLOWED_CRITIC_VERDICT.has(v) ? v : null;
}

function finiteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function finiteInteger(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) ? v : null;
}

function cleanText(v: unknown, fallback: string | null = null): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json(
      { error: "cloud sync non disponibile" },
      { status: 400 },
    );
  }

  const result = await verifyBearerToken(req);
  if (!result.ok) return result.res;
  const { userId, admin } = result.data;

  // Single-team enforcement (regola lockata vps.md:392): se team_state
  // ha un active_device_id non-null e non corrisponde al token corrente,
  // rifiuta il push con 409. Lascia passare se active_device_id è null
  // (nessuno ha mai claimato) per backward-compat con device legacy.
  const tsCheck = (await admin
    .from("team_state")
    .select("active_device_id, last_heartbeat_at")
    .eq("user_id", userId)
    .maybeSingle()) as {
    data: {
      active_device_id: string | null;
      last_heartbeat_at: string | null;
    } | null;
    error: { message: string } | null;
  };
  if (
    tsCheck.data &&
    tsCheck.data.active_device_id &&
    tsCheck.data.active_device_id !== result.data.tokenId
  ) {
    return NextResponse.json(
      {
        error: "not_active_device",
        message:
          "Questo device non è più il team attivo (un altro device ha fatto claim). " +
          'Spegni il team locale o fai POST /api/team-state/claim {"force":true} per riprendere il controllo.',
        active_device_id: tsCheck.data.active_device_id,
      },
      { status: 409 },
    );
  }

  // Push e' write-heavy (positions+scores+applications upsert): cap
  // stretto a 20/min per token. Il limite globale del proxy resta sopra.
  const rl = await checkCloudSyncRateLimit("push", result.data.tokenId, 20);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limit superato. Riprova tra poco." },
      {
        status: 429,
        headers: {
          "Retry-After": String(rl.retryAfterSec),
          "X-RateLimit-Limit": "20",
          "X-RateLimit-Remaining": "0",
        },
      },
    );
  }

  let body: PushBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "body JSON non valido" },
      { status: 400 },
    );
  }

  const positions = Array.isArray(body.positions) ? body.positions : [];
  const scores = Array.isArray(body.scores) ? body.scores : [];
  const applications = Array.isArray(body.applications)
    ? body.applications
    : [];
  const pendingMessages = Array.isArray(body.pending_user_messages)
    ? body.pending_user_messages
    : [];
  const sentinelTicks = Array.isArray(body.sentinel_ticks)
    ? body.sentinel_ticks.slice(-1000)
    : [];
  const tombstones = Array.isArray(body.tombstones)
    ? body.tombstones.slice(0, 1000)
    : [];

  let positionsUpserted = 0;
  let scoresUpserted = 0;
  let applicationsUpserted = 0;
  let pendingMessagesUpserted = 0;
  let sentinelTicksUpserted = 0;
  let tombstonesApplied = 0;
  const legacyToUuid = new Map<number, string>();

  // 1. Upsert positions via (user_id, legacy_id)
  if (positions.length > 0) {
    const payload = positions
      .filter((p) => typeof p.id === "number" && p.title && p.company)
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
        last_actor: p.last_actor ?? null,
        // Metadati location/categoria (Parte B sync) — alimentano i grafici
        // categoria/mappa della dashboard. Text/numeric: passthrough.
        role_family: p.role_family ?? null,
        loc_city: p.loc_city ?? null,
        loc_region: p.loc_region ?? null,
        loc_country: p.loc_country ?? null,
        loc_country_code: p.loc_country_code ?? null,
        loc_continent: p.loc_continent ?? null,
        work_mode: p.work_mode ?? null,
        work_country: p.work_country ?? null,
        work_country_code: p.work_country_code ?? null,
        location_notes: p.location_notes ?? null,
        office_address: p.office_address ?? null,
        office_lat: p.office_lat ?? null,
        office_lon: p.office_lon ?? null,
        // boolean: SQLite 0|1 → BOOLEAN (default false se assente), come write_requested.
        is_multi_location:
          p.is_multi_location == null
            ? false
            : typeof p.is_multi_location === "boolean"
              ? p.is_multi_location
              : p.is_multi_location === 1,
        office_geocoded:
          p.office_geocoded == null
            ? false
            : typeof p.office_geocoded === "boolean"
              ? p.office_geocoded
              : p.office_geocoded === 1,
        office_verified:
          p.office_verified == null
            ? false
            : typeof p.office_verified === "boolean"
              ? p.office_verified
              : p.office_verified === 1,
        salary_declared_min: p.salary_declared_min ?? null,
        salary_declared_max: p.salary_declared_max ?? null,
        salary_declared_currency: p.salary_declared_currency ?? null,
        salary_estimated_min: p.salary_estimated_min ?? null,
        salary_estimated_max: p.salary_estimated_max ?? null,
        salary_estimated_currency: p.salary_estimated_currency ?? null,
        salary_estimated_source: p.salary_estimated_source ?? null,
        // SQLite invia integer (0|1); Supabase ha BOOLEAN — coerce esplicito.
        // Default FALSE quando il campo manca (compat con DB pre-V6 / pre-V8
        // / push legacy).
        write_requested:
          p.write_requested == null
            ? false
            : typeof p.write_requested === "boolean"
              ? p.write_requested
              : p.write_requested === 1,
        write_requested_at: p.write_requested_at ?? null,
        geocode_requested:
          p.geocode_requested == null
            ? false
            : typeof p.geocode_requested === "boolean"
              ? p.geocode_requested
              : p.geocode_requested === 1,
        geocode_requested_at: p.geocode_requested_at ?? null,
      }));

    const { data: upserted, error } = await admin
      .from("positions")
      .upsert(payload, { onConflict: "user_id,legacy_id" })
      .select("id, legacy_id");

    if (error) {
      return NextResponse.json(
        { error: `positions upsert: ${error.message}` },
        { status: 500 },
      );
    }

    positionsUpserted = upserted?.length ?? 0;
    for (const row of upserted ?? []) {
      if (row.legacy_id != null) legacyToUuid.set(row.legacy_id, row.id);
    }
  }

  // 2. Upsert scores via position_id UUID
  if (scores.length > 0 && legacyToUuid.size > 0) {
    const payload = scores
      .map((s) => {
        const uuid = legacyToUuid.get(s.position_id);
        if (!uuid || typeof s.total_score !== "number") return null;
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
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (payload.length > 0) {
      const { data: upserted, error } = await admin
        .from("scores")
        .upsert(payload, { onConflict: "position_id" })
        .select("id");

      if (error) {
        return NextResponse.json(
          { error: `scores upsert: ${error.message}` },
          { status: 500 },
        );
      }
      scoresUpserted = upserted?.length ?? 0;
    }
  }

  // 3. Upsert applications via position_id UUID
  if (applications.length > 0 && legacyToUuid.size > 0) {
    const payload = applications
      .map((a) => {
        const uuid = legacyToUuid.get(a.position_id);
        if (!uuid) return null;
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
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (payload.length > 0) {
      const { data: upserted, error } = await admin
        .from("applications")
        .upsert(payload, { onConflict: "position_id" })
        .select("id");

      if (error) {
        return NextResponse.json(
          { error: `applications upsert: ${error.message}` },
          { status: 500 },
        );
      }
      applicationsUpserted = upserted?.length ?? 0;
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
      .filter((m) => typeof m.id === "number" && m.agent && m.body)
      .map((m) => {
        const relatedUuid =
          m.related_position_id != null
            ? (legacyToUuid.get(m.related_position_id) ?? null)
            : null;
        return {
          user_id: userId,
          legacy_id: m.id,
          agent: m.agent,
          body: m.body,
          kind:
            m.kind && ALLOWED_MESSAGE_KIND.has(m.kind)
              ? m.kind
              : "notification",
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
        };
      });

    if (payload.length > 0) {
      const { data: upserted, error } = await admin
        .from("pending_user_messages")
        .upsert(payload, { onConflict: "user_id,legacy_id" })
        .select("id");

      if (error) {
        return NextResponse.json(
          { error: `pending_user_messages upsert: ${error.message}` },
          { status: 500 },
        );
      }
      pendingMessagesUpserted = upserted?.length ?? 0;
    }
  }

  // 3c. Upsert sentinel bridge ticks. Questi arrivano dal JSONL
  // /jht_home/logs/sentinel-data.jsonl sulla VPS e alimentano i grafici
  // rate-budget anche su jobhunterteam.ai, dove non esiste filesystem locale.
  if (sentinelTicks.length > 0) {
    const payload = sentinelTicks
      .map((t) => {
        const tsMs = Date.parse(t.ts);
        const usage = finiteNumber(t.usage);
        const provider = cleanText(t.provider);
        if (!Number.isFinite(tsMs) || usage === null || !provider) return null;
        const isoTs = new Date(tsMs).toISOString();
        const source = cleanText(t.source);
        const sessionId = cleanText(t.session_id);
        const sampleKey =
          cleanText(t.sample_key) ??
          `${isoTs}|${provider}|${source ?? ""}|${sessionId ?? ""}`;
        return {
          user_id: userId,
          sample_key: sampleKey,
          ts: isoTs,
          provider,
          usage,
          delta: finiteNumber(t.delta),
          velocity: finiteNumber(t.velocity),
          velocity_smooth: finiteNumber(t.velocity_smooth),
          velocity_ideal: finiteNumber(t.velocity_ideal),
          projection: finiteNumber(t.projection),
          projection_naive: finiteNumber(t.projection_naive),
          velocity_decreasing:
            typeof t.velocity_decreasing === "boolean"
              ? t.velocity_decreasing
              : null,
          status: cleanText(t.status, "OK"),
          throttle: finiteInteger(t.throttle),
          reset_at: cleanText(t.reset_at),
          weekly_usage: finiteNumber(t.weekly_usage),
          source,
          session_id: sessionId,
          host: isPlainObject(t.host) ? t.host : null,
          host_level: cleanText(t.host_level),
          raw: isPlainObject(t.raw) ? t.raw : t,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (payload.length > 0) {
      const { data: upserted, error } = await admin
        .from("sentinel_ticks")
        .upsert(payload, { onConflict: "user_id,sample_key" })
        .select("id");

      if (error) {
        return NextResponse.json(
          { error: `sentinel_ticks upsert: ${error.message}` },
          { status: 500 },
        );
      }
      sentinelTicksUpserted = upserted?.length ?? 0;
    }
  }

  // 3d. Tombstones (soft-delete su positions/scores/applications).
  // Volume tipico: 0-10 righe per push (gli agenti hanno regola NO DELETE,
  // i DELETE veri arrivano da migrazioni one-shot tipo db_migrate_v2).
  // Quando viene cancellata una position, scout/critico potrebbero anche
  // generare tombstones per scores/applications nello stesso tick.
  //
  // Logica:
  //   - positions: UPDATE WHERE user_id, legacy_id (1:1 con cloud).
  //   - scores/applications: lato cloud usano position_id UUID; risolviamo
  //     prima legacy_id → UUID via lookup positions, poi UPDATE.
  //
  // Idempotente: il filter `deleted_at IS NULL` evita di sovrascrivere
  // tombstone già applicati (un re-push dopo cursor reset non rompe nulla).
  if (tombstones.length > 0) {
    const byTable = {
      positions: [] as TombstoneIn[],
      scores: [] as TombstoneIn[],
      applications: [] as TombstoneIn[],
    };
    for (const t of tombstones) {
      if (!t || typeof t.legacy_id !== "number" || !t.deleted_at) continue;
      if (
        t.table_name === "positions" ||
        t.table_name === "scores" ||
        t.table_name === "applications"
      ) {
        byTable[t.table_name].push(t);
      }
    }

    // Risolvi legacy_id → UUID per scores/applications. Riusa il mapping
    // già popolato dai positions upsert quando possibile; integra con
    // lookup esplicito per i legacy_id che non sono passati dal push.
    const needsLookup = new Set<number>();
    for (const t of [...byTable.scores, ...byTable.applications]) {
      if (!legacyToUuid.has(t.legacy_id)) needsLookup.add(t.legacy_id);
    }
    if (needsLookup.size > 0) {
      const { data: rows } = await admin
        .from("positions")
        .select("id, legacy_id")
        .eq("user_id", userId)
        .in("legacy_id", Array.from(needsLookup));
      for (const r of rows ?? []) {
        if (r.legacy_id != null) legacyToUuid.set(r.legacy_id, r.id as string);
      }
    }

    for (const t of byTable.positions) {
      const { error } = await admin
        .from("positions")
        .update({ deleted_at: t.deleted_at })
        .eq("user_id", userId)
        .eq("legacy_id", t.legacy_id)
        .is("deleted_at", null);
      if (!error) tombstonesApplied++;
    }
    for (const t of byTable.scores) {
      const uuid = legacyToUuid.get(t.legacy_id);
      if (!uuid) continue;
      const { error } = await admin
        .from("scores")
        .update({ deleted_at: t.deleted_at })
        .eq("position_id", uuid)
        .is("deleted_at", null);
      if (!error) tombstonesApplied++;
    }
    for (const t of byTable.applications) {
      const uuid = legacyToUuid.get(t.legacy_id);
      if (!uuid) continue;
      const { error } = await admin
        .from("applications")
        .update({ deleted_at: t.deleted_at })
        .eq("position_id", uuid)
        .is("deleted_at", null);
      if (!error) tombstonesApplied++;
    }
  }

  // 4. Profile upsert (opzionale, indipendente da positions/scores/apps)
  let profileUpserted = false;
  let profileError: string | null = null;
  if (body.profile && typeof body.profile.yaml === "string") {
    const yamlRaw = body.profile.yaml;
    if (yamlRaw.length > 64 * 1024) {
      profileError = "profile yaml troppo grande (>64 KB)";
    } else {
      try {
        const parsed = yaml.load(yamlRaw, { schema: yaml.CORE_SCHEMA });
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          // Modello a 3 livelli: candidate_profiles (core + JSONB legacy) +
          // tabelle normalizzate + candidate_blocks + candidate_contacts.
          // Best-effort sulle tabelle figlie; il core resta critico.
          const canonical = mapYamlToCanonical(
            parsed as Record<string, unknown>,
            userId,
            body.profile.summaries ?? {},
          );
          const sync = await syncProfileToSupabase(admin, userId, canonical);
          if (!sync.ok) {
            profileError = sync.error;
          } else {
            profileUpserted = true;
            if (sync.warnings.length) {
              console.warn(
                "[cloud-sync/push] profile sync warnings:",
                sync.warnings,
              );
            }
            // Segna lo stato di onboarding: primo upsert di candidate_profiles
            // con successo = profilo configurato. Best-effort, non rompe la
            // response del push se fallisce. Il flag e' "primo successo" —
            // sync ripetuti non sovrascrivono profile_configured_at.
            try {
              const { data: existing } = await admin
                .from("user_onboarding_state")
                .select("profile_configured_at")
                .eq("user_id", userId)
                .maybeSingle();
              if (!existing?.profile_configured_at) {
                const nowIso = new Date().toISOString();
                await admin.from("user_onboarding_state").upsert(
                  {
                    user_id: userId,
                    profile_configured_at: nowIso,
                    updated_at: nowIso,
                  },
                  { onConflict: "user_id" },
                );
              }
            } catch {
              // best-effort
            }
          }
        } else {
          profileError = "yaml non e' un oggetto top-level";
        }
      } catch (e) {
        profileError = `yaml parse: ${(e as Error).message}`;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    positions: { upserted: positionsUpserted },
    scores: { upserted: scoresUpserted },
    applications: { upserted: applicationsUpserted },
    pending_user_messages: { upserted: pendingMessagesUpserted },
    sentinel_ticks: { upserted: sentinelTicksUpserted },
    tombstones: { applied: tombstonesApplied },
    profile: { upserted: profileUpserted, error: profileError },
  });
}
