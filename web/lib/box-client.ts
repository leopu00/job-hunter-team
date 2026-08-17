/**
 * Che cosa sa fare il box dell'utente, secondo il box stesso.
 *
 * Ogni chiamata cloud-sync porta un header `X-JHT-Client` che finisce nelle
 * colonne `client_*` di `cloud_sync_tokens` ([CLIENT-VERSION-INVISIBLE]).
 * Da lì il web può finalmente rispondere a una domanda che prima non aveva
 * modo di porre: *questa build sa ricevere la chat?*
 *
 * Serve perché la corsia user→agente è arrivata solo nella 0.3.2: su un box
 * pairato prima, il web accetta il testo, lo salva, e nessuno lo ritira mai
 * — mentre agente→utente continua a funzionare, così l'account sembra sano
 * in ogni aggregato. Meglio non far scrivere e dirlo, che incassare parole
 * destinate a nessuno.
 *
 * ── Il gate fallisce APERTO, e non è un dettaglio ──────────────────────
 * Si blocca **solo** davanti a una smentita esplicita: il box ha parlato e
 * fra le sue capability quella non c'è. Silenzio, token mai visto, colonne
 * vuote, progetto non ancora migrato → si lascia scrivere. Un composer
 * bloccato per errore è un danno certo a chi non ha alcun problema; un
 * turno che parte verso un box muto ha comunque la sua rete, il timeout
 * visibile della corsia (`chat-delivery.ts`). Le due protezioni sono
 * pensate per lavorare insieme, non l'una al posto dell'altra.
 */

export interface BoxClientRow {
  id: string;
  client_version: string | null;
  client_platform: string | null;
  client_capabilities: string[] | null;
  client_seen_at: string | null;
}

export type CapabilitySupport = "yes" | "no" | "unknown";

/** La capability che serve alla chat: la dichiara `cli/src/lib/client-identity.js`. */
export const CHAT_CAPABILITY = "chat";

/**
 * Quale device rappresenta "il box" per questo utente.
 *
 * `team_state.active_device_id` è la risposta esatta quando c'è: è lo stesso
 * id con cui il single-team enforcement decide chi può scrivere lo stato
 * osservato. Quando manca (account mai passato dal claim) si ripiega
 * sull'ultimo device che si è fatto vivo — non sul più recente creato: un
 * token generato e mai usato non è il box che sta lavorando.
 */
export function pickActiveBox(
  tokens: BoxClientRow[],
  activeDeviceId: string | null,
): BoxClientRow | null {
  if (activeDeviceId) {
    const exact = tokens.find((t) => t.id === activeDeviceId);
    if (exact) return exact;
  }
  const seen = tokens
    .filter((t) => t.client_seen_at)
    .sort((a, b) =>
      String(b.client_seen_at).localeCompare(String(a.client_seen_at)),
    );
  return seen[0] ?? null;
}

/**
 * Tre risposte, non due. `unknown` non è un `no` prudente: è l'unica
 * risposta onesta per un box che non ha ancora dichiarato nulla, e tenerla
 * separata è ciò che impedisce al gate di chiudersi sul silenzio.
 */
export function boxSupports(
  box: BoxClientRow | null,
  capability: string,
): CapabilitySupport {
  if (!box) return "unknown";
  const declared = box.client_capabilities;
  // Un array vuoto è una dichiarazione: il parser scarta le capability
  // malformate ma conserva la lista. Null/undefined invece è assenza.
  if (!declared) return "unknown";
  return declared.includes(capability) ? "yes" : "no";
}

/** Il composer si spegne solo davanti a una smentita esplicita. */
export function chatComposerBlocked(box: BoxClientRow | null): boolean {
  return boxSupports(box, CHAT_CAPABILITY) === "no";
}
