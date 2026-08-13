import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getPositionById } from "@/lib/queries";
import {
  publicApplicationState,
  publicPositionState,
} from "@/lib/position-state";

export const dynamic = "force-dynamic";

// Dettaglio singola posizione per la dashboard NATIVA desktop [JHT-DASHBOARD-SPLIT].
// La UI nativa Electron non può fare fetch cross-origin dal renderer: il MAIN
// process chiama questa route (con local-token) e la espone via IPC. Mancava
// una route REST per il dettaglio (il web usava getPositionById server-side) →
// la aggiungiamo qui, stesso pattern di /api/positions/recent.

// found_at/last_checked/scored_at in DB sono UTC senza suffisso Z → normalizza.
function toUtcIso(s: string | null | undefined): string | null {
  if (typeof s !== "string" || s.length < 10) return s ?? null;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) return s;
  return s.replace(" ", "T") + "Z";
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ legacyId: string }> },
) {
  const denied = await requireAuth();
  if (denied) return denied;

  // Slug unificato a `legacyId` per tutto il segmento /api/positions/[...]:
  // Next vieta slug diversi allo stesso livello. L'URL è invariato — questa GET
  // riceve lo stesso identificatore di prima (solo la chiave del param cambia).
  const { legacyId: id } = await params;
  const detail = await getPositionById(id);
  if (!detail) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const position = {
    ...detail.position,
    found_at: toUtcIso((detail.position as { found_at?: string }).found_at),
    last_checked: toUtcIso(
      (detail.position as { last_checked?: string }).last_checked,
    ),
  };
  const score = detail.score
    ? {
        ...detail.score,
        scored_at: toUtcIso((detail.score as { scored_at?: string }).scored_at),
      }
    : null;

  return NextResponse.json({
    state: publicPositionState(position.status),
    application_state: detail.application
      ? publicApplicationState(detail.application.status)
      : null,
    ticket_indicator: (detail.tickets ?? []).some(
      (ticket) => ticket.status === "open" || ticket.status === "assigned",
    )
      ? "pending"
      : "none",
    position,
    score,
    highlights: detail.highlights ?? [],
    company: detail.company ?? null,
    application: detail.application ?? null,
    tickets: detail.tickets ?? [],
  });
}
