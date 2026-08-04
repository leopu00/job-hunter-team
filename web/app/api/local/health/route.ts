import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { localDbExists } from "@/lib/cloud-sync/local";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  const local = await localDbExists();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return NextResponse.json({
    local,
    logged_in: !!user,
    user_email: user?.email ?? null,
    user_id: user?.id ?? null,
  });
}
