import { NextResponse } from "next/server";
import Database from "better-sqlite3";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth";
import { getLocalDbPath, localDbExists } from "@/lib/cloud-sync/local";
import { writeSyncState } from "@/lib/cloud-sync/state";
import {
  invalidateStaleCriticVerdict,
  normalizeApplicationStatus,
  normalizeCriticVerdict,
  normalizePositionStatus,
} from "@/lib/sync-vocabulary";
import { sanitizedError } from "@/lib/error-response";
import {
  summarizeOutOfRange,
  type OutOfRangeSummary,
} from "@/lib/score-ranges";
import { readSqliteTableCompatible } from "@/lib/sqlite-compatible-read";

export const dynamic = "force-dynamic";

const POSITIONS_COLUMNS = [
  "id",
  "title",
  "company",
  "url",
  "location",
  "remote_type",
  "status",
  "notes",
  "source",
  "jd_text",
  "requirements",
  "found_by",
  "found_at",
  "deadline",
  "last_checked",
  "salary_declared_min",
  "salary_declared_max",
  "salary_declared_currency",
  "salary_estimated_min",
  "salary_estimated_max",
  "salary_estimated_currency",
  "salary_estimated_source",
  // Writer-on-demand (V6): user-driven CV request flag — mirror del
  // push CLI in cli/src/commands/cloud.js per parita' tra i due path.
  "write_requested",
  "write_requested_at",
  "write_request_kind",
  // Geocoding-on-demand (V8): user-driven office-geocoding flag, mig 027.
  "geocode_requested",
  "geocode_requested_at",
];

const SCORES_COLUMNS = [
  "position_id",
  "total_score",
  "experience_fit",
  "salary_fit",
  "stack_match",
  "remote_fit",
  "strategic_fit",
  "breakdown",
  "notes",
  "scored_by",
  "scored_at",
];

const APPLICATIONS_COLUMNS = [
  "position_id",
  "cv_path",
  "cv_pdf_path",
  "cl_path",
  "cl_pdf_path",
  "status",
  "critic_score",
  "critic_verdict",
  "critic_notes",
  "critic_round",
  "written_at",
  "applied_at",
  "applied_via",
  "response",
  "response_at",
  "rejection_reason",
  "rejection_note",
  "written_by",
  "reviewed_by",
  "critic_reviewed_at",
  "applied",
  "cv_drive_id",
  "cl_drive_id",
];

interface PositionRow {
  id: number;
  title: string;
  company: string;
  url: string | null;
  location: string | null;
  remote_type: string | null;
  status: string | null;
  notes: string | null;
  source: string | null;
  jd_text: string | null;
  requirements: string | null;
  found_by: string | null;
  found_at: string | null;
  deadline: string | null;
  last_checked: string | null;
  salary_declared_min: number | null;
  salary_declared_max: number | null;
  salary_declared_currency: string | null;
  salary_estimated_min: number | null;
  salary_estimated_max: number | null;
  salary_estimated_currency: string | null;
  salary_estimated_source: string | null;
  // V6 (2026-05-29): SQLite stores INTEGER 0|1, Supabase expects BOOLEAN.
  write_requested: number | null;
  write_requested_at: string | null;
  write_request_kind?: "cv" | "cover_letter" | null;
  // V8 (2026-05-31): stesso mapping integer→boolean.
  geocode_requested: number | null;
  geocode_requested_at: string | null;
}

interface ScoreRow {
  position_id: number;
  total_score: number;
  experience_fit: number | null;
  salary_fit: number | null;
  stack_match: number | null;
  remote_fit: number | null;
  strategic_fit: number | null;
  breakdown: string | null;
  notes: string | null;
  scored_by: string | null;
  scored_at: string | null;
}

interface ApplicationRow {
  position_id: number;
  cv_path: string | null;
  cv_pdf_path: string | null;
  cl_path: string | null;
  cl_pdf_path: string | null;
  status: string | null;
  critic_score: number | null;
  critic_verdict: string | null;
  critic_notes: string | null;
  critic_round?: number | null;
  written_at: string | null;
  applied_at: string | null;
  applied_via: string | null;
  response: string | null;
  response_at: string | null;
  // Opzionali come `critic_round`: un jobs.db creato prima di O-105 non le ha
  // finché `ensure_schema` non gira, e la lettura compatibile le salta.
  rejection_reason?: string | null;
  rejection_note?: string | null;
  written_by: string | null;
  reviewed_by: string | null;
  critic_reviewed_at: string | null;
  applied: number | null;
  cv_drive_id: string | null;
  cl_drive_id: string | null;
}

function readTable<T>(
  db: Database.Database,
  table: string,
  columns: string[],
): T[] {
  try {
    return db
      .prepare(`SELECT ${columns.join(", ")} FROM ${table}`)
      .all() as T[];
  } catch (err) {
    if (err instanceof Error && /no such table/i.test(err.message)) return [];
    throw err;
  }
}

export async function POST() {
  const denied = await requireAuth();
  if (denied) return denied;
  if (!(await localDbExists())) {
    return NextResponse.json(
      {
        error:
          "Database locale non trovato (~/.jht/jobs.db). Avvia il team almeno una volta.",
      },
      { status: 404 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json(
      { error: "Non autenticato. Effettua il login per sincronizzare." },
      { status: 401 },
    );
  }
  const userId = user.id;

  let positions: PositionRow[] = [];
  let scores: ScoreRow[] = [];
  let applications: ApplicationRow[] = [];
  let db: Database.Database | null = null;
  try {
    db = new Database(getLocalDbPath(), {
      readonly: true,
      fileMustExist: true,
    });
    positions = readSqliteTableCompatible<PositionRow>(
      db,
      "positions",
      POSITIONS_COLUMNS,
      new Set(["write_request_kind"]),
    );
    scores = readTable<ScoreRow>(db, "scores", SCORES_COLUMNS);
    applications = readSqliteTableCompatible<ApplicationRow>(
      db,
      "applications",
      APPLICATIONS_COLUMNS,
      // Colonne che un jobs.db precedente può non avere: la lettura le salta
      // invece di far cadere l'intera sincronizzazione.
      new Set(["critic_round", "rejection_reason", "rejection_note"]),
    );
  } catch (err) {
    return sanitizedError(err, {
      status: 500,
      scope: "local/sync",
      publicMessage: "sqlite_read_failed",
    });
  } finally {
    db?.close();
  }

  if (
    positions.length === 0 &&
    scores.length === 0 &&
    applications.length === 0
  ) {
    return NextResponse.json({
      empty: true,
      positions: { upserted: 0 },
      scores: { upserted: 0 },
      applications: { upserted: 0 },
    });
  }

  const legacyToUuid = new Map<number, string>();
  let positionsUpserted = 0;
  let scoresUpserted = 0;
  let scoresOutOfRange: OutOfRangeSummary = {
    rows: 0,
    byColumn: {},
    worst: null,
  };
  let applicationsUpserted = 0;

  // 1. Upsert positions via (user_id, legacy_id)
  if (positions.length > 0) {
    const payload = positions
      .filter((p) => typeof p.id === "number" && p.title && p.company)
      .map((p) => ({
        user_id: userId,
        legacy_id: p.id,
        title: p.title,
        company: p.company,
        url: p.url,
        location: p.location,
        remote_type: p.remote_type,
        status: normalizePositionStatus(p.status),
        notes: p.notes,
        source: p.source,
        jd_text: p.jd_text,
        requirements: p.requirements,
        found_by: p.found_by,
        found_at: p.found_at,
        deadline: p.deadline,
        last_checked: p.last_checked,
        salary_declared_min: p.salary_declared_min,
        salary_declared_max: p.salary_declared_max,
        salary_declared_currency: p.salary_declared_currency,
        salary_estimated_min: p.salary_estimated_min,
        salary_estimated_max: p.salary_estimated_max,
        salary_estimated_currency: p.salary_estimated_currency,
        salary_estimated_source: p.salary_estimated_source,
        // Coerce SQLite INTEGER (0|1) -> Supabase BOOLEAN. Null su DB
        // pre-V6/pre-V8 -> false (default semantico: nessuna richiesta).
        write_requested: p.write_requested === 1,
        write_requested_at: p.write_requested_at,
        // Un exporter legacy non conosce questo desired-state: ometterlo deve
        // preservare la richiesta cloud, mentre NULL esplicito la risolve.
        ...(Object.prototype.hasOwnProperty.call(p, "write_request_kind")
          ? { write_request_kind: p.write_request_kind ?? null }
          : {}),
        geocode_requested: p.geocode_requested === 1,
        geocode_requested_at: p.geocode_requested_at,
      }));

    const { data: upserted, error } = await supabase
      .from("positions")
      .upsert(payload, {
        onConflict: "user_id,legacy_id",
        defaultToNull: false,
      })
      .select("id, legacy_id");

    if (error) {
      return sanitizedError(error, {
        status: 500,
        scope: "local/sync",
        publicMessage: "positions_upsert_failed",
      });
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
          experience_fit: s.experience_fit,
          salary_fit: s.salary_fit,
          stack_match: s.stack_match,
          remote_fit: s.remote_fit,
          strategic_fit: s.strategic_fit,
          breakdown: s.breakdown,
          notes: s.notes,
          scored_by: s.scored_by,
          scored_at: s.scored_at,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (payload.length > 0) {
      const { data: upserted, error } = await supabase
        .from("scores")
        .upsert(payload, { onConflict: "position_id" })
        .select("id");
      if (error) {
        return sanitizedError(error, {
          status: 500,
          scope: "local/sync",
          publicMessage: "scores_upsert_failed",
        });
      }
      scoresUpserted = upserted?.length ?? 0;
      // Vedi il gemello in cloud-sync/push: contiamo le dimensioni fuori scala
      // che attraversano il confine, senza toccarle.
      scoresOutOfRange = summarizeOutOfRange(payload);
    }
  }

  // 3. Upsert applications via position_id UUID
  if (applications.length > 0 && legacyToUuid.size > 0) {
    const payload = applications
      .map((a) => {
        const uuid = legacyToUuid.get(a.position_id);
        if (!uuid) return null;
        return invalidateStaleCriticVerdict({
          user_id: userId,
          position_id: uuid,
          cv_path: a.cv_path,
          cv_pdf_path: a.cv_pdf_path,
          cl_path: a.cl_path,
          cl_pdf_path: a.cl_pdf_path,
          status: normalizeApplicationStatus(a.status),
          critic_score: a.critic_score,
          critic_verdict: normalizeCriticVerdict(a.critic_verdict),
          critic_notes: a.critic_notes,
          critic_round: a.critic_round,
          written_at: a.written_at,
          applied_at: a.applied_at,
          applied_via: a.applied_via,
          response: a.response,
          response_at: a.response_at,
          rejection_reason: a.rejection_reason,
          rejection_note: a.rejection_note,
          written_by: a.written_by,
          reviewed_by: a.reviewed_by,
          critic_reviewed_at: a.critic_reviewed_at,
          applied: a.applied != null ? Boolean(a.applied) : null,
          cv_drive_id: a.cv_drive_id,
          cl_drive_id: a.cl_drive_id,
        });
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (payload.length > 0) {
      const { data: upserted, error } = await supabase
        .from("applications")
        .upsert(payload, { onConflict: "position_id" })
        .select("id");
      if (error) {
        return sanitizedError(error, {
          status: 500,
          scope: "local/sync",
          publicMessage: "applications_upsert_failed",
        });
      }
      applicationsUpserted = upserted?.length ?? 0;
    }
  }

  const summary = {
    positions: { upserted: positionsUpserted, payload: positions.length },
    scores: {
      upserted: scoresUpserted,
      payload: scores.length,
      out_of_range: scoresOutOfRange,
    },
    applications: {
      upserted: applicationsUpserted,
      payload: applications.length,
    },
  };

  // Persisti lo stato della sync per la UI "ultimo sync alle X".
  // Errore di scrittura = non-fatale: il sync è già completato lato Supabase.
  try {
    await writeSyncState({
      last_synced_at: new Date().toISOString(),
      last_user_id: userId,
      last_sync_summary: summary,
    });
  } catch (err) {
    console.warn("[sync] writeSyncState failed (non-fatal):", err);
  }

  return NextResponse.json({
    empty: false,
    positions: { upserted: positionsUpserted },
    scores: { upserted: scoresUpserted, out_of_range: scoresOutOfRange },
    applications: { upserted: applicationsUpserted },
    payload: {
      positions: positions.length,
      scores: scores.length,
      applications: applications.length,
    },
  });
}
