import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { activeDemoPersona } from "@/lib/demo/mode";
import { getPositionFacets } from "@/lib/queries";

export const dynamic = "force-dynamic";

// Dataset leggero (universo completo, incluse le excluded) usato dalla
// sidebar /positions per ricalcolare donut/istogramma/location con
// conteggi che si incrociano, lato client.
export async function GET() {
  // [WEB-10-DATA-ROUTES-UNGUARDED] Unico chiamante:
  // `app/(protected)/positions/PositionsFilterSidebar.tsx`, fetch
  // client-side. In demo il visitatore non ha account e i dati sono seed
  // statici → auth solo fuori dalla demo (come /api/applications).
  const dp = await activeDemoPersona();
  if (!dp) {
    const denied = await requireAuth();
    if (denied) return denied;
  }

  const data = await getPositionFacets();
  return NextResponse.json(data);
}
