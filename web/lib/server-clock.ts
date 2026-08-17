/**
 * L'ora del server, vista dal browser.
 *
 * Lo stato di consegna della chat confronta due grandezze che vengono da
 * orologi diversi: `created_at` e `chat_delivered_at` li scrive il SERVER,
 * mentre il «adesso» con cui li si misurava era `Date.now()` del BROWSER.
 * Finché i due coincidono non si nota; quando divergono il difetto è
 * asimmetrico e sgradevole in entrambi i versi.
 *
 *  · client **avanti** di dieci minuti → un turno spedito un secondo fa
 *    risulta vecchio di dieci minuti, quindi «non consegnato» subito, e il
 *    pulsante «richiama il box» sembra finto perché non cambia niente;
 *  · client **indietro** → un turno fermo da ore resta «inviato» per
 *    sempre, cioè il guasto che questo lavoro doveva rendere visibile torna
 *    invisibile proprio dove serviva.
 *
 * Un orologio sbagliato di parecchi minuti non è un caso di laboratorio: le
 * macchine virtuali che si risvegliano da uno snapshot, i portatili con la
 * batteria dell'orologio scarica e i sistemi senza NTP lo fanno di regola.
 *
 * Il rimedio è misurare lo scarto una volta e portarselo dietro: il server
 * dice che ore sono, il browser annota la differenza rispetto al proprio
 * orologio, e da lì in poi `serverNow()` restituisce il tempo del server
 * ricostruito. Nessuna chiamata in più: l'ora arriva appesa a risposte che
 * il browser chiede comunque.
 */

/**
 * Scarto fra l'orologio del server e quello locale, in millisecondi.
 *
 * `receivedAt` è il `Date.now()` del momento in cui la risposta è arrivata:
 * passarlo esplicitamente rende la funzione pura e collaudabile. Null
 * quando la data non è leggibile — e in quel caso chi chiama non deve
 * inventare uno scarto, ma continuare con l'orologio che ha.
 */
export function clockOffset(
  serverTime: string | null | undefined,
  receivedAt: number,
): number | null {
  if (!serverTime) return null;
  const server = new Date(serverTime).getTime();
  if (!Number.isFinite(server) || !Number.isFinite(receivedAt)) return null;
  return server - receivedAt;
}

// Lo scarto vive nel modulo, non in un componente: la stessa scheda ha due
// superfici della chat (pagina e drawer) e devono misurare il tempo allo
// stesso modo. Zero è il valore onesto finché nessuno ci ha detto che ore
// sono: significa «uso l'orologio che ho», cioè il comportamento di prima.
let offset = 0;

/**
 * Registra l'ora dichiarata dal server. Accetta sia una stringa ISO presa
 * dal corpo della risposta sia l'header `Date`; entrambe le forme arrivano
 * da risposte che il browser richiede comunque.
 *
 * Un valore illeggibile non azzera quello che sappiamo già: meglio uno
 * scarto vecchio di qualche minuto che tornare all'orologio locale, che è
 * proprio quello di cui non ci fidiamo.
 */
export function noteServerTime(
  serverTime: string | null | undefined,
  receivedAt: number = Date.now(),
): void {
  const next = clockOffset(serverTime, receivedAt);
  if (next !== null) offset = next;
}

/**
 * Come `noteServerTime`, ma legge l'header `Date` di una risposta HTTP.
 *
 * Difensiva di proposito: questa funzione sta sul percorso dell'invio di un
 * messaggio, e sapere che ore sono non vale il rischio di far fallire
 * l'invio. Una risposta senza header — un mock nei test, un polyfill, un
 * proxy che li spoglia — non è un errore da propagare: è solo un giro in
 * cui non impariamo nulla sull'orologio.
 */
export function noteServerTimeFromResponse(res: {
  headers?: { get?(name: string): string | null };
}): void {
  const date = res?.headers?.get?.("date");
  if (typeof date === "string") noteServerTime(date);
}

/** L'ora del server ricostruita, in millisecondi epoch. */
export function serverNow(): number {
  return Date.now() + offset;
}

/** Lo scarto corrente. Esposto per i test e per una diagnosi eventuale. */
export function currentClockOffset(): number {
  return offset;
}

/** Solo per i test: riporta lo scarto a zero fra un caso e l'altro. */
export function resetClockOffsetForTests(): void {
  offset = 0;
}
