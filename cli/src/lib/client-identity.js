/**
 * Identità tecnica del box, dichiarata a ogni chiamata cloud-sync.
 *
 * Prima di questo header nessun client diceva quale build fosse: l'unico
 * user-agent che arrivava a Supabase era quello dell'infrastruttura, e
 * ricostruire cosa girasse su una macchina attiva voleva dire incrociare la
 * data di pairing con `git tag` — arrivando a «probabilmente», mai a un fatto.
 *
 * Confine dello scope, non negoziabile: build, famiglia di sistema operativo,
 * feature flag. Niente contenuti, niente profilo, niente IP, niente hostname.
 * Quello che sta qui dentro l'utente lo rilegge con `jht cloud status`: è la
 * sola telemetria che ci permettiamo, ed è quella che accetteremmo su di noi.
 */

import pkg from '../../package.json' with { type: 'json' };

/**
 * Cosa questo build sa servire. Non è la lista dei desideri: ogni voce
 * corrisponde a un lettore che esiste in questo sorgente, perché il web ci
 * gatea sopra la propria UI (un composer abilitato su una capability assente
 * è esattamente il turno di chat che sparisce senza errore).
 */
export const CLIENT_CAPABILITIES = Object.freeze([
  'chat', // chat-sync.js legge il rendezvous user→agente (dalla 0.3.2)
  'file-bridge', // file-bridge-poller.js
  'team-commands', // team-commands-poller.js
  'tickets', // handleTicketSync
  'directives', // handleDirectiveSync
]);

const PLATFORMS = { darwin: 'macos', win32: 'windows', linux: 'linux' };

/** Famiglia di sistema operativo, mai la stringa grezza di `process.platform`. */
export function normalizePlatform(platform) {
  return PLATFORMS[platform] ?? 'unknown';
}

/**
 * Serializza l'identità in una riga `k=v; k=v`. Formato in chiaro e non
 * codificato di proposito: chi legge un log deve poter capire cosa stiamo
 * mandando senza decodificare nulla.
 */
export function formatClientHeader({ version, platform, capabilities } = {}) {
  // Un campo senza valore si OMETTE, non si scrive `version=undefined`: quel
  // testo passerebbe per una versione plausibile — è fatto di caratteri
  // ammessi — e finirebbe in colonna, dove nessuno saprebbe più distinguere
  // «non dichiarata» da «dichiarata male».
  const parts = [];
  if (version) parts.push(`version=${version}`);
  if (platform) parts.push(`platform=${platform}`);
  if (capabilities?.length) parts.push(`capabilities=${capabilities.join(',')}`);
  return parts.join('; ');
}

/** Dichiarazione di questo processo. */
export function clientIdentity() {
  return {
    version: pkg.version,
    platform: normalizePlatform(process.platform),
    capabilities: [...CLIENT_CAPABILITIES],
  };
}

/** Valore pronto per l'header `X-JHT-Client`. */
export function clientHeaderValue() {
  return formatClientHeader(clientIdentity());
}

/**
 * Header di ogni chiamata alle route cloud-sync. Unico punto in cui il token
 * e l'identità si incontrano: aggiungere una corsia nuova senza passare di
 * qui significa fare sparire quel box dalle statistiche, quindi la firma va
 * messa qui e non nei singoli fetch.
 *
 * Non vale per le chiamate dirette a PostgREST né per gli upload su signed
 * URL: lì l'header non ha un lettore e sarebbe solo rumore.
 */
export function cloudSyncHeaders(token, extra = {}) {
  return {
    Authorization: `Bearer ${token}`,
    'X-JHT-Client': clientHeaderValue(),
    ...extra,
  };
}
