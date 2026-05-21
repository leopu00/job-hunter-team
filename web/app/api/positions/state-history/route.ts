import { NextResponse } from "next/server";
import { getPositionStateHistory } from "@/lib/queries";

export const dynamic = "force-dynamic";

// Timestamp delle transizioni di stato per ogni posizione: serve a
// ricostruire client-side la composizione della pipeline a un istante T.
export async function GET() {
  const data = await getPositionStateHistory();
  return NextResponse.json(data);
}
