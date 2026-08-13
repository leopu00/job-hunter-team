import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import Database from "better-sqlite3";
import fs from "fs";
import { createHash } from "crypto";
import { resolveUser } from "@/lib/team-state/auth";
import { requireAuth } from "@/lib/auth";
import {
  LOCAL_TOKEN_COOKIE,
  isLocalTokenAuthenticated,
} from "@/lib/local-token";
import { JHT_DB_PATH } from "@/lib/jht-paths";
import { sanitizedError } from "@/lib/error-response";
import { readTeamDirectivesForUser } from "@/lib/team-directives-cloud";

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

type CaptainEvent = { ok: boolean; status: "queued" | "error"; error?: string };

function enqueueCaptainEvent(
  db: Database.Database,
  event: { action: string; id: number; fingerprint?: string },
): CaptainEvent {
  const sourceId = `team-directive:${event.id}:${event.action}:${event.fingerprint || ""}`;
  const text = `[TEAM-DIRECTIVE] ${event.action} #${event.id}`;
  try {
    db.prepare(
      "INSERT OR IGNORE INTO pending_user_messages (agent, body, kind, author, source_id, delivered_via) VALUES (?, ?, 'notification', 'user', ?, NULL)",
    ).run("capitano", text, sourceId);
    return { ok: true, status: "queued" };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      error: error instanceof Error ? error.message : "enqueue_failed",
    };
  }
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
  if (!fs.existsSync(JHT_DB_PATH)) return null;
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
  const { data, error } = await readTeamDirectivesForUser(supabase, userId);
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

  const db = localDbOrNull();
  if (db) {
    try {
      const nxt = db
        .prepare(
          "SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM team_directives WHERE status = 'active'",
        )
        .get() as { n: number };
      const result = db.transaction(() => {
        const info = db
          .prepare(
            "INSERT INTO team_directives (body, kind, status, sort_order, created_by) VALUES (?, ?, 'active', ?, 'user')",
          )
          .run(text, kind, nxt?.n ?? 1);
        const id = Number(info.lastInsertRowid);
        const captainEvent = enqueueCaptainEvent(db, {
          action: "created",
          id,
          fingerprint: createHash("sha256").update(text).digest("hex"),
        });
        if (!captainEvent.ok)
          throw new Error(captainEvent.error || "enqueue_failed");
        return { id, captainEvent };
      })();
      return NextResponse.json({
        id: String(result.id),
        source: "local",
        captain_event: result.captainEvent,
      });
    } catch (error) {
      return NextResponse.json(
        {
          error: "directive_not_queued",
          detail: error instanceof Error ? error.message : "enqueue_failed",
        },
        { status: 503 },
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
  const sourceId = `team-directive:create:${createHash("sha256").update(text).digest("hex")}`;
  const { data, error } = await supabase.rpc(
    "mutate_team_directive_with_event",
    {
      p_id: 0,
      p_action: "created",
      p_body: text,
      p_source_id: sourceId,
    },
  );
  if (error) {
    return sanitizedError(error, {
      status: 500,
      scope: "team-directives",
      publicMessage: "insert_failed",
    });
  }
  return NextResponse.json({
    id: String(data.id),
    source: "cloud",
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
  };
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "id non valido" }, { status: 400 });
  }
  const archive = body.action === "archive";
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
      const result = db.transaction(() => {
        const changed = archive
          ? db
              .prepare(
                "UPDATE team_directives SET status = 'archived', archived_at = datetime('now','localtime'), updated_at = datetime('now','localtime') WHERE id = ? AND status = 'active'",
              )
              .run(id)
          : db
              .prepare(
                "UPDATE team_directives SET body = ?, updated_at = datetime('now','localtime') WHERE id = ? AND status = 'active'",
              )
              .run(text, id);
        if (changed.changes !== 1) throw new Error("directive_not_found");
        const captainEvent = enqueueCaptainEvent(db, {
          action: archive ? "archived" : "edited",
          id,
          fingerprint: text
            ? createHash("sha256").update(text).digest("hex")
            : undefined,
        });
        if (!captainEvent.ok)
          throw new Error(captainEvent.error || "enqueue_failed");
        return captainEvent;
      })();
      return NextResponse.json({
        ok: true,
        source: "local",
        captain_event: result,
      });
    } catch (error) {
      return NextResponse.json(
        {
          error: "directive_not_queued",
          detail: error instanceof Error ? error.message : "enqueue_failed",
        },
        { status: 503 },
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
  const sourceId = `team-directive:${id}:${archive ? "archived" : "edited"}:${text ? createHash("sha256").update(text).digest("hex") : ""}`;
  const { data, error } = await supabase.rpc(
    "mutate_team_directive_with_event",
    {
      p_id: id,
      p_action: archive ? "archived" : "edited",
      p_body: text,
      p_source_id: sourceId,
    },
  );
  if (error) {
    return sanitizedError(error, {
      status: 500,
      scope: "team-directives",
      publicMessage: "update_failed",
    });
  }
  return NextResponse.json({
    ok: true,
    source: "cloud",
    captain_event: { ok: true, status: "queued" },
  });
}
