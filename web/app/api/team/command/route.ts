import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { enqueueIfRemote } from "@/lib/team-bus";
import { createClient } from "@/lib/supabase/server";
import { invalidJsonBody } from "@/app/api/_lib/error-body";
import { sanitizedError } from "@/lib/error-response";

export const dynamic = "force-dynamic";

// Dispatch comando team via team_commands bus. Inserisce una riga
// in DB; il poller sulla VPS (cli/src/lib/team-commands-poller.js)
// polla l'endpoint /api/cloud-sync/team-commands e esegue il comando
// dentro il container. Il client può SELECT sulla stessa riga (RLS=own)
// per il feedback di processing (pending → running → done|error).
//
// Body:
//   { action: 'start' | 'stop' | 'restart',
//     payload?: { target?: 'all' | '<agent>' | 'bridge' } }
//
//   - target='all' (default) → team-wide (`jht team <action>`)
//   - target='<agent>' → single agent (assistente, capitano, ...)
//   - target='bridge' → sentinel-bridge.py control
//
// Response: { ok: true, command: { id, status, requested_at } }

const VALID_ACTIONS = new Set(["start", "stop", "restart"]);
const VALID_TARGETS = new Set([
  "all",
  "assistente",
  "capitano",
  "sentinella",
  "scout",
  "scorer",
  "analista",
  "scrittore",
  "critico",
  "mentor",
  "bridge",
]);

export async function POST(req: NextRequest) {
  const authBlock = await requireAuth();
  if (authBlock) return authBlock;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "not signed in" },
      { status: 401 },
    );
  }

  let body: { action?: string; payload?: Record<string, unknown> } = {};
  try {
    body = await req.json();
  } catch {
    return invalidJsonBody();
  }

  const action = String(body.action || "")
    .trim()
    .toLowerCase();
  if (!VALID_ACTIONS.has(action)) {
    return NextResponse.json(
      {
        ok: false,
        error: `invalid action: must be one of ${[...VALID_ACTIONS].join(", ")}`,
      },
      { status: 400 },
    );
  }

  const rawPayload =
    body.payload && typeof body.payload === "object" ? body.payload : {};
  const target = String((rawPayload as Record<string, unknown>).target ?? "all")
    .trim()
    .toLowerCase();
  if (!VALID_TARGETS.has(target)) {
    return NextResponse.json(
      {
        ok: false,
        error: `invalid target: must be one of ${[...VALID_TARGETS].join(", ")}`,
      },
      { status: 400 },
    );
  }
  const normalizedPayload = { ...rawPayload, target };

  // [JHT-WEB-READONLY] — il controllo del team è desktop-only: dal cloud questo
  // dispatch al bus team_commands è 403 (coerente con start-all/stop-all/bridge,
  // che già usano enqueueIfRemote). Via tunnel SSH (Host=localhost) enqueueIfRemote
  // ritorna null → enqueue normale, eseguito dal poller VPS. Senza questo gate un
  // browser cloud loggato poteva accodare start/stop/restart bypassando il read-only.
  const remote = await enqueueIfRemote(
    action as "start" | "stop" | "restart",
    target,
  );
  if (remote) return remote;

  const { data, error } = await supabase
    .from("team_commands")
    .insert({
      user_id: user.id,
      action,
      payload: normalizedPayload,
    })
    .select("id, status, requested_at")
    .single();

  if (error) {
    return sanitizedError(error, {
      status: 500,
      scope: "team/command",
      publicMessage: "insert_failed",
    });
  }

  return NextResponse.json({ ok: true, command: data });
}
