/**
 * Gli store JSON che nessuno scrive più.
 *
 * `tasks.json`, `analytics.json` e `sessions.json` li produceva la TUI,
 * rimossa il 2026-07-25. Da allora in tutta la repo esistono solo lettori:
 * sette comandi CLI continuavano ad aprirli, non trovarli, e stampare zeri —
 * output indistinguibile da un team che non ha fatto niente. Finché la fonte
 * non torna (ricablando quei comandi su `jobs.db`, che è il lavoro vero e
 * merita il suo passaggio), il minimo onesto è dirlo.
 *
 * Qui sta quella frase, scritta una volta sola, così che i comandi coinvolti
 * la raccontino allo stesso modo. Quando gli store avranno di nuovo uno
 * scrittore, o quando spariranno, questo modulo se ne va con loro.
 *
 * Riferimento: [CLI-PHANTOM-DATA-COMMANDS].
 */

export const RETIRED_SINCE = '25/07/2026';

const FILES = {
  tasks:     'tasks.json',
  analytics: 'analytics.json',
  sessions:  'sessions.json',
};

export function isRetiredStore(store) {
  return Object.hasOwn(FILES, store);
}

export function retiredStoreFile(store) {
  return FILES[store] ?? store;
}

/**
 * Riga singola, per gli elenchi a una voce per riga (health, backup).
 */
export function retiredStoreDetail(store) {
  return `${retiredStoreFile(store)} — nessun componente lo scrive più dal ${RETIRED_SINCE}`;
}

/**
 * Blocco esteso, per i comandi che senza lo store non hanno niente da dire.
 * Spiega cosa manca e dove il dato vivo si trova ancora; non chiede
 * all'utente di rimediare, perché non c'è niente che possa fare.
 */
export function retiredStoreNotice(stores, indent = '  ') {
  const plural = stores.length > 1;
  const files = stores.map(retiredStoreFile).join(', ');
  return [
    `${indent}Fonte dati assente — ${files}`,
    '',
    `${indent}${plural ? 'Questi file non vengono' : 'Questo file non viene'} più ${plural ? 'scritti' : 'scritto'} da nessuno: ${plural ? 'li' : 'lo'} produceva la`,
    `${indent}vecchia interfaccia testuale, rimossa il ${RETIRED_SINCE}. Non è un`,
    `${indent}elenco vuoto né un totale a zero: è una fonte che non esiste più,`,
    `${indent}e non c'è niente da sistemare per farla tornare.`,
    '',
    `${indent}Il lavoro reale del team resta visibile in positions, agents e status,`,
    `${indent}che leggono il database vivo.`,
  ].join('\n');
}
