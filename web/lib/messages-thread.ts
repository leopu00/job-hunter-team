/**
 * Logica condivisa fra le due viste dei messaggi del team: la pagina
 * `/messages` (`MessagesList`) e il cassetto in navbar (`MessagesDrawer`).
 *
 * Le due UI restano volutamente separate — una è una chat a tutta pagina,
 * l'altra un pannello compatto — ma parlano con le stesse due route
 * (`/api/pending-messages/{id}/reply` e `/ack`) e applicano gli stessi
 * aggiornamenti ottimisti. Quel pezzo viveva duplicato riga per riga in
 * entrambi i file: un fix a uno dei due lasciava l'altro indietro.
 *
 * Qui stanno solo dati e funzioni pure (più le due fetch): nessun hook e
 * nessuno stato, così ogni componente resta padrone del proprio.
 */
import type { PendingMessage } from "@/lib/types";

/**
 * Voci di dizionario usate identiche da entrambe le viste. Ogni componente
 * fa lo spread di queste nel proprio `T` e vi aggiunge le sue: le chiavi
 * restano risolte dallo stesso `tr()` di sempre.
 */
export const THREAD_T: Record<string, Record<string, string>> = {
  // [JHT-CHAT-UNIFY] Il composer non si spegne più: si scrive quando si
  // vuole, non solo "in risposta a". Il placeholder dice a chi si sta
  // scrivendo, che con tre conversazioni aperte è l'informazione utile.
  write_to: {
    it: "Scrivi a {name}…",
    en: "Message {name}…",
    hu: "Írj neki: {name}…",
    es: "Escribe a {name}…",
    de: "Schreib an {name}…",
    fr: "Écrivez à {name}…",
    pt: "Escreva para {name}…",
  },
  send: {
    it: "Invia",
    en: "Send",
    hu: "Küldés",
    es: "Enviar",
    de: "Senden",
    fr: "Envoyer",
    pt: "Enviar",
  },
  delivery_signal_failed: {
    it: "Il messaggio è salvato, ma il team non è stato avvisato. Controlla che sia online e riprova.",
    en: "The message is saved, but the team could not be notified. Check that it is online and try again.",
    hu: "Az üzenet mentve van, de a csapat nem kapott értesítést. Ellenőrizd, hogy online van-e, majd próbáld újra.",
    es: "El mensaje está guardado, pero no se pudo avisar al equipo. Comprueba que esté conectado e inténtalo de nuevo.",
    de: "Die Nachricht ist gespeichert, aber das Team konnte nicht benachrichtigt werden. Prüfe, ob es online ist, und versuche es erneut.",
    fr: "Le message est enregistré, mais l'équipe n'a pas pu être prévenue. Vérifiez qu'elle est en ligne et réessayez.",
    pt: "A mensagem foi salva, mas a equipe não pôde ser avisada. Verifique se ela está online e tente novamente.",
  },
  see_position: {
    it: "→ vedi posizione",
    en: "→ view position",
    hu: "→ állás megtekintése",
    es: "→ ver posición",
    de: "→ Stelle ansehen",
    fr: "→ voir le poste",
    pt: "→ ver vaga",
  },
  you: {
    it: "Tu",
    en: "You",
    hu: "Te",
    es: "Tú",
    de: "Du",
    fr: "Vous",
    pt: "Você",
  },
};

/**
 * Invia la risposta dell'utente a un messaggio. Rilancia con il messaggio
 * d'errore dell'API (o `HTTP <status>`) perché il chiamante lo mostri.
 */
export async function postReply(id: string, reply: string): Promise<void> {
  const res = await fetch(`/api/pending-messages/${id}/reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reply }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
}

/**
 * [JHT-CHAT-UNIFY] Manda un messaggio nuovo a un agente (non una risposta a
 * una riga esistente). Ritorna il turno creato dal server, che il chiamante
 * usa per rimpiazzare la bolla ottimistica.
 */
export type PostChatResult = {
  message: PendingMessage | null;
  signalled: boolean;
};

export async function postChat(
  agent: string,
  message: string,
): Promise<PostChatResult> {
  const res = await fetch("/api/pending-messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent, message }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: PendingMessage;
    signalled?: boolean;
  };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return {
    message: body.message ?? null,
    // Compatibilita' con server precedenti che non restituivano il campo:
    // solo un `false` esplicito apre il recupero del campanello.
    signalled: body.signalled !== false,
  };
}

/**
 * Ritenta soltanto il campanello dopo un INSERT chat gia' riuscito. Non
 * reinvia il messaggio e quindi non puo' duplicarlo. La route ritimbra il
 * valore lato server; il timestamp del browser resta un semplice trigger.
 */
export async function retryChatSignal(): Promise<boolean> {
  try {
    const res = await fetch("/api/team-state", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ chat_requested_at: new Date().toISOString() }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Turno dell'utente costruito localmente per mostrarlo SUBITO nel thread.
 * L'id `pending:` è provvisorio: viene sostituito dalla riga vera appena la
 * POST risponde (e riconosciuto per non duplicare l'evento Realtime).
 */
export function optimisticUserTurn(
  agent: string,
  body: string,
): PendingMessage {
  const now = new Date().toISOString();
  return {
    id: `pending:${now}:${Math.random().toString(36).slice(2, 8)}`,
    agent,
    body,
    kind: "notification",
    author: "user",
    related_position_id: null,
    delivered_via: "web",
    delivered_at: null,
    acknowledged_at: now,
    user_reply: null,
    user_reply_at: null,
    agent_seen_reply_at: null,
    created_at: now,
  };
}

/** Rimpiazza una bolla ottimistica con la riga confermata dal server. */
export function withConfirmedTurn(
  messages: PendingMessage[],
  tempId: string,
  confirmed: PendingMessage | null,
): PendingMessage[] {
  if (!confirmed) return messages;
  // Se l'evento Realtime è arrivato prima della risposta HTTP la riga vera
  // c'è già: si toglie solo la provvisoria, senza inserirla due volte.
  const already = messages.some((m) => m.id === confirmed.id);
  return messages
    .map((m) => (m.id === tempId && !already ? confirmed : m))
    .filter((m) => !(m.id === tempId && already));
}

/** Toglie una bolla ottimistica rimasta orfana (invio fallito). */
export function withoutTurn(
  messages: PendingMessage[],
  id: string,
): PendingMessage[] {
  return messages.filter((m) => m.id !== id);
}

/**
 * Applica la risposta appena inviata alla lista in memoria. Rispondere vale
 * anche come lettura, quindi valorizza `acknowledged_at` se era vuoto.
 */
export function withReply(
  messages: PendingMessage[],
  id: string,
  reply: string,
  now: string,
): PendingMessage[] {
  return messages.map((m) =>
    m.id === id
      ? {
          ...m,
          user_reply: reply,
          user_reply_at: now,
          acknowledged_at: m.acknowledged_at ?? now,
        }
      : m,
  );
}

/** Id dei messaggi non ancora letti di un agente. */
export function unreadIdsOf(
  messages: PendingMessage[],
  agent: string,
): string[] {
  return messages
    .filter((m) => m.agent === agent && !m.acknowledged_at)
    .map((m) => m.id);
}

/** Marca come letti, in memoria, tutti i non letti di un agente. */
export function withAgentAcked(
  messages: PendingMessage[],
  agent: string,
  now: string,
): PendingMessage[] {
  return messages.map((m) =>
    m.agent === agent && !m.acknowledged_at
      ? { ...m, acknowledged_at: now }
      : m,
  );
}

/**
 * Conferma la lettura lato server. Fire-and-forget di proposito: la UI ha
 * già aggiornato in ottimista e il prossimo refresh riallinea comunque, non
 * vale la pena bloccare l'apertura di una chat su una POST.
 */
export function postAcks(ids: string[]): void {
  for (const id of ids) {
    void fetch(`/api/pending-messages/${id}/ack`, { method: "POST" }).catch(
      () => {},
    );
  }
}
