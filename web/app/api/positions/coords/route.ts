import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { activeDemoPersona } from "@/lib/demo/mode";
import { getPositionsWithCoords } from "@/lib/queries";

export const dynamic = "force-dynamic";

// [WEB-10-DATA-ROUTES-UNGUARDED] Alimenta il globo, ma il globo non è
// pubblico: `JobsGlobe` è montato solo da `MapCharts`, che è usato solo da
// `app/(protected)/map/page.tsx`, e la fetch parte da un `useEffect` lato
// client — nessun prerender statico, nessuna pagina della landing. La
// guardia si può quindi stringere senza spegnere niente di visibile agli
// anonimi.
export async function GET() {
  // In demo il visitatore non ha account (wizard /welcome) e la query
  // ritorna seed statici senza mai toccare il DB: l'auth vale solo fuori
  // dalla demo. Stesso ordine di /api/applications e /api/profile/files.
  const dp = await activeDemoPersona();
  if (!dp) {
    const denied = await requireAuth();
    if (denied) return denied;
  }

  const data = await getPositionsWithCoords();
  return NextResponse.json(data);
}
