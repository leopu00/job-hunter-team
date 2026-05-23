import { NextResponse } from "next/server";
import { getPositionsWithCoords } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getPositionsWithCoords();
  return NextResponse.json(data);
}
