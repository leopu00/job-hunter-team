/**
 * Colori CLI — sorgente unica, machine-safe. [CLI-OUTPUT-NOT-MACHINE-SAFE]
 *
 * Il CLI e' una superficie documentata per agenti LLM e script
 * (docs/guides/AI-AGENT-INTEGRATION.md): quando l'output non finisce su un
 * terminale non deve contenere byte di controllo. Prima di questo modulo 20
 * comandi stampavano sequenze ANSI hardcoded e nessuno guardava `NO_COLOR` o
 * `isTTY`, quindi `jht secrets list | cat -v` consegnava `^[[1m...^[[0m` e
 * `jht report > file.md` produceva markdown sporco.
 *
 * Qui la decisione e' presa una volta sola, da picocolors (che gia' rispetta
 * `NO_COLOR`, `FORCE_COLOR` e `--no-color`) piu' un vincolo esplicito sul TTY
 * di stdout. Il vincolo aggiuntivo serve perche' picocolors abilita il colore
 * anche fuori dal terminale su Windows e in CI: per un consumatore che fa
 * pipe sono esattamente i due casi che vogliamo silenziare.
 *
 * Non esistono letterali ANSI in questo file: le costanti sono ESTRATTE dalle
 * funzioni di picocolors, cosi' i byte emessi restano identici a prima quando
 * il colore e' attivo e diventano stringhe VUOTE quando non lo e'.
 */
import pc from 'picocolors';

/** `--color` / `FORCE_COLOR` bypassano il vincolo TTY (utile in CI volontaria). */
const forced = Boolean(process.env.FORCE_COLOR) || process.argv.includes('--color');

/** Vero solo se picocolors approva E l'output e' davvero un terminale. */
export const colorEnabled = pc.isColorSupported && (forced || Boolean(process.stdout.isTTY));

/**
 * Oggetto colore con la stessa firma di picocolors: `c.green(s) -> string`.
 * Costruito con `createColors(colorEnabled)` per rispettare il vincolo TTY
 * anche quando picocolors da solo direbbe di si'.
 */
export const c = pc.createColors(colorEnabled);

/**
 * Marker per isolare la sequenza di apertura di una funzione picocolors: uno
 * spazio non puo' comparire dentro un escape SGR, quindi la prima occorrenza
 * segna sempre la fine del prefisso.
 */
const MARKER = ' ';

/**
 * Estrae la sequenza di apertura di una funzione picocolors. Con il colore
 * spento la funzione e' l'identita', il marker finisce in posizione 0 e il
 * risultato e' la stringa vuota.
 */
function openSeq(fn) {
  const marked = fn(MARKER);
  const i = marked.indexOf(MARKER);
  return i <= 0 ? '' : marked.slice(0, i);
}

// Costanti per i template literal gia' scritti (`${BOLD}testo${RESET}`).
// RESET e' il reset totale (`reset` di picocolors) e non la chiusura per
// singolo attributo: e' cio' che i comandi si aspettavano finora.
export const GREEN = openSeq(c.green);
export const RED = openSeq(c.red);
export const YELLOW = openSeq(c.yellow);
export const BLUE = openSeq(c.blue);
export const CYAN = openSeq(c.cyan);
export const MAGENTA = openSeq(c.magenta);
/** Grigio brillante (90) — il "dim" storico della maggior parte dei comandi. */
export const DIM = openSeq(c.gray);
export const BOLD = openSeq(c.bold);
export const RESET = openSeq(c.reset);

/**
 * Vero quando stdout e' un terminale interattivo. Da usare per gattare tutto
 * cio' che anima invece di informare (spinner, cursore nascosto): fuori dal
 * TTY quegli escape finiscono nel file o nella pipe del chiamante.
 */
export function isInteractive() {
  return Boolean(process.stdout.isTTY);
}
