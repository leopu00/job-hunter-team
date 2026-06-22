import { NextResponse } from "next/server";

// Liveness/readiness probe del runtime. Il launcher desktop (desktop/runtime.js)
// storicamente pollava /api/health per sapere quando il dev server Next era
// davvero su — ma la route non esisteva (404) e il runtime restava bloccato in
// 'warming' finché non veniva ucciso (vedi [JHT-DASHBOARD-SPLIT], 2026-06-22).
// Oggi il launcher usa `/` come segnale di readiness; questa route resta come
// contratto esplicito e leggero. Volutamente minimale: niente DB/auth/Supabase,
// così risponde 200 appena il server serve richieste — un check onesto e veloce.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ok: true, ts: Date.now() });
}
