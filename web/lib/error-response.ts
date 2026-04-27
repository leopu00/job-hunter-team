/**
 * Sanitizzazione delle response di errore (finding M4).
 *
 * Le route che ritornano `String(err)` o `err.message` come body JSON
 * leak informazioni sull'ambiente: stack-trace path, messaggi
 * generati da librerie con dettagli su filesystem o sintassi del DB.
 * In produzione la risposta deve essere generica e il dettaglio finire
 * in log lato server. In sviluppo il dettaglio resta utile per il dev.
 */
import { NextResponse } from 'next/server'

const IS_DEV = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test'

export interface SanitizedErrorOptions {
  /** Status HTTP (default 500). */
  status?: number
  /** Identificatore della route (`path o nome del file`) per il log interno. */
  scope?: string
  /** Messaggio sicuro da rimandare al client (default: "internal"). */
  publicMessage?: string
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    return `${err.name}: ${err.message}`
  }
  if (typeof err === 'string') return err
  try { return JSON.stringify(err) } catch { return String(err) }
}

/**
 * Logga l'errore lato server e ritorna una `NextResponse` con un payload
 * sicuro. In dev mette l'errore originale nel body per non rallentare
 * il debug; in prod restituisce solo `{ error: <publicMessage> }`.
 */
export function sanitizedError(err: unknown, opts: SanitizedErrorOptions = {}): NextResponse {
  const status = opts.status ?? 500
  const scope = opts.scope ?? 'api'
  const publicMessage = opts.publicMessage ?? 'internal'

  const detail = describeError(err)
  // Log strutturato leggibile dai tail del container
  console.error(`[${scope}] ${status} ${detail}`)

  if (IS_DEV) {
    return NextResponse.json({ error: publicMessage, detail }, { status })
  }
  return NextResponse.json({ error: publicMessage }, { status })
}
