import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getDashboardStats } from "@/lib/queries";

export const dynamic = "force-dynamic";

// Statistiche pipeline (conteggi per stato) per la sezione "Statistiche" della
// dashboard NATIVA desktop [JHT-DASHBOARD-SPLIT]. getDashboardStats() era solo
// server-side (nessuna route REST) → la esponiamo qui, consumata via IPC dal
// main process dell'app desktop.
export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  const stats = await getDashboardStats();
  return NextResponse.json(stats);
}
