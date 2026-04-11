/**
 * Path fisso lato client. Il workspace non e' piu' configurabile:
 * gli agenti girano in ~/.jht/ (nascosto), l'utente usa
 * ~/Documents/Job Hunter Team/ (visibile).
 *
 * Queste funzioni restano come stub per retro-compatibilita' — qualsiasi
 * consumer rimasto ottiene il path fisso o un no-op.
 */

const FIXED_USER_DIR_LABEL = '~/Documents/Job Hunter Team'

export function getWorkspace(): string {
  return FIXED_USER_DIR_LABEL
}

export function setWorkspace(_path: string): void {
  /* no-op: il path e' fisso */
}

export function clearWorkspace(): void {
  /* no-op: il path e' fisso */
}
