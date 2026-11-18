import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isLocalRequest } from "@/lib/auth";
import { isSupabaseConfigured, workspaceHasDb } from "@/lib/workspace";
import { getWorkspacePath } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { replyPendingMessageLocal } from "@/lib/pending-message-reply-local";
import { invalidJsonBody } from "@/app/api/_lib/error-body";
import { sanitizedError } from "@/lib/error-response";
import { applyToggleVerdict } from "@/lib/apply-request-rule";
import {
  assertCloudApplicationAnswerReply,
  isApplicationAnswerRequestBody,
} from "@/lib/application-answer-request";

export const dynamic = "force-dynamic";

const MAX_REPLY_LENGTH = 4000;

// L'utente risponde a un messaggio dell'agente via dashboard. La row
// viene anche ack-ata implicitamente (una reply implica visione).
// L'agente vedra' la risposta al prossimo tick via marker prompt-injection
// (filtro: user_reply_at IS NOT NULL AND agent_seen_reply_at IS NULL).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "id mancante" }, { status: 400 });
  }

  let body: { reply?: unknown };
  try {
    body = await req.json();
  } catch {
    return invalidJsonBody();
  }
  const reply = typeof body.reply === "string" ? body.reply.trim() : "";
  if (!reply) {
    return NextResponse.json({ error: "reply vuota" }, { status: 400 });
  }
  if (reply.length > MAX_REPLY_LENGTH) {
    return NextResponse.json(
      { error: `reply troppo lunga (max ${MAX_REPLY_LENGTH} char)` },
      { status: 400 },
    );
  }

  // [JHT-WEB-DEMO] Messaggio demo: nessun agente dall'altra parte, la
  // reply viene accettata e scartata (i dati demo sono statici).
  if (id.startsWith("demo-msg-")) {
    return NextResponse.json({ ok: true });
  }

  // Gate identico a ws() in lib/queries.ts (host locale + DB presente),
  // vedi commento in [id]/ack/route.ts.
  if ((await isLocalRequest()) && workspaceHasDb()) {
    const ws = await getWorkspacePath();
    if (!ws) {
      return NextResponse.json(
        { error: "workspace non trovato" },
        { status: 500 },
      );
    }
    try {
      const changed = replyPendingMessageLocal(id, reply);
      return NextResponse.json({ ok: true, changed });
    } catch (e) {
      const message = (e as Error).message;
      if (message.startsWith("closer_answer_")) {
        return NextResponse.json({ error: message }, { status: 409 });
      }
      return NextResponse.json(
        { error: `reply fallita: ${message}` },
        { status: 500 },
      );
    }
  }

  if (!isSupabaseConfigured) {
    return NextResponse.json(
      { error: "Supabase non configurato" },
      { status: 500 },
    );
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  const { data: target, error: targetError } = await supabase
    .from("pending_user_messages")
    .select("id, agent, body, kind, related_position_id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (targetError) {
    return sanitizedError(targetError, {
      status: 500,
      scope: "pending-messages/[id]/reply",
      publicMessage: "message_query_failed",
    });
  }
  if (!target) {
    return NextResponse.json(
      { error: "messaggio non trovato" },
      { status: 404 },
    );
  }
  // On the site an answer to the CLOSER does NOT renew the permission to apply: that is an L3 action and goes
  // only through the door (`request_action('position.apply_authorize')`: recent sign-in, confirmation in two
  // steps with the role and the company, the device sessions refused, the receipt in `web_action_log` that the
  // broker wants). The route saves the answer and tells the page which position to authorise; the person
  // confirms it on the page of the position, where the door is. Writing `positions.apply_requested` here with the
  // session was refused by the guard of 098 (500, the CLOSER stuck) or, without 098, said «reauthorised» for a
  // flag the broker never takes. On the box (SQLite) the local reply still renews the local flag.
  let authorisePositionId: string | null = null;
  const answersApplication =
    target.agent === "closer" &&
    target.kind === "question" &&
    !!target.related_position_id &&
    isApplicationAnswerRequestBody(target.body);
  if (answersApplication) {
    try {
      assertCloudApplicationAnswerReply(target.body, reply);
    } catch (error) {
      return NextResponse.json(
        { error: (error as Error).message },
        { status: 409 },
      );
    }
    const { data: position, error: positionError } = await supabase
      .from("positions")
      .select("id, status")
      .eq("id", target.related_position_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (positionError) {
      return sanitizedError(positionError, {
        status: 500,
        scope: "pending-messages/[id]/reply",
        publicMessage: "position_query_failed",
      });
    }
    if (!position) {
      return NextResponse.json(
        { error: "closer_answer_position_not_ready" },
        { status: 409 },
      );
    }
    const { data: application, error: applicationError } = await supabase
      .from("applications")
      .select("applied")
      .eq("position_id", position.id)
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (applicationError) {
      return sanitizedError(applicationError, {
        status: 500,
        scope: "pending-messages/[id]/reply",
        publicMessage: "application_query_failed",
      });
    }
    // Same rule as the apply-request route and the box gate: an answer never
    // re-authorises an application that has already been sent.
    const verdict = applyToggleVerdict({
      status: position.status,
      applied: application?.applied === true,
      requested: true,
    });
    if (!verdict.ok) {
      return NextResponse.json(
        { error: `closer_answer_${verdict.reason}` },
        { status: 409 },
      );
    }
    authorisePositionId = String(position.id);
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("pending_user_messages")
    .update({
      user_reply: reply,
      user_reply_at: now,
      // ack atomico se non gia' settato — riusa il valore esistente quando c'e'.
      acknowledged_at: now,
    })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id");

  if (error) {
    return sanitizedError(error, {
      status: 500,
      scope: "pending-messages/[id]/reply",
    });
  }
  if ((data?.length ?? 0) !== 1) {
    return NextResponse.json({ error: "reply_not_observed" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    changed: true,
    application_reauthorised: false,
    ...(answersApplication
      ? { authorisation_required: { position_id: authorisePositionId } }
      : {}),
  });
}
