/**
 * Helper di containment per il file-serving.
 *
 * Anche se sanifichiamo il path component con `path.basename`, un
 * symlink manualmente piazzato dentro la directory base puo' farci
 * leggere file fuori (es. `/etc/passwd`). Per chiudere quella via:
 *
 *   - resolvere il path reale (segue symlink) sia del candidato che
 *     della base
 *   - verificare che il candidato resolto stia letteralmente sotto la
 *     base resolta (con `+ sep` per evitare prefix-match parziali tipo
 *     `/jht-evil` che fa `startsWith('/jht')`)
 *
 * Pattern coerente con OpenClaw `safe-resolve.ts`.
 */
import fs from 'node:fs'
import path from 'node:path'

/**
 * Resolve `candidate` e verifica che stia sotto `baseDir`.
 * Ritorna il path reale (canonicizzato) o `null` se:
 *   - il file non esiste
 *   - il path reale esce dalla base (escape via symlink o ..)
 *   - la base stessa non esiste
 *
 * Entrambi gli argomenti possono essere relativi o assoluti; viene
 * applicato `realpathSync` su tutti e due. Se `baseDir` ha symlink,
 * la canonicizzazione li segue e il confronto avviene tra path reali.
 */
export function safeResolveUnder(baseDir: string, candidate: string): string | null {
  let realBase: string
  try {
    realBase = fs.realpathSync(baseDir)
  } catch {
    return null
  }

  let realCandidate: string
  try {
    realCandidate = fs.realpathSync(candidate)
  } catch {
    return null
  }

  const baseWithSep = realBase.endsWith(path.sep) ? realBase : realBase + path.sep
  if (realCandidate !== realBase && !realCandidate.startsWith(baseWithSep)) {
    return null
  }
  return realCandidate
}
