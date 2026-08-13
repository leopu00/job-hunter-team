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
import { sanitizedError } from "@/lib/error-response";
import { isCloudDeploy } from "@/lib/deploy-mode";
import {
  readTeamDirectivesForUser,
  type TeamDirectivesReader,
  validateDirectiveMutationResult,
} from "@/lib/team-directives-cloud";
import {
  MAX_DIRECTIVE_REQUEST_ID_LENGTH,
  mutateLocalTeamDirective,
  publicDirectiveError,
} from "@/lib/team-directives-local";

export const dynamic = "force-dynamic";

// Bacheca del team (team_directives): ordini/strategia PERMANENTI dell'utente.
// La dashboard legge/scrive qui; il Capitano li rilegge a ogni riavvio via la
// skill team_directives.py. Come i ticket, due path:
//   A) SQLite locale (web nel container) = source of truth per gli agenti; il
//      mirror sul cloud lo fa il daemon `jht cloud sync-directives` (round-trip
//      via cloud_id, incremento #2b). NON scriviamo su Supabase da qui.
//   B) cloud-only (container offline / web Vercel) → Supabase (RLS per user_id).

const KINDS = new Set(["order", "strategy", "formation", "note"]);
const MAX_LEN = 2000;

function requireRequestId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.trim().length > MAX_DIRECTIVE_REQUEST_ID_LENGTH
  )
    throw new Error("invalid request id");
  return value.trim();
}

interface DirectiveRow {
  id: number;
  body: string;
  kind: string;
  status: string;
  sort_order: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

function localDbOrNull(): Database.Database | null {
  if (isCloudDeploy() || !fs.existsSync(JHT_DB_PATH)) return null;
  const db = new Database(JHT_DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

// Solo il browser (sessione) può scrivere sul cloud; il local-token esige il DB
// locale. Ritorna null se il chiamante è autorizzato a proseguire sul path cloud,
// altrimenti una NextResponse d'errore già pronta.
async function cloudGuard(req: NextRequest): Promise<NextResponse | null> {
  if (
    isLocalTokenAuthenticated(
      req.headers.get("authorization"),
      (await cookies()).get(LOCAL_TOKEN_COOKIE)?.value,
    )
  ) {
    return NextResponse.json({ error: "DB locale assente" }, { status: 503 });
  }
  return null;
}

// ── GET: elenco direttive (attive + archiviate) ────────────────────────────
export async function GET(req: NextRequest): Promise<NextResponse> {
  const denied = await requireAuth();
  if (denied) return denied;
  const db = localDbOrNull();
  if (db) {
    try {
      const hasTable = db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='team_directives'",
        )
        .get();
      const rows = hasTable
        ? (db
            .prepare(
              "SELECT id, body, kind, status, sort_order, created_by, created_at, updated_at, archived_at " +
                "FROM team_directives ORDER BY status ASC, sort_order ASC, created_at ASC",
            )
            .all() as DirectiveRow[])
        : [];
      return NextResponse.json({ directives: rows, source: "local" });
    } finally {
      db.close();
    }
  }

  const guard = await cloudGuard(req);
  if (guard) return guard;
  const resolved = await resolveUser(req);
  if (!resolved.ok) return resolved.res;
  const { supabase, userId } = resolved.user;
  const { data, error } = await readTeamDirectivesForUser(
    supabase as unknown as TeamDirectivesReader,
    userId,
  );
  if (error) {
    return sanitizedError(error, {
      status: 500,
      scope: "team-directives",
      publicMessage: "query_failed",
    });
  }
  return NextResponse.json({ directives: data || [], source: "cloud" });
}

// ── POST: crea una direttiva ───────────────────────────────────────────────
export async function POST(req: NextRequest): Promise<NextResponse> {
  const denied = await requireAuth();
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as {
    body?: string;
    kind?: string;
    request_id?: string;
  };
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!text) {
    return NextResponse.json(
      { error: "La direttiva non può essere vuota" },
      { status: 400 },
    );
  }
  if (text.length > MAX_LEN) {
    return NextResponse.json(
      { error: `Direttiva troppo lunga (max ${MAX_LEN} caratteri)` },
      { status: 400 },
    );
  }
  const kind = body.kind && KINDS.has(body.kind) ? body.kind : "order";
  let requestId: string;
  try {
    requestId = requireRequestId(body.request_id);
  } catch {
    return NextResponse.json({ error: "invalid request id" }, { status: 400 });
  }

  const db = localDbOrNull();
  if (db) {
    try {
      return NextResponse.json(
        mutateLocalTeamDirective(db, {
          requestId,
          action: "created",
          id: 0,
          body: text,
          kind,
        }),
      );
    } catch (error) {
      const failure = publicDirectiveError(error);
      return NextResponse.json(
        { error: failure.error },
        { status: failure.status },
      );
    } finally {
      db.close();
    }
  }

  const guard = await cloudGuard(req);
  if (guard) return guard;
  const resolved = await resolveUser(req);
  if (!resolved.ok) return resolved.res;
  if (resolved.user.source !== "session") {
    return NextResponse.json(
      { error: "Solo il browser può creare direttive (no Bearer token)" },
      { status: 403 },
    );
  }
  const { supabase } = resolved.user;
  const { data, error } = await supabase.rpc(
    "mutate_team_directive_with_event",
    {
      p_id: 0,
      p_action: "created",
      p_body: text,
      p_kind: kind,
      p_request_id: requestId,
    },
  );
  if (error) {
    if (error.message?.includes("request id payload mismatch")) {
      return NextResponse.json(
        { error: "request_id_mismatch" },
        { status: 409 },
      );
    }
    return sanitizedError(error, {
      status: 500,
      scope: "team-directives",
      publicMessage: "insert_failed",
    });
  }
  const mutation = validateDirectiveMutationResult(data, {
    requestId,
    action: "created",
  });
  if (!mutation) {
    return NextResponse.json({ error: "insert_unconfirmed" }, { status: 502 });
  }
  return NextResponse.json({
    id: String(mutation.id),
    ok: true,
    source: "cloud",
    request_id: requestId,
    action: "created",
    captain_event: { ok: true, status: "queued" },
  });
}

// ── PATCH: modifica il testo o archivia una direttiva ──────────────────────
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const denied = await requireAuth();
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as {
    id?: number | string;
    body?: string;
    action?: string;
    request_id?: string;
  };
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "id non valido" }, { status: 400 });
  }
  const archive = body.action === "archive";
  let requestId: string;
  try {
    requestId = requireRequestId(body.request_id);
  } catch {
    return NextResponse.json({ error: "invalid request id" }, { status: 400 });
  }
  const text = typeof body.body === "string" ? body.body.trim() : null;
  if (!archive && !text) {
    return NextResponse.json(
      { error: "Niente da aggiornare (testo vuoto)" },
      { status: 400 },
    );
  }
  if (text && text.length > MAX_LEN) {
    return NextResponse.json(
      { error: `Direttiva troppo lunga (max ${MAX_LEN} caratteri)` },
      { status: 400 },
    );
  }

  const db = localDbOrNull();
  if (db) {
    try {
      const action = archive ? "archived" : "edited";
      return NextResponse.json(
        mutateLocalTeamDirective(db, {
          requestId,
          action,
          id,
          body: archive ? null : text,
        }),
      );
    } catch (error) {
      const failure = publicDirectiveError(error);
      return NextResponse.json(
        { error: failure.error },
        { status: failure.status },
      );
    } finally {
      db.close();
    }
  }

  const guard = await cloudGuard(req);
  if (guard) return guard;
  const resolved = await resolveUser(req);
  if (!resolved.ok) return resolved.res;
  if (resolved.user.source !== "session") {
    return NextResponse.json(
      { error: "Solo il browser può modificare direttive" },
      { status: 403 },
    );
  }
  const { supabase } = resolved.user;
  const { data, error } = await supabase.rpc(
    "mutate_team_directive_with_event",
    {
      p_id: id,
      p_action: archive ? "archived" : "edited",
      p_body: text,
      p_kind: null,
      p_request_id: requestId,
    },
  );
  if (error) {
    if (error.message?.includes("request id payload mismatch")) {
      return NextResponse.json(
        { error: "request_id_mismatch" },
        { status: 409 },
      );
    }
    return sanitizedError(error, {
      status: 500,
      scope: "team-directives",
      publicMessage: "update_failed",
    });
  }
  const action = archive ? "archived" : "edited";
  const mutation = validateDirectiveMutationResult(data, {
    requestId,
    action,
    id,
  });
  if (!mutation) {
    return NextResponse.json({ error: "update_unconfirmed" }, { status: 502 });
  }
  return NextResponse.json({
    ok: true,
    id: String(mutation.id),
    source: "cloud",
    request_id: requestId,
    action,
    captain_event: { ok: true, status: "queued" },
  });
}
