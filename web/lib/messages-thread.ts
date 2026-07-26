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
  reply_placeholder: {
    it: "Scrivi una risposta…",
    en: "Write a reply…",
    hu: "Írj választ…",
    es: "Escribe una respuesta…",
    de: "Antwort schreiben…",
    fr: "Écrivez une réponse…",
    pt: "Escreva uma resposta…",
  },
  no_reply_target: {
    it: "Nessun messaggio in attesa di risposta",
    en: "No message awaiting a reply",
    hu: "Nincs válaszra váró üzenet",
    es: "Ningún mensaje espera respuesta",
    de: "Keine Nachricht wartet auf Antwort",
    fr: "Aucun message en attente de réponse",
    pt: "Nenhuma mensagem aguardando resposta",
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
    m.agent === agent && !m.acknowledged_at ? { ...m, acknowledged_at: now } : m,
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
