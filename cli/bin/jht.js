#!/usr/bin/env node
/**
 * Entry point della CLI jht. [CLI-NO-GLOBAL-ERROR-HANDLER]
 *
 * Prima qui c'era `program.parseAsync(process.argv)` senza `await` e senza
 * `.catch()`, e in tutto `cli/` non esisteva un `unhandledRejection`: qualunque
 * throw da un action handler async usciva come stack trace Node. Anche gli
 * errori SCRITTI per essere utili — `jht-paths.js` spiega come sostituire un
 * path Windows con uno POSIX — arrivavano all'utente sepolti sotto sei righe
 * di `at ModuleJob.run`.
 *
 * Tre difese, in ordine di quanto sono specifiche:
 *   1. import dinamico di program.js dentro try/catch — le guardie che
 *      lanciano a livello di modulo (jht-paths.js) girano DURANTE l'import,
 *      quindi con un import statico non sarebbero catturabili da qui;
 *   2. `.catch()` su parseAsync — l'action handler ha rifiutato, il comando e'
 *      finito: e' l'errore davvero terminale;
 *   3. handler globali per cio' che sfugge alla catena del comando.
 *
 * NESSUNA delle tre chiama `process.exit()`. Si limitano a `process.exitCode`,
 * per due motivi: `exit` in mezzo a scritture async tronca l'I/O in volo, e i
 * comandi long-running (`cloud daemon`, i `*-listen`, `pid1`) contano sul
 * restare vivi — una rejection di un poller di background non deve ucciderli.
 * Per quei comandi l'errore viene segnalato e basta: il processo prosegue e
 * l'exit code resta quello che decide il comando stesso.
 *
 * Fuori scope, dichiarato: i 226 `process.exit` sparsi nei comandi NON sono
 * stati convertiti a `process.exitCode` + `return`. Qui c'e' solo l'ingresso.
 */

/** Argomenti senza opzioni: `['cloud', 'daemon']` per `jht cloud daemon -v`. */
const words = process.argv.slice(2).filter((a) => !a.startsWith('-'));

/**
 * Comandi che DEVONO sopravvivere a un errore non fatale. Sono processi
 * supervisionati che tengono aperti poller e socket: se un handler globale li
 * terminasse a ogni rejection, il rimedio sarebbe peggiore del difetto.
 */
const isLongRunning =
  words[0] === 'pid1' ||
  (words[0] === 'cloud' && (words[1] === 'daemon' || String(words[1] ?? '').endsWith('-listen')));

/** Il messaggio del prodotto, non la sua rappresentazione interna. */
function describe(err) {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === 'string') return err;
  try { return JSON.stringify(err); } catch { return String(err); }
}

/**
 * Stampa l'errore come lo stamperebbe un comando: una riga su stderr, senza
 * stack. Lo stack resta disponibile a chi lo sta cercando (`JHT_DEBUG=1`).
 */
function report(err, { fatal }) {
  const prefix = fatal ? 'Errore' : 'Errore non fatale';
  console.error(`\n  ${prefix}: ${describe(err)}\n`);
  if (process.env.JHT_DEBUG && err instanceof Error && err.stack) {
    console.error(err.stack);
  } else if (fatal) {
    console.error('  Dettagli completi: rilancia con JHT_DEBUG=1\n');
  }
}

// Una rejection che nessuno ha atteso. Per un comando normale e' terminale
// (segnala con exit code 1 e lascia drenare l'I/O); per un long-running e' un
// incidente da registrare, non un motivo per morire.
process.on('unhandledRejection', (reason) => {
  report(reason, { fatal: !isLongRunning });
  if (!isLongRunning) process.exitCode = 1;
});

// Un'eccezione sincrona sfuggita a tutti i try/catch. Installando l'handler
// sostituiamo il crash con stack trace di Node; non forziamo l'uscita, cosi'
// stdout/stderr finiscono di scrivere e i daemon restano in piedi.
process.on('uncaughtException', (err) => {
  report(err, { fatal: !isLongRunning });
  if (!isLongRunning) process.exitCode = 1;
});

try {
  const { buildProgram } = await import('../src/program.js');
  const program = buildProgram();
  await program.parseAsync(process.argv);
} catch (err) {
  report(err, { fatal: true });
  process.exitCode = 1;
}
