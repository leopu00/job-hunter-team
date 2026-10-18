/** Etichette dei fasci sul globo: funzioni pure, provate senza WebGL. */

/**
 * Testo sotto un fascio: niente per una posizione sola, il numero per un
 * gruppo, «N remote» per un gruppo di sole remote. Il «·» di prima («2 ·
 * remote») faceva leggere due cose staccate.
 */
export function groupLabel(
  count: number,
  remote: boolean,
  remoteWord: string,
): string {
  if (count <= 1) return "";
  return remote ? `${count} ${remoteWord}` : String(count);
}
