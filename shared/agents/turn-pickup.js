/**
 * O-101 — un turno consegnato a un agente che nessuno raccoglie.
 *
 * Il caso: l'utente scrive al Mentor alle 11:17:38Z, il messaggio arriva al
 * pane, ma il turno muore su «You've hit your session limit». Lui lo rimanda
 * identico alle 13:57:07Z e nemmeno quello viene raccolto, perché per il
 * sistema il primo risulta consegnato. Il Mentor resta fermo un'ora e tre
 * quarti e nessuno se ne accorge: `delivered_at` è timbrato dal poller quando
 * il testo parte verso il pane, cioè consegna e presa in carico sono trattate
 * come la stessa cosa.
 *
 * ⚠️ `acknowledged_at` NON dice che l'agente ha preso in carico, e costruirci
 * sopra l'allarme lo renderebbe muto o bugiardo. Verificato sul codice e sul
 * cloud, 2026-08-17:
 *  - un turno scritto dal sito nasce già con `acknowledged_at` valorizzato,
 *    perché per l'utente è per definizione già letto (`/api/pending-messages`
 *    lo scrive nell'INSERT): su quella corsia l'allarme non scatterebbe mai;
 *  - un turno arrivato da Telegram lo prende quando l'utente APRE la
 *    dashboard, non quando l'agente lavora (l'auto-ack della lista messaggi);
 *  - nel container non esiste una sola scrittura di quel campo.
 * Misurato: su 153 turni `author='user'`, i 107 nati dal sito hanno l'ack
 * istantaneo in 32 casi e mediana 4 giorni; i 46 da Telegram hanno ZERO ack
 * istantanei e mediana 1h17. È il comportamento dell'utente, non dell'agente.
 *
 * Quindi l'unico segnale di presa in carico che esiste oggi è indiretto: se
 * l'agente ha scritto qualcosa poco dopo, il turno l'ha visto. È un proxy, e
 * come tale ha un limite dichiarato — vedi `botRoleOf`.
 *
 * La funzione non tocca né rete né disco: le sorgenti si iniettano. È l'unica
 * versione che può girare in CI, dove una macchina non c'è.
 */

/** Un istante come numero, da stringa ISO o da epoch. */
function instant(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value === "") return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** Cinque minuti: sotto, un agente lento sarebbe scambiato per un agente morto. */
export const DEFAULT_GRACE_MS = 5 * 60 * 1000;

/**
 * Verdetto per ogni turno consegnato.
 *
 * @param {object} input
 * @param {Array<{legacyId: number|string, agent: string, deliveredAt: string|number|Date}>} input.turns
 *   I turni `author='user'` che risultano consegnati.
 * @param {Array<{ts: string|number|Date, from: string, ok?: boolean}>} input.sends
 *   Le righe di `logs/telegram-sent.jsonl`: solo metadati, nessun contenuto.
 * @param {string|number|Date} input.now
 * @param {(agent: string) => {role: string, exclusive: boolean}} input.botRoleOf
 *   Da quale bot esce un agente, e se quel bot è suo soltanto. NON ha un
 *   default di proposito: chi chiama deve passare la mappa vera. Un agente
 *   senza bot proprio parla da quello dell'Assistente (vedi
 *   `agents/_tools/jht-notify-user`), quindi un invio dell'Assistente non
 *   prova che sia stato LUI a lavorare: quei turni restano indecidibili
 *   invece di produrre un allarme che non sappiamo leggere.
 * @param {number} [input.graceMs]
 * @returns {Array<{legacyId: any, agent: string, verdict: 'picked_up'|'stalled'|'undecidable'|'too_early', reason: string}>}
 */
export function turnPickupVerdicts({
  turns,
  sends,
  now,
  botRoleOf,
  graceMs = DEFAULT_GRACE_MS,
}) {
  if (typeof botRoleOf !== "function") {
    throw new TypeError("turnPickupVerdicts richiede botRoleOf");
  }
  const nowMs = instant(now);
  if (nowMs === null) throw new TypeError("turnPickupVerdicts richiede now");

  const inviati = (Array.isArray(sends) ? sends : [])
    .filter((send) => send && send.ok !== false)
    .map((send) => ({ ts: instant(send.ts), from: String(send.from ?? "") }))
    .filter((send) => send.ts !== null);

  return (Array.isArray(turns) ? turns : []).map((turn) => {
    const agent = String(turn?.agent ?? "");
    const delivered = instant(turn?.deliveredAt);
    const base = { legacyId: turn?.legacyId, agent };
    if (delivered === null) {
      return { ...base, verdict: "undecidable", reason: "no_delivered_at" };
    }
    // Prima della finestra non c'è niente da dire: un agente che sta ancora
    // pensando non è un agente fermo, ed è metà dei falsi allarmi.
    if (nowMs - delivered <= graceMs) {
      return { ...base, verdict: "too_early", reason: "within_grace" };
    }
    const bot = botRoleOf(agent);
    if (!bot || typeof bot.role !== "string") {
      return { ...base, verdict: "undecidable", reason: "unknown_agent" };
    }
    if (bot.exclusive !== true) {
      // L'invio esce dal bot dell'Assistente anche per Scout, Analista e
      // Scorer: vederlo non dice CHI ha lavorato. Meglio un allarme mancato
      // che un allarme che accusa il collega sbagliato.
      return { ...base, verdict: "undecidable", reason: "shared_bot" };
    }
    const attivo = inviati.some(
      (send) =>
        send.from === bot.role &&
        send.ts > delivered &&
        send.ts <= delivered + graceMs,
    );
    return attivo
      ? { ...base, verdict: "picked_up", reason: "agent_sent_after_delivery" }
      : {
          ...base,
          verdict: "stalled",
          reason: "no_agent_activity_after_delivery",
        };
  });
}

/** I soli turni su cui vale la pena svegliare qualcuno. */
export function stalledTurns(input) {
  return turnPickupVerdicts(input).filter((turn) => turn.verdict === "stalled");
}
