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
import { sanitizedError } from "@/lib/error-response";
import { RESCORE_TICKET_KIND } from "@/lib/rescore-ticket";
import { publicPositionState } from "@/lib/position-state";
import { ticketRequestWithAttachment } from "@/lib/ticket-attachment";
import {
  saveUserDocument,
  UserDocumentUploadError,
} from "@/lib/user-document-upload.server";

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

  let requestText: unknown;
  let requestedKind: unknown;
  let attachment: File | null = null;
  if (req.headers.get("content-type")?.includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    if (!form) {
      return NextResponse.json(
        { error: "form data non valido" },
        { status: 400 },
      );
    }
    requestText = form.get("request_text");
    requestedKind = form.get("kind");
    const candidate = form.get("attachment");
    attachment = candidate && typeof candidate !== "string" ? candidate : null;
  } else {
    const body = (await req.json().catch(() => ({}))) as {
      request_text?: string;
      kind?: string;
    };
    requestText = body.request_text;
    requestedKind = body.kind;
  }
  const kind = typeof requestedKind === "string" ? requestedKind : "custom";
  if (kind !== "custom" && kind !== RESCORE_TICKET_KIND) {
    return NextResponse.json(
      { error: "Tipo di richiesta non valido" },
      { status: 400 },
    );
  }
  const text = typeof requestText === "string" ? requestText.trim() : "";
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

  const hasLocal = !isCloudDeploy() && fs.existsSync(JHT_DB_PATH);

  if (attachment && !hasLocal) {
    return NextResponse.json(
      { error: "attachment_unavailable" },
      { status: 503 },
    );
  }

  if (hasLocal) {
    let ticketId: number;
    let ticketStatus = "open";
    let deduplicated = false;
    const db = new Database(JHT_DB_PATH);
    let transactionOpen = false;
    let positionStatus = "new";
    try {
      db.pragma("journal_mode = WAL");
      db.pragma("foreign_keys = ON");
      // Parent lookup + ticket effect are one write transaction for every
      // kind, not only rescore. A concurrent delete cannot orphan the ticket.
      db.exec("BEGIN IMMEDIATE");
      transactionOpen = true;
      const exists = db
        .prepare<[number], { id: number; status: string }>(
          "SELECT id, status FROM positions WHERE id = ?",
        )
        .get(legacyId);
      if (!exists) {
        db.exec("ROLLBACK");
        transactionOpen = false;
        return NextResponse.json(
          { error: `Posizione #${legacyId} non trovata` },
          { status: 404 },
        );
      }
      positionStatus = exists.status;

      let storedText = text;
      if (attachment) {
        try {
          const saved = await saveUserDocument(attachment);
          storedText = ticketRequestWithAttachment(text, saved.path);
        } catch (error) {
          db.exec("ROLLBACK");
          transactionOpen = false;
          return NextResponse.json(
            {
              error:
                error instanceof UserDocumentUploadError
                  ? error.message
                  : "Errore durante il caricamento dell'allegato",
            },
            { status: 400 },
          );
        }
      }

      if (kind === RESCORE_TICKET_KIND) {
        // BEGIN IMMEDIATE + indice parziale: due processi non possono lasciare
        // due rivalutazioni attive della stessa posizione.
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
            position_state: publicPositionState(positionStatus),
            ticket_indicator: "pending",
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
        .run(legacyId, storedText, kind);
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
      position_state: publicPositionState(positionStatus),
      ticket_indicator: "pending",
      cloud_synced: false,
      source: "local",
    });
  }

  // [JHT-DASHBOARD-NATIVE] Oltre questo punto = cloud (SQLite assente). Il
  // desktop nativo col local-token richiede il DB locale: se manca → 503,
  // non passiamo dal cloud (resolveUser→Supabase, che rifiuterebbe il Bearer).
  if (
    !isCloudDeploy() &&
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
  const { supabase } = resolved.user;

  // La RPC risolve e blocca il parent tenant-bound, deduplica il rescore e
  // inserisce il ticket nella stessa transazione PostgreSQL.
  const { data, error } = await supabase.rpc("create_position_ticket", {
    p_position_legacy_id: legacyId,
    p_request_text: text,
    p_kind: kind,
  });
  if (error) {
    return sanitizedError(error, {
      status: 500,
      scope: "positions/[legacyId]/ticket",
      publicMessage: "insert_failed",
    });
  }
  const receipt = data as Record<string, unknown> | null;
  if (
    !receipt ||
    typeof receipt.id !== "string" ||
    (receipt.status !== "open" && receipt.status !== "assigned") ||
    typeof receipt.position_status !== "string" ||
    typeof receipt.deduplicated !== "boolean"
  ) {
    console.error("[positions/[legacyId]/ticket] invalid RPC receipt");
    return NextResponse.json({ error: "invalid_ack" }, { status: 502 });
  }
  return NextResponse.json({
    id: receipt.id,
    status: receipt.status,
    deduplicated: receipt.deduplicated,
    position_state: publicPositionState(receipt.position_status),
    ticket_indicator: "pending",
    cloud_synced: true,
    source: "cloud",
  });
}
