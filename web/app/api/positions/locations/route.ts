import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { activeDemoPersona } from "@/lib/demo/mode";
import { getPositionLocations } from "@/lib/queries";

export const dynamic = "force-dynamic";

// [WEB-10-DATA-ROUTES-UNGUARDED] Consumata solo da `MapCharts`
// (`app/(protected)/map`) con una fetch client-side: non è prerenderizzata
// e non compare in nessuna pagina pubblica → guardia piena.
export async function GET() {
  // Demo: seed statici, visitatore senza account → auth solo fuori dalla
  // demo (stesso ordine di /api/applications).
  const dp = await activeDemoPersona();
  if (!dp) {
    const denied = await requireAuth();
    if (denied) return denied;
  }

  const data = await getPositionLocations();
  return NextResponse.json(data);
}
