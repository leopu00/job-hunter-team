/**
 * [JHT-CHAT-UNIFY] Le figure con cui si chatta dal web, in un posto solo.
 *
 * Scelta dell'utente: sul sito restano SOLO queste tre conversazioni; con
 * il resto del roster si parla dal videogioco, dove ogni agente ha il suo
 * pannello. La lista è la stessa che il box usa in `cli/src/lib/chat-sync.js`
 * (`CHAT_AGENTS`) — se ne aggiungi una qui, aggiungila anche lì, o il
 * messaggio verrà accettato dalla route e non consegnato a nessun pane.
 *
 * L'ordine è quello voluto in sidebar: Assistente, Mentor, Capitano.
 */
export const CHAT_AGENTS = ["assistente", "mentor", "capitano"] as const;

export type ChatAgent = (typeof CHAT_AGENTS)[number];

/** Limite del corpo di un messaggio utente (allineato al `maxLength` del composer). */
export const MAX_CHAT_BODY = 4000;

export function isChatAgent(value: string): value is ChatAgent {
  return (CHAT_AGENTS as readonly string[]).includes(value);
}
