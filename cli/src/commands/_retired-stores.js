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
  return `${retiredStoreFile(store)} — no component has written it since ${RETIRED_SINCE}`;
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
    `${indent}Data source unavailable — ${files}`,
    '',
    `${indent}${plural ? 'These files are' : 'This file is'} no longer written by any component.`,
    `${indent}${plural ? 'They belonged' : 'It belonged'} to the retired text interface (${RETIRED_SINCE}).`,
    `${indent}This is not an empty list or a zero total: the data source no longer exists,`,
    `${indent}and there is nothing to repair to restore it.`,
    '',
    `${indent}The team's live work remains visible in positions, agents, and status,`,
    `${indent}which read the live database.`,
  ].join('\n');
}
