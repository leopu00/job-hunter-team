/**
 * Risoluzione della master passphrase usata per cifrare le credenziali.
 *
 * Ordine di lookup, dal piu' al meno preferito:
 *   1. Env var (default `JHT_CREDENTIALS_KEY`, override-abile per tool
 *      legacy come `JHT_ENCRYPTION_KEY`).
 *   2. OS keyring via `@napi-rs/keyring`, se la dipendenza opzionale
 *      e' installata e l'utente ha gia' salvato il segreto.
 *   3. Errore esplicito con istruzioni di setup.
 *
 * Niente piu' fallback "machine-derived" tipo
 * `jht-${homedir()}-default` o `${USER}-${homedir()}`: il finding H4
 * dell'audit pre-launch li ha esplicitamente rifiutati perche'
 * banalmente derivabili sullo stesso filesystem.
 *
 * `@napi-rs/keyring` e' una optional peer-dep: viene caricato sync
 * via `createRequire` e fallisce silently se assente, lasciando solo
 * il path env var.
 */

import { createRequire } from 'node:module'

const KEYRING_SERVICE = 'jht-credentials'

export class MissingPassphraseError extends Error {
  constructor(envVarName: string) {
    super(buildMissingPassphraseMessage(envVarName))
    this.name = 'MissingPassphraseError'
  }
}

function buildMissingPassphraseMessage(envVarName: string): string {
  return [
    `JHT credential passphrase non trovata.`,
    ``,
    `Imposta una passphrase robusta in uno di questi modi:`,
    `  1. export ${envVarName}="<passphrase>"   (shell rc per persistenza)`,
    `  2. installa @napi-rs/keyring + jht keyring set ${KEYRING_SERVICE}`,
    ``,
    `Niente piu' fallback machine-derived: i token cifrati non sono`,
    `recuperabili senza una passphrase scelta dall'utente.`,
  ].join('\n')
}

interface KeyringEntry {
  getPassword(): string | null
}
interface KeyringModule {
  Entry: new (service: string, account: string) => KeyringEntry
}

const requireMaybe = (() => {
  try {
    return createRequire(import.meta.url)
  } catch {
    return null
  }
})()

function tryKeyring(account: string): string | null {
  if (!requireMaybe) return null
  try {
    const mod = requireMaybe('@napi-rs/keyring') as KeyringModule | null
    if (!mod?.Entry) return null
    const entry = new mod.Entry(KEYRING_SERVICE, account)
    const value = entry.getPassword()
    return value && value.trim() ? value : null
  } catch {
    // Pacchetto non installato o errore platform → fallback silenzioso.
    return null
  }
}

export interface ResolvePassphraseOptions {
  /** Nome dell'env var preferita. Default: `JHT_CREDENTIALS_KEY`. */
  envVar?: string
  /** Account name per il keyring. Default: l'env var name. */
  keyringAccount?: string
  /**
   * Env var legacy ammesse come fallback (non documentate). Utili per
   * non rompere setup esistenti come `JHT_ENCRYPTION_KEY` (tui/oauth).
   */
  legacyEnvVars?: readonly string[]
}

/**
 * Ritorna la passphrase corrente, o lancia `MissingPassphraseError`
 * se nessuna sorgente la fornisce.
 */
export function resolveJhtPassphrase(
  options: ResolvePassphraseOptions = {},
): string {
  const envVar = options.envVar ?? 'JHT_CREDENTIALS_KEY'
  const account = options.keyringAccount ?? envVar
  const legacy = options.legacyEnvVars ?? []

  const fromEnv = process.env[envVar]?.trim()
  if (fromEnv) return fromEnv

  for (const name of legacy) {
    const v = process.env[name]?.trim()
    if (v) return v
  }

  const fromKeyring = tryKeyring(account)
  if (fromKeyring) return fromKeyring

  throw new MissingPassphraseError(envVar)
}
