/**
 * Confronto fra la versione installata e l'ultima pubblicata.
 *
 * Vive in `shared/` perché la stessa domanda se la pongono due programmi
 * diversi — `jht status` sul box e il banner del sito — e due risposte che
 * divergono sarebbero peggio di nessuna risposta: l'utente vedrebbe il sito
 * dire «aggiorna» e il terminale dire che è tutto a posto. JS puro con
 * JSDoc, così lo importano sia il CLI (ESM) sia il web (`allowJs`).
 *
 * Terza copia della logica, ed è voluto saperlo: il gioco ha la sua in
 * GDScript (`game/scripts/support/update_check.gd`) perché non può
 * importare JavaScript. Se le regole qui cambiano, quella va guardata.
 */

/** Massima lunghezza di un tag credibile: oltre, è rumore da rete. */
const MAX_TAG_LENGTH = 32;

/**
 * `v0.3.5` → `[0, 3, 5]`. Null quando non è una versione: una stringa che
 * non sappiamo confrontare non deve poter innescare un avviso.
 *
 * @param {string | null | undefined} raw
 * @returns {number[] | null}
 */
export function parseVersion(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_TAG_LENGTH) return null;
  const cleaned = raw.trim().replace(/^[vV]/, '');
  // Solo `X.Y.Z` con tre numeri: i suffissi di prerelease (`-rc.1`) sono
  // scartati di proposito, perché non è roba che proponiamo a un utente.
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(cleaned);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * -1 / 0 / 1, con 0 anche quando una delle due non è leggibile: nel dubbio
 * le versioni sono «pari», che è l'unico esito che non fa succedere nulla.
 *
 * @param {string | null | undefined} a
 * @param {string | null | undefined} b
 * @returns {number}
 */
export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

/**
 * La sola domanda che conta. Un tag più VECCHIO di quello installato non
 * deve muovere niente: una release ritirata non è un invito a retrocedere.
 *
 * @param {string | null | undefined} latest
 * @param {string | null | undefined} current
 * @returns {boolean}
 */
export function updateAvailable(latest, current) {
  return compareVersions(latest, current) > 0;
}

/**
 * Il pezzo di risposta GitHub che ci serve, o null se inutilizzabile.
 *
 * Bozze e prerelease non passano: `releases/latest` non dovrebbe
 * restituirle, ma la regola sta qui e non nella fiducia. La pagina si
 * accetta solo se è sul repo giusto — è un URL che arriva dalla rete e
 * finisce in un link su cui l'utente clicca.
 *
 * @param {unknown} payload
 * @param {string} repo
 * @returns {{ version: string, page: string } | null}
 */
export function latestReleaseInfo(payload, repo) {
  if (!payload || typeof payload !== 'object') return null;
  const data = /** @type {Record<string, unknown>} */ (payload);
  if (data.draft === true || data.prerelease === true) return null;
  const parsed = parseVersion(/** @type {string} */ (data.tag_name));
  if (!parsed) return null;
  const fallback = `https://github.com/${repo}/releases/latest`;
  const page = typeof data.html_url === 'string' ? data.html_url : '';
  return {
    version: parsed.join('.'),
    page: page.startsWith(`https://github.com/${repo}/`) ? page : fallback,
  };
}
