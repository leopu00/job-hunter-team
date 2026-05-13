import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getWorkspacePath } from "@/lib/workspace";
import { isLocalRequest } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Per ogni agente, restituisce il timestamp UTC dell'ultima scrittura
// che gli è attribuibile guardando direttamente le tabelle del DB (zero
// modifiche alle skill). La pagina /team/v2 polla questo endpoint e
// quando un timestamp avanza anima il pallino dall'agente al nodo DB.
//
//   scout      → MAX(positions.found_at)
//   scorer     → MAX(scores.scored_at)
//   analista   → MAX(positions.last_checked)
//   scrittore  → MAX(positions.status_changed_at) WHERE status IN ('writing','review')
//   critico    → MAX(positions.status_changed_at) WHERE status = 'ready'
//
// `status_changed_at` è popolato da un trigger SQLite a ogni cambio di
// `positions.status`: il trigger non sa quale agente ha fatto l'UPDATE
// ma il valore di `status` post-update lo identifica univocamente
// (mapping nel CASE qui sopra e in getRecentlyTouchedPositionsLocal).

type Row = { ts: string | null };

function toUtcIso(s: string | null | undefined): string | null {
  if (typeof s !== "string" || s.length < 10) return null;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) return s;
  return s.replace(" ", "T") + "Z";
}

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  if (!(await isLocalRequest())) {
    return NextResponse.json({ writes: {} });
  }
  const ws = await getWorkspacePath();
  if (!ws) return NextResponse.json({ writes: {} });

  const db = getDb(ws);
  const writes: Record<string, string | null> = {};

  try {
    const r = db
      .prepare("SELECT MAX(found_at) AS ts FROM positions")
      .get() as Row;
    writes.scout = toUtcIso(r?.ts);
  } catch {
    writes.scout = null;
  }

  try {
    const r = db
      .prepare("SELECT MAX(scored_at) AS ts FROM scores")
      .get() as Row;
    writes.scorer = toUtcIso(r?.ts);
  } catch {
    writes.scorer = null;
  }

  try {
    const r = db
      .prepare("SELECT MAX(last_checked) AS ts FROM positions")
      .get() as Row;
    writes.analista = toUtcIso(r?.ts);
  } catch {
    writes.analista = null;
  }

  try {
    const r = db
      .prepare(
        `
      SELECT MAX(status_changed_at) AS ts FROM positions
      WHERE status IN ('writing','review')
    `,
      )
      .get() as Row;
    writes.scrittore = toUtcIso(r?.ts);
  } catch {
    writes.scrittore = null;
  }

  try {
    const r = db
      .prepare(
        `
      SELECT MAX(status_changed_at) AS ts FROM positions
      WHERE status = 'ready'
    `,
      )
      .get() as Row;
    writes.critico = toUtcIso(r?.ts);
  } catch {
    writes.critico = null;
  }

  return NextResponse.json({ writes });
}
