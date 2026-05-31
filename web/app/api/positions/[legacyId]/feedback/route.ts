import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/team-state/auth";

export const dynamic = "force-dynamic";

const VALID_ACTIONS = ["like", "dislike", "hide", "star"] as const;
type Action = (typeof VALID_ACTIONS)[number];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ legacyId: string }> },
) {
  const resolved = await resolveUser(req);
  if (!resolved.ok) return resolved.res;
  if (resolved.user.source !== "session") {
    return NextResponse.json(
      { error: "Solo il browser registra feedback" },
      { status: 403 },
    );
  }
  const { userId, supabase } = resolved.user;
  const { legacyId } = await params;

  if (!legacyId)
    return NextResponse.json({ error: "legacyId mancante" }, { status: 400 });

  let body: { action?: unknown; reason?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON body invalido" }, { status: 400 });
  }

  const action =
    typeof body.action === "string" ? (body.action as Action) : null;
  if (!action || !(VALID_ACTIONS as readonly string[]).includes(action)) {
    return NextResponse.json(
      {
        error: `action invalida (deve essere uno di: ${VALID_ACTIONS.join(", ")})`,
      },
      { status: 400 },
    );
  }
  const reason =
    typeof body.reason === "string" && body.reason.length <= 500
      ? body.reason
      : null;

  const { data, error } = await supabase
    .from("position_feedback")
    .insert({ user_id: userId, position_legacy_id: legacyId, action, reason })
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ feedback: data });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ legacyId: string }> },
) {
  const resolved = await resolveUser(req);
  if (!resolved.ok) return resolved.res;
  const { userId, supabase } = resolved.user;
  const { legacyId } = await params;

  const { data, error } = await supabase
    .from("position_feedback")
    .select("*")
    .eq("user_id", userId)
    .eq("position_legacy_id", legacyId)
    .order("created_at", { ascending: false });

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ feedback: data ?? [] });
}
