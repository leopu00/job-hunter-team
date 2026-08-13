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

async function enqueueCaptainCloud(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  event: { action: string; id: number | string; body?: string },
): Promise<CaptainEvent> {
  const text = `[TEAM-DIRECTIVE] ${event.action} #${event.id}${event.body ? `: ${event.body}` : ""}`;
  const now = new Date().toISOString();
  const { error } = await supabase.from("pending_user_messages").insert({
    user_id: userId,
    legacy_id: -Date.now(),
    agent: "capitano",
    body: text,
    kind: "notification",
    author: "user",
    delivered_via: null,
    created_at: now,
  });
  if (error) return { ok: false, status: "error", error: "enqueue_failed" };
  await supabase
    .from("team_state")
    .upsert(
      { user_id: userId, chat_requested_at: now },
      { onConflict: "user_id" },
    );
  return { ok: true, status: "queued" };
}

function enqueueCaptainEvent(
  db: Database.Database,
  event: { action: string; id: number; body?: string },
): CaptainEvent {
  const text = `[TEAM-DIRECTIVE] ${event.action} #${event.id}${event.body ? `: ${event.body}` : ""}`;
  try {
    db.prepare(
      "INSERT INTO pending_user_messages (agent, body, kind, delivered_via) VALUES (?, ?, 'notification', NULL)",
    ).run("capitano", text);
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
  const { userId, supabase } = resolved.user;
  const { data, error } = await supabase
    .from("team_directives")
    .select(
      "id, body, kind, status, sort_order, created_by, created_at, updated_at, archived_at",
    )
    .eq("user_id", userId)
    .order("status", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
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
      const info = db
        .prepare(
          "INSERT INTO team_directives (body, kind, status, sort_order, created_by) " +
            "VALUES (?, ?, 'active', ?, 'user')",
        )
        .run(text, kind, nxt?.n ?? 1);
      const captainEvent = enqueueCaptainEvent(db, {
        action: "created",
        id: Number(info.lastInsertRowid),
        body: text,
      });
      return NextResponse.json({
        id: String(info.lastInsertRowid),
        source: "local",
        captain_event: captainEvent,
      });
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
  const { userId, supabase } = resolved.user;
  const { data, error } = await supabase
    .from("team_directives")
    .insert({
      user_id: userId,
      body: text,
      kind,
      status: "active",
      created_by: "user",
    })
    .select("id")
    .single();
  if (error) {
    return sanitizedError(error, {
      status: 500,
      scope: "team-directives",
      publicMessage: "insert_failed",
    });
  }
  const captainEvent = await enqueueCaptainCloud(supabase, userId, {
    action: "created",
    id: data.id,
    body: text,
  });
  return NextResponse.json({
    id: String(data.id),
    source: "cloud",
    captain_event: captainEvent,
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
      if (archive) {
        db.prepare(
          "UPDATE team_directives SET status = 'archived', " +
            "archived_at = datetime('now','localtime'), updated_at = datetime('now','localtime') " +
            "WHERE id = ?",
        ).run(id);
      } else {
        db.prepare(
          "UPDATE team_directives SET body = ?, updated_at = datetime('now','localtime') WHERE id = ?",
        ).run(text, id);
      }
      const captainEvent = enqueueCaptainEvent(db, {
        action: archive ? "archived" : "edited",
        id,
        body: archive ? undefined : (text ?? undefined),
      });
      return NextResponse.json({
        ok: true,
        source: "local",
        captain_event: captainEvent,
      });
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
  const { userId, supabase } = resolved.user;
  const patch = archive
    ? {
        status: "archived",
        archived_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
    : { body: text, updated_at: new Date().toISOString() };
  const { error } = await supabase
    .from("team_directives")
    .update(patch)
    .eq("id", id)
    .eq("user_id", userId);
  if (error) {
    return sanitizedError(error, {
      status: 500,
      scope: "team-directives",
      publicMessage: "update_failed",
    });
  }
  const captainEvent = await enqueueCaptainCloud(supabase, userId, {
    action: archive ? "archived" : "edited",
    id,
    body: archive ? undefined : (text ?? undefined),
  });
  return NextResponse.json({
    ok: true,
    source: "cloud",
    captain_event: captainEvent,
  });
}
