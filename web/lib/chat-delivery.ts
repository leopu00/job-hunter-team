/**
 * Stato REALE del turno che l'utente ha scritto in chat.
 *
 * Fino a qui la bolla dell'utente compariva e restava lì, identica per
 * sempre: "inviato" e basta. Il 24/07 tre messaggi scritti dal sito sono
 * rimasti sei ore senza arrivare all'agente, e la chat non aveva modo di
 * dirlo — una bolla ferma non si distingue da un agente che sta pensando,
 * quindi l'utente ha aspettato una risposta che non poteva arrivare.
 *
 * Il dato per distinguere *inviato* da *consegnato* esiste già in due
 * posti, e servono entrambi:
 *
 *   · `pending_user_messages.delivered_at` — sulla SINGOLA riga: il box lo
 *     timbra quando il turno è arrivato davvero nel pane tmux dell'agente.
 *     È il fatto puntuale, "questo messaggio ce l'ha in mano";
 *   · `team_state.chat_requested_at` vs `chat_delivered_at` — sulla CORSIA:
 *     il campanello che il sito suona a ogni invio contro la conferma che
 *     il box scrive quando ha ritirato tutto. Dice se qualcuno sta ancora
 *     rispondendo al campanello, che è l'informazione che mancava.
 *
 * Qui vive solo la logica, pura e senza React: la usano la chat a tutta
 * pagina e i suoi test.
 */
import type { PendingMessage } from "@/lib/types";

/**
 * Le quattro condizioni in cui può stare un turno dell'utente.
 *  · `sending`   — la POST è in volo (bolla ottimistica, id `pending:`);
 *  · `sent`      — la riga esiste sul cloud, il box non l'ha ancora ritirata;
 *  · `delivered` — `delivered_at` valorizzato: l'agente l'ha nel pane;
 *  · `stalled`   — non consegnata e l'attesa ha superato il ragionevole.
 */
export type ChatTurnDelivery = "sending" | "sent" | "delivered" | "stalled";

/** Il rendezvous della corsia, come lo legge il browser da `team_state`. */
export type ChatLane = {
  requestedAt: string | null;
  deliveredAt: string | null;
};

/**
 * Oltre questa attesa un turno non consegnato non è più "in viaggio".
 *
 * Il daemon guarda la corsia ogni ~5s e il suo paracadute ogni ~5min; un
 * agente su un turno lungo può tenere il pane occupato per qualche minuto,
 * ed è normale. Cinque minuti stanno sopra il caso lento legittimo e
 * enormemente sotto le sei ore dell'incidente.
 */
export const CHAT_DELIVERY_STALE_MS = 5 * 60_000;

/** Timestamp ISO (o SQLite `YYYY-MM-DD HH:MM:SS`, UTC) → epoch ms. */
function stampMs(value: string | null | undefined): number {
  if (!value) return NaN;
  const s = String(value);
  const iso =
    s.includes("T") || s.endsWith("Z") || /[+-]\d\d:\d\d$/.test(s)
      ? s
      : `${s.replace(" ", "T")}Z`;
  return new Date(iso).getTime();
}

/** La corsia ha un turno chiesto e non ancora confermato consegnato. */
export function chatLanePending(lane: ChatLane | null): boolean {
  if (!lane?.requestedAt) return false;
  const req = stampMs(lane.requestedAt);
  if (!Number.isFinite(req)) return false;
  const done = stampMs(lane.deliveredAt);
  // Mai confronto lessicografico fra timestamp: `+00:00` e `Z` ordinano
  // diversamente da come si datano (stessa trappola del cursore congelato
  // del 15/07). Stessa regola di `chatPending` nel box.
  if (!Number.isFinite(done)) return true;
  return req > done;
}

/**
 * Il box non risponde al campanello da troppo tempo: non è UN messaggio
 * rimasto indietro, è la corsia che non ritira più niente.
 */
export function chatLaneStalled(
  lane: ChatLane | null,
  now: number = Date.now(),
  staleMs: number = CHAT_DELIVERY_STALE_MS,
): boolean {
  if (!chatLanePending(lane)) return false;
  const req = stampMs(lane?.requestedAt);
  return Number.isFinite(req) && now - req >= staleMs;
}

/**
 * Stato di un singolo turno dell'utente.
 *
 * `lane` è opzionale perché non sempre c'è (local mode: nessuna
 * `team_state` da leggere) e quando manca si decide sulla sola età della
 * riga. Quando c'è, serve a NON accusare: se il box ha confermato di aver
 * ritirato tutto DOPO questo turno e la riga risulta ancora non
 * consegnata, la spiegazione più probabile è un evento Realtime perso, non
 * un guasto — e un allarme falso insegna a ignorare gli allarmi.
 */
export function chatTurnDelivery(
  m: PendingMessage,
  lane: ChatLane | null = null,
  now: number = Date.now(),
  staleMs: number = CHAT_DELIVERY_STALE_MS,
): ChatTurnDelivery {
  // I turni dell'agente sono per definizione in mano all'utente: li sta
  // leggendo. La funzione resta totale per non obbligare ogni chiamante a
  // un `if` prima.
  if (m.author !== "user") return "delivered";
  // L'id provvisorio della bolla ottimistica (`optimisticUserTurn`): la
  // riga vera non esiste ancora, la POST è in volo.
  if (m.id.startsWith("pending:")) return "sending";
  if (m.delivered_at) return "delivered";

  const created = stampMs(m.created_at);
  if (!Number.isFinite(created)) return "sent";
  if (lane && !chatLanePending(lane)) return "sent";
  // L'attesa non si conta dalla nascita del turno ma dall'ultimo campanello
  // suonato dopo di essa. Il box ritira TUTTI i turni pendenti in un colpo
  // solo, quindi una richiesta di ritiro fresca — il retry esplicito, o
  // semplicemente il messaggio successivo — rimette in viaggio anche i turni
  // vecchi. Senza questo, premere "riprova" non cambierebbe nulla a schermo
  // e l'utente concluderebbe che il pulsante è finto.
  const rung = stampMs(lane?.requestedAt);
  const waitingSince = Number.isFinite(rung) && rung > created ? rung : created;
  if (now - waitingSince < staleMs) return "sent";
  return "stalled";
}

/** C'è almeno un turno dell'utente che non è arrivato all'agente. */
export function hasStalledTurn(
  messages: PendingMessage[],
  lane: ChatLane | null = null,
  now: number = Date.now(),
  staleMs: number = CHAT_DELIVERY_STALE_MS,
): boolean {
  return messages.some(
    (m) => chatTurnDelivery(m, lane, now, staleMs) === "stalled",
  );
}
