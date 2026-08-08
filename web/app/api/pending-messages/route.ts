import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isLocalRequest } from "@/lib/auth";
import { isSupabaseConfigured, workspaceHasDb } from "@/lib/workspace";
import { getWorkspacePath } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { sendUserChatLocal } from "@/lib/local-queries";
import { getMessagesHistory, getPendingMessagesCount } from "@/lib/queries";
import { CHAT_AGENTS, MAX_CHAT_BODY, isChatAgent } from "@/lib/chat-agents";
import { invalidJsonBody } from "@/app/api/_lib/error-body";
import { sanitizedError } from "@/lib/error-response";

export const dynamic = "force-dynamic";

// Storico messaggi + conteggio non letti per il drawer messenger in navbar.
// Le query condivise gestiscono già il branch local (SQLite) / cloud (RLS):
// qui solo auth + serializzazione. Niente polling lato client: il drawer
// chiama questa route al mount e alle aperture.
export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  const [messages, unread] = await Promise.all([
    getMessagesHistory(100),
    getPendingMessagesCount(),
  ]);
  // `server_now` viaggia con i messaggi perché lo stato di consegna si
  // misura fra timestamp scritti dal server: senza, il browser userebbe il
  // proprio orologio e uno skew di pochi minuti basta a marcare «non
  // consegnato» un turno appena spedito (o a nascondere uno fermo da ore).
  // Nel corpo e non solo nell'header `Date`: qui il valore non può essere
  // quello di una risposta rimasta in una cache intermedia.
  return NextResponse.json({
    messages,
    unread,
    server_now: new Date().toISOString(),
  });
}

/**
 * [JHT-CHAT-UNIFY] L'utente scrive un messaggio a un agente.
 *
 * Prima di questa route la chat web sapeva solo *rispondere*: il testo
 * finiva in `pending_user_messages.user_reply`, appeso a un messaggio
 * dell'agente ancora senza risposta. Finiti quelli — cioè quasi sempre —
 * il composer si spegneva ("Nessun messaggio in attesa di risposta") e non
 * c'era modo di iniziare una conversazione. Ora ogni turno è una riga.
 *
 * È l'unica eccezione al web read-only ([JHT-WEB-READONLY]), quella già
 * prevista per la chat: si resta dentro `pending_user_messages`, con la
 * policy di INSERT più stretta possibile (righe proprie, `author='user'`,
 * `legacy_id` negativo — vedi mig 060).
 *
 * Dopo l'INSERT si timbra `team_state.chat_requested_at`: è il campanello
 * che il daemon sul box legge nel suo giro veloce (~5s) — la stessa riga
 * che legge già per "Sync now" — per andare a prendersi il messaggio e
 * consegnarlo al pane tmux dell'agente. Da lì in poi l'agente lo vede come
 * vede quelli scritti dal videogioco: stessa busta, stessa skill.
 */
export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  let body: { agent?: unknown; message?: unknown };
  try {
    body = await req.json();
  } catch {
    return invalidJsonBody();
  }

  const agent =
    typeof body.agent === "string" ? body.agent.trim().toLowerCase() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";

  if (!isChatAgent(agent)) {
    return NextResponse.json(
      { error: `agente non valido (ammessi: ${CHAT_AGENTS.join(", ")})` },
      { status: 400 },
    );
  }
  if (!message) {
    return NextResponse.json({ error: "messaggio vuoto" }, { status: 400 });
  }
  if (message.length > MAX_CHAT_BODY) {
    return NextResponse.json(
      { error: `messaggio troppo lungo (max ${MAX_CHAT_BODY} caratteri)` },
      { status: 400 },
    );
  }

  // Local mode: si scrive sulla stessa SQLite che legge il container. Stesso
  // gate di ws() in lib/queries.ts (host locale + DB presente).
  if ((await isLocalRequest()) && workspaceHasDb()) {
    const ws = await getWorkspacePath();
    if (!ws) {
      return NextResponse.json(
        { error: "workspace non trovato" },
        { status: 500 },
      );
    }
    try {
      const id = sendUserChatLocal(ws, agent, message);
      return NextResponse.json({ ok: true, id });
    } catch (e) {
      return NextResponse.json(
        { error: `invio fallito: ${(e as Error).message}` },
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

  // `legacy_id` è NOT NULL e UNIQUE per utente, ma un turno nato qui non ha
  // un id nella SQLite del box. Convenzione mig 060: `-epoch_ms`. Lo spazio
  // negativo è irraggiungibile da SQLite (AUTOINCREMENT parte da 1), quindi
  // il full-push del box non può collidere né sovrascrivere. Il box ricava
  // da questo valore anche il `ts` del turno in chat.jsonl — deterministico
  // fra i tentativi di consegna.
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("pending_user_messages")
    .insert({
      user_id: user.id,
      legacy_id: -Date.now(),
      agent,
      body: message,
      kind: "notification",
      author: "user",
      delivered_via: "web",
      // Un turno scritto dall'utente è per definizione già letto da lui: se
      // restasse non-ack finirebbe nel contatore dei non letti.
      acknowledged_at: now,
      created_at: now,
    })
    .select(
      "id, agent, body, kind, related_position_id, delivered_via, " +
        "delivered_at, acknowledged_at, user_reply, user_reply_at, " +
        "agent_seen_reply_at, created_at",
    )
    .single();

  if (error) {
    return sanitizedError(error, { status: 500, scope: "pending-messages" });
  }

  // Il campanello per il box. Best-effort DICHIARATO: se fallisce il
  // messaggio è comunque salvato e il paracadute del daemon lo raccoglie al
  // giro lento — meglio consegnato tardi che perso, e l'utente vede
  // comunque la sua bolla.
  const { error: bellError } = await supabase
    .from("team_state")
    .upsert(
      { user_id: user.id, chat_requested_at: now },
      { onConflict: "user_id" },
    );

  return NextResponse.json({
    ok: true,
    message: { ...data, author: "user" },
    signalled: !bellError,
  });
}
