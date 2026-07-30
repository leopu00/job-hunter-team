import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/team-state/auth";
import { isDemoLegacyId, findDemoPositionByLegacyId } from "@/lib/demo/data";
import { activeDemoPersona } from "@/lib/demo/mode";
import { sanitizedError } from "@/lib/error-response";

export const dynamic = "force-dynamic";

// Sintesi JD on-demand per il mazzo /swipe (20/07): senza cap il mazzo può
// superare le 900 card e spedire i testi inline affossava SSR e hydration
// (~2MB, 10s+). Il deck viaggia coi soli metadati; la card scarica qui la
// sua sintesi quando sta per essere mostrata. Client di SESSIONE → RLS
// applicata, niente filtro user_id manuale.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ legacyId: string }> },
) {
  const resolved = await resolveUser(req);
  if (!resolved.ok) return resolved.res;
  if (resolved.user.source !== "session") {
    return NextResponse.json(
      { error: "Solo il browser legge le sintesi" },
      { status: 403 },
    );
  }
  const { supabase } = resolved.user;
  const { legacyId } = await params;
  const id = Number(legacyId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "legacyId invalido" }, { status: 400 });
  }

  // [JHT-WEB-DEMO] Sintesi dal dataset statico per le posizioni demo.
  if (isDemoLegacyId(id) && (await activeDemoPersona())) {
    const p = findDemoPositionByLegacyId(id);
    return NextResponse.json({ summary: p?.jd_summary ?? null });
  }

  const { data, error } = await supabase
    .from("positions")
    .select("jd_summary, jd_text")
    .eq("legacy_id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    return sanitizedError(error, {
      status: 500,
      scope: "positions/[legacyId]/summary",
    });
  }

  // Stesso fallback del vecchio toCard: posizioni pre-mig-049 senza
  // sintesi → JD grezza troncata, \r\n normalizzati (render pre-line).
  const summary =
    data?.jd_summary ??
    (data?.jd_text
      ? data.jd_text.replace(/\r\n/g, "\n").trim().slice(0, 1500)
      : null);
  return NextResponse.json({ summary });
}
