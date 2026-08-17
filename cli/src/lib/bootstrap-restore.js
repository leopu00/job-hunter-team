// [JHT-CLOUD-RESTORE] T-029 — il lato PULL del bootstrap di account.
//
// Simmetrico a `bootstrap-push.js`, che copre "box pieno, cloud vuoto":
// qui il caso è "box vuoto, cloud pieno" — un container nuovo che fa
// `jht cloud login` su un account che ha già una storia. Oggi quel
// ripristino esiste (`handleRestore`) ma va invocato a mano, e chi non lo
// sa resta con un box vuoto che riparte da zero.
//
// Come il fratello push, questo modulo DECIDE SOLTANTO: il restore vero è
// `handleRestore`, con la sua transazione, il suo prompt disattivabile e la
// guardia anti-DELETE di T-027. Nessun secondo percorso di ripristino.
//
// La regola è una sola e non si negozia: MAI sovrascrivere lavoro locale.
// Il restore automatico parte solo se il DB esiste ed è VUOTO (zero
// positions). DB mancante → niente restore (lo schema non c'è ancora, e
// `handleRestore` stesso lo esige). DB illeggibile → niente restore: non
// si decide su un dubbio. Idempotente per costruzione: dopo un restore
// riuscito il DB non è più vuoto, quindi il login successivo torna sul
// percorso di push — e a restore avvenuto il push viene saltato, perché un
// DB appena tirato giù non ha nulla di nuovo da dire al cloud (il cursore
// di sync è già stato resettato a "now" dal restore stesso).

/**
 * Posizioni nel DB locale, o `null` se non si può sapere (tabella mancante,
 * lock, corruzione). Apertura read-only: decidere non è scrivere.
 *
 * @param {Function} DatabaseSync classe `node:sqlite` (iniettata: il modulo
 *   resta importabile e testabile senza filesystem)
 */
export function readLocalPositionsCount(DatabaseSync, dbPath) {
  let db = null;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const row = db.prepare('SELECT COUNT(*) AS n FROM positions').get();
    return Number(row?.n ?? 0);
  } catch {
    return null;
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

/**
 * La decisione, pura. Nessun IO: tutto arriva dai parametri.
 *
 * @param {object} o
 * @param {boolean} o.dbPresent       il file jobs.db esiste
 * @param {number|null} o.localPositions  righe in positions (`null` = illeggibile)
 * @param {boolean} [o.cloudEnabled]  sync cloud configurata (default true)
 * @returns {{restore: boolean, reason: string}}
 */
export function decideBootstrapRestore({ dbPresent, localPositions, cloudEnabled = true }) {
  const no = (reason) => ({ restore: false, reason });
  if (!cloudEnabled) return no('cloud-disabilitato');
  if (!dbPresent) return no('db-assente');
  if (localPositions === null || localPositions === undefined) return no('db-illeggibile');
  if (localPositions > 0) return no('db-non-vuoto');
  return { restore: true, reason: 'db-vuoto' };
}
