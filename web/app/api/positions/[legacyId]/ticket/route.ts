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
import { RESCORE_TICKET_KIND } from "@/lib/rescore-ticket";

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
    kind?: string;
  };
  const kind = body.kind ?? "custom";
  if (kind !== "custom" && kind !== RESCORE_TICKET_KIND) {
    return NextResponse.json(
      { error: "Tipo di richiesta non valido" },
      { status: 400 },
    );
  }
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
    let ticketStatus = "open";
    let deduplicated = false;
    const db = new Database(JHT_DB_PATH);
    let transactionOpen = false;
    try {
      db.pragma("journal_mode = WAL");
      db.pragma("foreign_keys = ON");
      const exists = db
        .prepare<[number], { id: number }>(
          "SELECT id FROM positions WHERE id = ?",
        )
        .get(legacyId);
      if (!exists) {
        return NextResponse.json(
          { error: `Posizione #${legacyId} non trovata` },
          { status: 404 },
        );
      }

      if (kind === RESCORE_TICKET_KIND) {
        // Il lock rende atomici controllo+INSERT. L'indice parziale nello
        // schema è la seconda barriera: due click/processi non possono lasciare
        // due rivalutazioni attive della stessa posizione.
        db.exec("BEGIN IMMEDIATE");
        transactionOpen = true;
        const active = db
          .prepare<
            [number, string],
            { id: number; status: "open" | "assigned" }
          >(
            "SELECT id, status FROM position_tickets " +
              "WHERE position_id = ? AND kind = ? " +
              "AND status IN ('open','assigned') " +
              "ORDER BY created_at ASC, id ASC LIMIT 1",
          )
          .get(legacyId, RESCORE_TICKET_KIND);
        if (active) {
          ticketId = active.id;
          ticketStatus = active.status;
          deduplicated = true;
          db.exec("COMMIT");
          transactionOpen = false;
          return NextResponse.json({
            id: String(ticketId),
            status: ticketStatus,
            deduplicated,
            cloud_synced: false,
            source: "local",
          });
        }
      }
      const info = db
        .prepare(
          "INSERT INTO position_tickets (position_id, request_text, kind, status) " +
            "VALUES (?, ?, ?, 'open')",
        )
        .run(legacyId, text, kind);
      ticketId = Number(info.lastInsertRowid);
      if (transactionOpen) {
        db.exec("COMMIT");
        transactionOpen = false;
      }
    } catch (error) {
      if (transactionOpen) db.exec("ROLLBACK");
      throw error;
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
      status: ticketStatus,
      deduplicated,
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

  const findActiveRescore = async () =>
    supabase
      .from("position_tickets")
      .select("id, status")
      .eq("user_id", userId)
      .eq("position_legacy_id", legacyId)
      .eq("kind", RESCORE_TICKET_KIND)
      .in("status", ["open", "assigned"])
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

  if (kind === RESCORE_TICKET_KIND) {
    const { data: active, error: activeError } = await findActiveRescore();
    if (activeError) {
      return sanitizedError(activeError, {
        status: 500,
        scope: "positions/[legacyId]/ticket",
        publicMessage: "query_failed",
      });
    }
    if (active) {
      return NextResponse.json({
        id: String(active.id),
        status: active.status,
        deduplicated: true,
        cloud_synced: true,
        source: "cloud",
      });
    }
  }

  // Cloud-mode: il ticket vive su Supabase (il team lo vedrà al sync — follow-up).
  const { data, error } = await supabase
    .from("position_tickets")
    .insert({
      user_id: userId,
      position_legacy_id: legacyId,
      request_text: text,
      kind,
      status: "open",
    })
    .select("id")
    .single();
  if (error) {
    // L'indice parziale chiude la race fra due richieste cloud concorrenti.
    // Il loser rilegge il ticket vincente e restituisce la sua identità: un
    // 23505 non diventa un falso errore né crea un canale alternativo.
    if (kind === RESCORE_TICKET_KIND && error.code === "23505") {
      const { data: active } = await findActiveRescore();
      if (active) {
        return NextResponse.json({
          id: String(active.id),
          status: active.status,
          deduplicated: true,
          cloud_synced: true,
          source: "cloud",
        });
      }
    }
    return sanitizedError(error, {
      status: 500,
      scope: "positions/[legacyId]/ticket",
      publicMessage: "insert_failed",
    });
  }
  return NextResponse.json({
    id: String(data.id),
    status: "open",
    deduplicated: false,
    cloud_synced: true,
    source: "cloud",
  });
}
