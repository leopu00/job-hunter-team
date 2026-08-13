import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import Database from "better-sqlite3";
import fs from "fs";
import { resolveUser } from "@/lib/team-state/auth";
import { requireAuth } from "@/lib/auth";
import {
  LOCAL_TOKEN_COOKIE,
  isLocalTokenAuthenticated,
} from "@/lib/local-token";
import { JHT_DB_PATH } from "@/lib/jht-paths";
import { isCloudDeploy } from "@/lib/deploy-mode";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export type WriteRequestKind = "cv" | "cover_letter";
const WRITE_REQUEST_KINDS = new Set<WriteRequestKind>(["cv", "cover_letter"]);

// Writer-on-demand: l'utente "richiede" il CV per una posizione cliccando
// il pulsante "Scrivi CV" sul dashboard (o `/cv <id>` su Telegram, vedi
// tg-bridge.py). Setta `positions.write_requested = 1` cosi' il Capitano
// spawna uno Scrittore on-demand.
//
// Due modi operativi (decisi dalla presenza di SQLite locale):
//
//   A) Local mode (SQLite presente — Local PC o web Next.js dentro al
//      container VPS): UPDATE atomico su SQLite locale (source of truth
//      per il Capitano in-process), poi best-effort UPDATE Supabase per
//      UI cross-device. Push delta-only daemon recupera la coerenza alla
//      prossima cadenza.
//
//   B) Cloud mode (SQLite assente — utente sul jobhunterteam.ai mentre
//      il container e' offline o web Vercel-side senza accesso al
//      filesystem del container): UPDATE solo su Supabase. Il container,
//      al prossimo boot, esegue `jht cloud pull-desired-state` (wired in
//      cli/src/commands/team/start.js) e applica il flag al SQLite locale.
//      Cosi' l'utente puo' richiedere CV anche con team fermo.
//
// In entrambi i path la validazione (status='scored', no application
// esistente) viene applicata sulla source disponibile.
//
// Vedi BACKLOG [JHT-WRITER-ON-DEMAND] (2026-05-29), [JHT-CLOUDSYNC-01]
// pull-desired-state (2026-05-31) e migration V6 in
// `shared/skills/_db.py::_migrate_positions_write_requested`.

interface PositionRow {
  id: number;
  title: string;
  company: string;
  status: string | null;
  score: number | null;
  write_requested: number;
  write_requested_at: string | null;
  write_request_kind: WriteRequestKind | null;
  has_application: number;
}

interface ResponsePosition {
  id: string;
  title: string;
  company: string;
  status: string | null;
  score: number | null;
  write_requested: boolean;
  write_requested_at: string | null;
  write_request_kind: WriteRequestKind | null;
}

interface ToggleOutcome {
  position: ResponsePosition;
  cloud_synced: boolean | null;
  source: "local" | "cloud";
}

function nextRequestTimestamp(previous: string | null): string {
  const previousMs = previous ? Date.parse(previous) : Number.NaN;
  return new Date(
    Number.isNaN(previousMs)
      ? Date.now()
      : Math.max(Date.now(), previousMs + 1),
  ).toISOString();
}

function validateRequested(
  kind: WriteRequestKind,
  status: string | null,
  hasApplication: boolean,
): { ok: true } | { ok: false; status: number; body: Record<string, unknown> } {
  if (kind === "cover_letter") {
    return hasApplication
      ? { ok: true }
      : {
          ok: false,
          status: 409,
          body: {
            error: "cover_letter_requires_application",
            position: { status },
          },
        };
  }
  if (status !== "scored") {
    return {
      ok: false,
      status: 409,
      body: {
        error: `Posizione in stato '${status}': richiesta CV ammessa solo per 'scored'`,
        position: { status },
      },
    };
  }
  if (hasApplication) {
    return {
      ok: false,
      status: 409,
      body: {
        error: `Application gia' esistente per la posizione`,
        position: { status },
      },
    };
  }
  return { ok: true };
}

// Path A: SQLite locale e' la source of truth (Local PC o web nel container).
export function toggleViaLocal(
  legacyId: number,
  requested: boolean,
  kind: WriteRequestKind,
):
  | { ok: true; outcome: ToggleOutcome }
  | { ok: false; status: number; body: Record<string, unknown> } {
  const db = new Database(JHT_DB_PATH);
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    const apply = db.transaction(() => {
      const row = db
        .prepare<[number], PositionRow>(
          `
        SELECT
          p.id, p.title, p.company, p.status,
          s.total_score AS score,
          p.write_requested,
          p.write_requested_at,
          p.write_request_kind,
          CASE WHEN a.id IS NULL THEN 0 ELSE 1 END AS has_application
        FROM positions p
        LEFT JOIN scores s ON s.position_id = p.id
        LEFT JOIN applications a ON a.position_id = p.id
        WHERE p.id = ?
      `,
        )
        .get(legacyId);

      if (!row) {
        return {
          ok: false as const,
          status: 404,
          body: { error: `Posizione #${legacyId} non trovata` },
        };
      }

      const activeKind = row.write_requested
        ? (row.write_request_kind ?? "cv")
        : null;

      if (requested && activeKind !== kind) {
        const guard = validateRequested(
          kind,
          row.status,
          row.has_application === 1,
        );
        if (!guard.ok) {
          return {
            ok: false as const,
            status: guard.status,
            body: {
              ...guard.body,
              position: { ...(guard.body.position as object), id: row.id },
            },
          };
        }
      }

      // POST ripetuti dello stesso tipo sono un vero no-op: timestamp e FIFO
      // restano quelli della prima richiesta. DELETE non può spegnere per
      // errore una richiesta di tipo diverso osservata da una UI stantia.
      const shouldWrite = requested ? activeKind !== kind : activeKind === kind;
      if (shouldWrite) {
        db.prepare(
          `
      UPDATE positions
       SET write_requested = ?,
             write_requested_at = CASE
               WHEN strftime('%Y-%m-%d %H:%M:%f', 'now', 'localtime') >
                    COALESCE(write_requested_at, '')
               THEN strftime('%Y-%m-%d %H:%M:%f', 'now', 'localtime')
               ELSE strftime('%Y-%m-%d %H:%M:%f', write_requested_at,
                             '+0.001 seconds')
             END,
             write_request_kind = ?,
             updated_at = CASE
               WHEN strftime('%Y-%m-%d %H:%M:%f', 'now', 'localtime') >
                    COALESCE(updated_at, '')
               THEN strftime('%Y-%m-%d %H:%M:%f', 'now', 'localtime')
               ELSE strftime('%Y-%m-%d %H:%M:%f', updated_at,
                             '+0.001 seconds')
             END
       WHERE id = ?
    `,
        ).run(requested ? 1 : 0, requested ? kind : null, legacyId);
      }

      const updated = db
        .prepare<[number], PositionRow>(
          `
        SELECT
          p.id, p.title, p.company, p.status,
          s.total_score AS score,
          p.write_requested,
          p.write_requested_at,
          p.write_request_kind,
          CASE WHEN a.id IS NULL THEN 0 ELSE 1 END AS has_application
        FROM positions p
        LEFT JOIN scores s ON s.position_id = p.id
        LEFT JOIN applications a ON a.position_id = p.id
        WHERE p.id = ?
      `,
        )
        .get(legacyId)!;

      return {
        ok: true as const,
        outcome: {
          position: {
            id: String(updated.id),
            title: updated.title,
            company: updated.company,
            status: updated.status,
            score: updated.score,
            write_requested: updated.write_requested === 1,
            write_requested_at: updated.write_requested_at,
            write_request_kind: updated.write_request_kind,
          },
          cloud_synced: null,
          source: "local" as const,
        },
      };
    });
    return apply();
  } finally {
    db.close();
  }
}

// Path B: Supabase e' l'unica source disponibile (cloud-mode, container offline).
export async function toggleViaCloud(
  supabase: SupabaseClient,
  userId: string,
  legacyId: number,
  requested: boolean,
  kind: WriteRequestKind,
): Promise<
  | { ok: true; outcome: ToggleOutcome }
  | { ok: false; status: number; body: Record<string, unknown> }
> {
  // Embedded select su scores + applications: FK definite in mig 001_schema.sql
  // (scores.position_id REFERENCES positions(id), applications stessa cosa).
  // PostgREST ritorna array (1:N relations), gestiamo entrambe come single-item.
  const { data: row, error } = await supabase
    .from("positions")
    .select(
      "id, title, company, status, write_requested, write_requested_at, write_request_kind, scores(total_score), applications(id)",
    )
    .eq("user_id", userId)
    .eq("legacy_id", legacyId)
    .maybeSingle();

  if (error) {
    // Helper che ritorna un BODY, non una NextResponse: `sanitizedError` non
    // è applicabile, quindi ne replichiamo il contratto a mano.
    console.error(`[positions/write-request] 500 ${error.message}`);
    return { ok: false, status: 500, body: { error: "query_failed" } };
  }
  if (!row) {
    return {
      ok: false,
      status: 404,
      body: { error: `Posizione #${legacyId} non trovata` },
    };
  }

  type R = {
    id: string;
    title: string | null;
    company: string | null;
    status: string | null;
    write_requested: boolean;
    write_requested_at: string | null;
    write_request_kind: WriteRequestKind | null;
    scores: Array<{ total_score: number | null }> | null;
    applications: Array<{ id: string }> | null;
  };
  const r = row as unknown as R;
  const score =
    Array.isArray(r.scores) && r.scores[0] ? r.scores[0].total_score : null;
  const hasApplication =
    Array.isArray(r.applications) && r.applications.length > 0;
  const activeKind = r.write_requested ? (r.write_request_kind ?? "cv") : null;

  if (requested && activeKind !== kind) {
    const guard = validateRequested(kind, r.status, hasApplication);
    if (!guard.ok) {
      return {
        ok: false,
        status: guard.status,
        body: {
          ...guard.body,
          position: { ...(guard.body.position as object), id: legacyId },
        },
      };
    }
  }

  // Stesso tipo già attivo = dedup senza spostare la FIFO. Una DELETE
  // stantia non spegne il tipo diverso che nel frattempo ha vinto.
  const shouldWrite = requested ? activeKind !== kind : activeKind === kind;
  if (!shouldWrite) {
    return {
      ok: true,
      outcome: {
        position: {
          id: String(legacyId),
          title: r.title ?? "",
          company: r.company ?? "",
          status: r.status,
          score,
          write_requested: r.write_requested,
          write_requested_at: r.write_requested_at,
          write_request_kind: r.write_request_kind,
        },
        cloud_synced: true,
        source: "cloud",
      },
    };
  }

  // Anche OFF è un'azione desired-state: il timestamp deve avanzare perché
  // il pull diretto (filtro *_at > cursor) possa osservare l'annullamento.
  const writeRequestedAt = nextRequestTimestamp(r.write_requested_at);
  let update = supabase
    .from("positions")
    .update({
      write_requested: requested,
      write_requested_at: writeRequestedAt,
      write_request_kind: requested ? kind : null,
    })
    .eq("user_id", userId)
    .eq("legacy_id", legacyId)
    .eq("write_requested", r.write_requested);
  update = r.write_request_kind
    ? update.eq("write_request_kind", r.write_request_kind)
    : update.is("write_request_kind", null);
  const { data: updated, error: upErr } = await update
    .select("write_requested, write_requested_at, write_request_kind")
    .maybeSingle();

  if (upErr || !updated) {
    return {
      ok: false,
      status: upErr ? 500 : 409,
      body: { error: upErr ? "update_failed" : "request_state_changed" },
    };
  }

  return {
    ok: true,
    outcome: {
      position: {
        id: String(legacyId),
        title: r.title ?? "",
        company: r.company ?? "",
        status: r.status,
        score,
        write_requested: updated.write_requested,
        write_requested_at: updated.write_requested_at,
        write_request_kind: updated.write_request_kind,
      },
      cloud_synced: true,
      source: "cloud",
    },
  };
}

async function handleToggle(
  req: NextRequest,
  legacyIdParam: string,
  requested: boolean,
  kind: WriteRequestKind,
): Promise<NextResponse> {
  const denied = await requireAuth();
  if (denied) return denied;
  const legacyId = Number.parseInt(legacyIdParam, 10);
  if (!Number.isInteger(legacyId) || legacyId <= 0) {
    return NextResponse.json({ error: "legacyId non valido" }, { status: 400 });
  }

  // [JHT-DASHBOARD-NATIVE] Desktop nativo: con local-token valido scrivi SOLO
  // su SQLite locale (riusa toggleViaLocal) e ritorna, senza cloud (resolveUser
  // →Supabase resta per il browser web).
  if (
    isLocalTokenAuthenticated(
      req.headers.get("authorization"),
      (await cookies()).get(LOCAL_TOKEN_COOKIE)?.value,
    )
  ) {
    if (!fs.existsSync(JHT_DB_PATH)) {
      return NextResponse.json({ error: "DB locale assente" }, { status: 503 });
    }
    const local = toggleViaLocal(legacyId, requested, kind);
    if (!local.ok) {
      return NextResponse.json(local.body, { status: local.status });
    }
    return NextResponse.json({
      position: local.outcome.position,
      cloud_synced: null,
      source: "local",
    });
  }

  const resolved = await resolveUser(req);
  if (!resolved.ok) return resolved.res;
  if (resolved.user.source !== "session") {
    return NextResponse.json(
      { error: "Solo il browser puo' richiedere CV (no Bearer token)" },
      { status: 403 },
    );
  }
  const { userId, supabase } = resolved.user;

  // SQLite presente → local primary (poi best-effort cloud).
  // SQLite assente → cloud only; il container chiuderà il loop con
  // `jht cloud pull-desired-state` al prossimo boot (P0 [JHT-CLOUDSYNC-01]).
  const hasLocal = !isCloudDeploy() && fs.existsSync(JHT_DB_PATH);

  if (hasLocal) {
    const local = toggleViaLocal(legacyId, requested, kind);
    if (!local.ok) {
      return NextResponse.json(local.body, { status: local.status });
    }
    // Best-effort cloud write (single source-of-truth in-process = SQLite).
    let cloudOk: boolean | null = null;
    try {
      const { error } = await supabase
        .from("positions")
        .update({
          write_requested: local.outcome.position.write_requested,
          write_requested_at: local.outcome.position.write_requested_at,
          write_request_kind: local.outcome.position.write_request_kind,
        })
        .eq("user_id", userId)
        .eq("legacy_id", legacyId);
      cloudOk = !error;
    } catch {
      cloudOk = false;
    }
    return NextResponse.json({
      position: local.outcome.position,
      cloud_synced: cloudOk,
      source: "local",
    });
  }

  const cloud = await toggleViaCloud(
    supabase,
    userId,
    legacyId,
    requested,
    kind,
  );
  if (!cloud.ok) {
    return NextResponse.json(cloud.body, { status: cloud.status });
  }
  return NextResponse.json({
    position: cloud.outcome.position,
    cloud_synced: cloud.outcome.cloud_synced,
    source: cloud.outcome.source,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ legacyId: string }> },
) {
  const { legacyId } = await params;
  const body = await req.json().catch(() => ({}));
  const kind = body?.kind ?? "cv";
  if (!WRITE_REQUEST_KINDS.has(kind)) {
    return NextResponse.json(
      { error: "request_kind_invalid" },
      { status: 400 },
    );
  }
  return handleToggle(req, legacyId, true, kind);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ legacyId: string }> },
) {
  const { legacyId } = await params;
  const body = await req.json().catch(() => ({}));
  const kind = body?.kind ?? "cv";
  if (!WRITE_REQUEST_KINDS.has(kind)) {
    return NextResponse.json(
      { error: "request_kind_invalid" },
      { status: 400 },
    );
  }
  return handleToggle(req, legacyId, false, kind);
}
