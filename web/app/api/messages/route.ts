import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/team-state/auth";
import { requireLocalWrite } from "@/lib/auth";
import { invalidJsonBody } from "@/app/api/_lib/error-body";
import { sanitizedError } from "@/lib/error-response";

export const dynamic = "force-dynamic";

const VALID_STATUS = ["pending", "delivered", "replied", "expired"] as const;
type Status = (typeof VALID_STATUS)[number];

export async function POST(req: NextRequest) {
  // [JHT-WEB-READONLY] d2 — la chat web→agente è solo-desktop: sul cloud (o da
  // browser non-localhost) è 403, il messaggio all'agente si invia dall'app
  // desktop / tunnel SSH. GET (lettura) e PATCH (source=token: il container
  // marca delivered/replied, percorso usato anche dal flusso bridge) restano
  // intatti → nessun impatto sul bridge Telegram (gira sulla VPS, non qui).
  const ro = await requireLocalWrite();
  if (ro) return ro;
  const resolved = await resolveUser(req);
  if (!resolved.ok) return resolved.res;
  if (resolved.user.source !== "session") {
    return NextResponse.json(
      { error: "Solo il browser scrive messaggi utente" },
      { status: 403 },
    );
  }
  const { userId, supabase } = resolved.user;

  let body: { agent?: unknown; message?: unknown; payload?: unknown };
  try {
    body = await req.json();
  } catch {
    return invalidJsonBody();
  }

  const agent = typeof body.agent === "string" ? body.agent.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!agent || agent.length > 64) {
    return NextResponse.json(
      { error: "agent invalido (1-64 char)" },
      { status: 400 },
    );
  }
  if (!message || message.length > 8000) {
    return NextResponse.json(
      { error: "message invalido (1-8000 char)" },
      { status: 400 },
    );
  }
  const payload =
    body.payload &&
    typeof body.payload === "object" &&
    !Array.isArray(body.payload)
      ? body.payload
      : {};

  const { data, error } = await supabase
    .from("user_to_agent_messages")
    .insert({ user_id: userId, agent, message, payload })
    .select()
    .single();

  if (error) return sanitizedError(error, { status: 500, scope: "messages" });
  return NextResponse.json({ message: data });
}

export async function GET(req: NextRequest) {
  const resolved = await resolveUser(req);
  if (!resolved.ok) return resolved.res;
  const { userId, supabase } = resolved.user;

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const limit = Math.min(
    parseInt(url.searchParams.get("limit") ?? "50", 10) || 50,
    200,
  );

  let q = supabase
    .from("user_to_agent_messages")
    .select("*")
    .eq("user_id", userId)
    .order("sent_at", { ascending: false })
    .limit(limit);

  if (status && (VALID_STATUS as readonly string[]).includes(status)) {
    q = q.eq("status", status);
  }

  const { data, error } = await q;
  if (error) return sanitizedError(error, { status: 500, scope: "messages" });
  return NextResponse.json({ messages: data ?? [] });
}

export async function PATCH(req: NextRequest) {
  const resolved = await resolveUser(req);
  if (!resolved.ok) return resolved.res;
  if (resolved.user.source !== "token") {
    return NextResponse.json(
      { error: "Solo il container aggiorna lo status messaggi" },
      { status: 403 },
    );
  }
  const { userId, supabase } = resolved.user;

  let body: { id?: unknown; status?: unknown };
  try {
    body = await req.json();
  } catch {
    return invalidJsonBody();
  }

  const id = typeof body.id === "string" ? body.id : null;
  const status =
    typeof body.status === "string" ? (body.status as Status) : null;
  if (!id || !status || !(VALID_STATUS as readonly string[]).includes(status)) {
    return NextResponse.json(
      { error: "id e status (pending/delivered/replied/expired) richiesti" },
      { status: 400 },
    );
  }

  const update: Record<string, unknown> = { status };
  if (status === "delivered") update.delivered_at = new Date().toISOString();
  if (status === "replied") update.replied_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("user_to_agent_messages")
    .update(update)
    .eq("id", id)
    .eq("user_id", userId)
    .select()
    .maybeSingle();

  if (error) return sanitizedError(error, { status: 500, scope: "messages" });
  if (!data)
    return NextResponse.json(
      { error: "Messaggio non trovato" },
      { status: 404 },
    );
  return NextResponse.json({ message: data });
}
