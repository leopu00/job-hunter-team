import { NextResponse } from "next/server";
import { getPositionsWithoutCoords } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getPositionsWithoutCoords();
  return NextResponse.json(data);
}
