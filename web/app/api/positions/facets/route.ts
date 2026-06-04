import { NextResponse } from "next/server";
import { getPositionFacets } from "@/lib/queries";

export const dynamic = "force-dynamic";

// Dataset leggero (universo completo, incluse le excluded) usato dalla
// sidebar /positions per ricalcolare donut/istogramma/location con
// conteggi che si incrociano, lato client.
export async function GET() {
  const data = await getPositionFacets();
  return NextResponse.json(data);
}
