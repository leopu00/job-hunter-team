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

// Ticket utente→team su una posizione (2026-06-18). L'utente scrive una richiesta
// testuale libera dalla pagina dettaglio → questa route crea un ticket 'open' su
// `position_tickets`. Il Capitano lo nota (ticket.py list-open), lo assegna a un
// agente; l'agente risolve con una risposta testuale (ticket.py resolve) che
// l'utente vede nella sezione dedicata della pagina.
//
// Due path come write-request:
//   A) SQLite locale (web nel container) = source of truth per gli agenti.
//   B) cloud-only (container offline / web Vercel) → su Supabase.
// NB: il sync bidirezionale dei ticket cloud↔VPS è un follow-up; il path A
// (dashboard nel container) è completo end-to-end.

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ legacyId: string }> },
): Promise<NextResponse> {
  const denied = await requireAuth();
  if (denied) return denied;
  // [JHT-DASHBOARD-NATIVE] L'auth cloud (resolveUser) è spostata sotto, al solo
  // path cloud: la scrittura locale (INSERT su SQLite) vale sia per il browser
  // sia per il desktop nativo (local-token) e non ha bisogno di un utente cloud.
  const { legacyId: legacyIdParam } = await params;
  const legacyId = Number.parseInt(legacyIdParam, 10);
  if (!Number.isInteger(legacyId) || legacyId <= 0) {
    return NextResponse.json({ error: "legacyId non valido" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    request_text?: string;
  };
  const text =
    typeof body.request_text === "string" ? body.request_text.trim() : "";
  if (!text) {
    return NextResponse.json(
      { error: "La richiesta non può essere vuota" },
      { status: 400 },
    );
  }
  if (text.length > 2000) {
    return NextResponse.json(
      { error: "Richiesta troppo lunga (max 2000 caratteri)" },
      { status: 400 },
    );
  }

  const hasLocal = fs.existsSync(JHT_DB_PATH);

  if (hasLocal) {
    let ticketId: number;
    const db = new Database(JHT_DB_PATH);
    try {
      db.pragma("journal_mode = WAL");
      db.pragma("foreign_keys = ON");
      const exists = db
        .prepare<
          [number],
          { id: number }
        >("SELECT id FROM positions WHERE id = ?")
        .get(legacyId);
      if (!exists) {
        return NextResponse.json(
          { error: `Posizione #${legacyId} non trovata` },
          { status: 404 },
        );
      }
      const info = db
        .prepare(
          "INSERT INTO position_tickets (position_id, request_text, kind, status) " +
            "VALUES (?, ?, 'custom', 'open')",
        )
        .run(legacyId, text);
      ticketId = Number(info.lastInsertRowid);
    } finally {
      db.close();
    }
    // NB: il mirror sul cloud lo fa il daemon `jht cloud sync-tickets` con
    // correlazione `cloud_id` (round-trip [JHT-DATA-SYNC] fase 2). NON facciamo
    // più l'insert best-effort qui: creava una riga cloud scollegata che il
    // pull avrebbe poi ri-importato come ticket duplicato. cloud_synced è
    // quindi differito al prossimo tick del daemon.
    return NextResponse.json({
      id: String(ticketId),
      status: "open",
      cloud_synced: false,
      source: "local",
    });
  }

  // [JHT-DASHBOARD-NATIVE] Oltre questo punto = cloud (SQLite assente). Il
  // desktop nativo col local-token richiede il DB locale: se manca → 503,
  // non passiamo dal cloud (resolveUser→Supabase, che rifiuterebbe il Bearer).
  if (
    isLocalTokenAuthenticated(
      req.headers.get("authorization"),
      (await cookies()).get(LOCAL_TOKEN_COOKIE)?.value,
    )
  ) {
    return NextResponse.json({ error: "DB locale assente" }, { status: 503 });
  }
  const resolved = await resolveUser(req);
  if (!resolved.ok) return resolved.res;
  if (resolved.user.source !== "session") {
    return NextResponse.json(
      { error: "Solo il browser può creare ticket (no Bearer token)" },
      { status: 403 },
    );
  }
  const { userId, supabase } = resolved.user;

  // Cloud-mode: il ticket vive su Supabase (il team lo vedrà al sync — follow-up).
  const { data, error } = await supabase
    .from("position_tickets")
    .insert({
      user_id: userId,
      position_legacy_id: legacyId,
      request_text: text,
      kind: "custom",
      status: "open",
    })
    .select("id")
    .single();
  if (error) {
    return sanitizedError(error, {
      status: 500,
      scope: "positions/[legacyId]/ticket",
      publicMessage: "insert_failed",
    });
  }
  return NextResponse.json({
    id: String(data.id),
    status: "open",
    cloud_synced: true,
    source: "cloud",
  });
}
