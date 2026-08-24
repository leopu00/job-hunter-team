/**
 * Il freno settimanale, in un posto solo.
 *
 * `.weekly-halt.flag` esiste per fermare la spesa quando l'utente ha ordinato
 * stop team: ogni corsia che parte a freno tirato costa ~1 MB di upload, una
 * invocation Vercel e CPU Postgres (postmortem 2026-05-21 e 2026-05-22).
 *
 * Perché un modulo e non quattro `if` copiati: il loop event-driven ha quattro
 * corsie (sync, chat, ticket, emergency-stop) più un `setInterval`, e chi ne
 * aggiunge una quinta fra un mese non si ricorda di un controllo che sta in
 * altri quattro punti. Con un cancello solo, la quinta corsia lo eredita
 * invece di dimenticarlo — stessa lezione di [PACING-DAILY-HALT-STANDBY-LEAK].
 *
 * E il freno DICE di essere inserito: il sintomo del difetto era un silenzio —
 * la riga di conferma esisteva solo nel loop a poll, così su un box in
 * Realtime l'assenza di log si leggeva come «daemon tranquillo» invece che
 * «freno non inserito». L'annuncio è limitato in frequenza perché la corsia
 * chat batte ogni ~5 s e riempirebbe il log.
 *
 * ⚠️ Il ramo a POLL (`handleDaemon`, `cloud.js`) ha ancora il suo controllo
 * inline, più vecchio di questo modulo: là il freno ha sempre funzionato e
 * riscriverlo senza poterlo provare su un box vivo costerebbe più di quanto
 * renda. Restano due implementazioni dello stesso predicato, e questa nota
 * esiste perché la divergenza si veda invece di scoprirla al prossimo cambio.
 */

/**
 * @param {object} opts
 * @param {() => boolean} opts.isHalted  legge lo stato del freno (di norma `existsSync`)
 * @param {(tag: string) => void} [opts.onHalt]    annuncio «freno inserito»
 * @param {() => void} [opts.onResume]             annuncio «freno rilasciato»
 * @param {number} [opts.announceEveryMs]          ogni quanto ripetere l'annuncio
 * @param {() => number} [opts.now]                iniettabile per i test
 * @returns {(tag?: string) => boolean} true = fermo, non fare partire niente
 */
export function createHaltGate({
  isHalted,
  onHalt = () => {},
  onResume = () => {},
  announceEveryMs = 60_000,
  now = () => Date.now(),
}) {
  let announcedAt = null;

  return function halted(tag = '') {
    let stopped;
    try {
      stopped = Boolean(isHalted());
    } catch {
      // Non sapere se il freno è tirato non autorizza a spendere: di fronte
      // al dubbio ci si ferma, che è il verso prudente per un freno.
      stopped = true;
    }

    if (!stopped) {
      if (announcedAt !== null) {
        announcedAt = null;
        onResume();
      }
      return false;
    }

    const ts = now();
    if (announcedAt === null || ts - announcedAt >= announceEveryMs) {
      announcedAt = ts;
      onHalt(tag);
    }
    return true;
  };
}

/**
 * Avvolge una corsia asincrona con il freno E il suo debounce.
 *
 * Le quattro corsie del loop event-driven ripetevano lo stesso guscio
 * (`if (busy) return; busy = true; try … finally busy = false`). Farne una
 * funzione sola è ciò che rende il freno ereditabile: una corsia nuova nasce
 * frenata perché nasce da qui.
 *
 * @param {(tag?: string) => boolean} gate
 * @param {string} label  nome della corsia, per l'annuncio
 * @param {(...args: any[]) => Promise<void>} body
 * @param {(error: Error) => void} [onError]
 */
export function guardedLane(gate, label, body, onError = () => {}) {
  let busy = false;
  return async (...args) => {
    if (busy) return false;
    // Il primo argomento delle corsie è per convenzione il `tag` che dice da
    // dove arriva la sveglia (realtime, parachute, local): tenerlo
    // nell'annuncio distingue «il freno ha fermato un evento» da «ha fermato
    // il paracadute», che sono due sintomi diversi da leggere in un log.
    const tag = typeof args[0] === 'string' && args[0] ? `${label}/${args[0]}` : label;
    if (gate(tag)) return false;
    busy = true;
    try {
      await body(...args);
      return true;
    } catch (error) {
      onError(error);
      return false;
    } finally {
      busy = false;
    }
  };
}

/**
 * Variante per eventi che non possono essere persi. Se arriva una sveglia
 * mentre il body lavora, conserva gli argomenti più recenti e fa esattamente
 * un altro giro appena il precedente termina. Una raffica viene coalesciata,
 * non accodata senza limite e non scartata.
 */
export function coalescingGuardedLane(gate, label, body, onError = () => {}) {
  let busy = false;
  let queued = null;

  return async (...args) => {
    if (busy) {
      queued = args;
      return false;
    }
    busy = true;
    let current = args;
    let ran = false;
    try {
      while (current) {
        const tag = typeof current[0] === 'string' && current[0]
          ? `${label}/${current[0]}`
          : label;
        if (gate(tag)) {
          queued = null;
          break;
        }
        try {
          await body(...current);
          ran = true;
        } catch (error) {
          onError(error);
        }
        current = queued;
        queued = null;
      }
      return ran;
    } finally {
      busy = false;
    }
  };
}
