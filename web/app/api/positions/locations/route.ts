import { NextResponse } from "next/server";
import { getPositionLocations } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getPositionLocations();
  return NextResponse.json(data);
}
