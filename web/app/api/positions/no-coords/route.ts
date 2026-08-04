import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { activeDemoPersona } from "@/lib/demo/mode";
import { getPositionsWithoutCoords } from "@/lib/queries";

export const dynamic = "force-dynamic";

// [WEB-10-DATA-ROUTES-UNGUARDED] Come coords/locations: unico chiamante
// `MapCharts` sotto `app/(protected)/map`, fetch client-side, nessun
// prerender → guardia piena.
export async function GET() {
  // Demo: seed statici, visitatore senza account → auth solo fuori dalla
  // demo (stesso ordine di /api/applications).
  const dp = await activeDemoPersona();
  if (!dp) {
    const denied = await requireAuth();
    if (denied) return denied;
  }

  const data = await getPositionsWithoutCoords();
  return NextResponse.json(data);
}
