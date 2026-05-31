import { NextRequest, NextResponse } from "next/server";
import { verifyBearerToken } from "@/lib/cloud-sync/auth";

export const dynamic = "force-dynamic";

// PATCH /api/cloud-sync/team-commands/:id
// Subscriber claims a pending command (atomic: status=pending → running)
// or marks it processed (status=done|error + processed_at + error).
//
// Body: { status: 'running' | 'done' | 'error', error?: string }
//
// Atomic claim: WHERE id=:id AND user_id=:userId AND status='pending'
// (per il primo claim), evita doppi exec se due subscriber girassero.

const VALID_STATUS = new Set(["running", "done", "error"]);

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await verifyBearerToken(req);
  if (!auth.ok) return auth.res;
  const { userId, admin } = auth.data;
  const { id } = await context.params;

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json(
      { ok: false, error: "invalid id (uuid expected)" },
      { status: 400 },
    );
  }

  let body: { status?: string; error?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid JSON body" },
      { status: 400 },
    );
  }
  const status = String(body.status || "")
    .trim()
    .toLowerCase();
  if (!VALID_STATUS.has(status)) {
    return NextResponse.json(
      {
        ok: false,
        error: `invalid status (allowed: ${[...VALID_STATUS].join(", ")})`,
      },
      { status: 400 },
    );
  }

  const update: Record<string, unknown> = { status };
  if (status === "done" || status === "error") {
    update.processed_at = new Date().toISOString();
    update.error =
      status === "error" ? (body.error || "unknown").slice(0, 2000) : null;
  }

  // Atomic claim for running: only if currently pending.
  let query = admin
    .from("team_commands")
    .update(update)
    .eq("id", id)
    .eq("user_id", userId);
  if (status === "running") {
    query = query.eq("status", "pending");
  }

  const { data, error } = await query.select("id, status").maybeSingle();

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json(
      { ok: false, error: "command not found or already processed" },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, command: data });
}
