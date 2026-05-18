import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getWorkspacePath } from "@/lib/workspace";
import { isLocalRequest } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Per ogni agente, restituisce il timestamp UTC dell'ultima scrittura
// che gli è attribuibile guardando direttamente le tabelle del DB (zero
// modifiche alle skill). La pagina /team/v2 polla questo endpoint e
// quando un timestamp avanza anima il pallino dall'agente al nodo DB.
//
//   scout      → MAX(positions.found_at)
//   scorer     → MAX(scores.scored_at)
//   analista   → MAX(positions.last_checked)
//   scrittore  → local: MAX(positions.status_changed_at) WHERE status IN ('writing','review')
//                 cloud: MAX(applications.written_at)
//   critico    → local: MAX(positions.status_changed_at) WHERE status = 'ready'
//                 cloud: MAX(applications.critic_reviewed_at)
//
// `status_changed_at` è popolato da un trigger SQLite a ogni cambio di
// `positions.status`: il trigger non sa quale agente ha fatto l'UPDATE
// ma il valore di `status` post-update lo identifica univocamente
// (mapping nel CASE qui sopra e in getRecentlyTouchedPositionsLocal).

type Row = { ts: string | null };
type SupabaseLike = Awaited<ReturnType<typeof createClient>>;

function toUtcIso(s: string | null | undefined): string | null {
  if (typeof s !== "string" || s.length < 10) return null;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) return s;
  return s.replace(" ", "T") + "Z";
}

async function latestTimestamp(
  supabase: SupabaseLike,
  table: string,
  column: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from(table)
      .select(column)
      .not(column, "is", null)
      .order(column, { ascending: false })
      .limit(1);
    if (error) return null;
    const row = Array.isArray(data)
      ? (data[0] as Record<string, unknown>)
      : null;
    return toUtcIso(typeof row?.[column] === "string" ? row[column] : null);
  } catch {
    return null;
  }
}

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  if (!(await isLocalRequest())) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ writes: {} });

    const [scout, scorer, analista, scrittore, critico] = await Promise.all([
      latestTimestamp(supabase, "positions", "found_at"),
      latestTimestamp(supabase, "scores", "scored_at"),
      latestTimestamp(supabase, "positions", "last_checked"),
      latestTimestamp(supabase, "applications", "written_at"),
      latestTimestamp(supabase, "applications", "critic_reviewed_at"),
    ]);

    return NextResponse.json({
      writes: { scout, scorer, analista, scrittore, critico },
      remote: true,
    });
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
