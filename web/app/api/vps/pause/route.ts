import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { runBash } from '@/lib/shell'

export const dynamic = 'force-dynamic'

/**
 * Bottone "⏸️ Pausa team" del lifecycle dashboard
 * (docs/internal/vps.md § "Lifecycle e shutdown UX").
 *
 * Cosa fa: `docker stop` del container `jht`. La VPS resta su, la
 * fattura Hetzner continua (~€4.50/mo). Riprendi con un altro click
 * sul bottone "Riprendi" (che invoca `/api/vps/resume` o, lato CLI,
 * `jht up`). Quando: "oggi non lavoro, riprendo domani".
 *
 * NON e' lo stesso di "shutdown server": shutdown del server VPS in
 * Hetzner mantiene comunque la fattura attiva (risorse allocate), per
 * quello c'e' "📸 Snapshot+Termina" (vedi snapshot-destroy/route.ts).
 */
export async function POST() {
  const denied = await requireAuth()
  if (denied) return denied

  const container = (process.env.JHT_CONTAINER_NAME || 'jht').trim()
  // Sanity check: niente caratteri shell pericolosi nel container name.
  // Bind a [a-zA-Z0-9_.-] perche' Docker accetta solo questi nei nomi.
  if (!/^[a-zA-Z0-9_.-]+$/.test(container)) {
    return NextResponse.json(
      { error: `JHT_CONTAINER_NAME non valido: ${container}` },
      { status: 500 }
    )
  }

  try {
    const { stdout, stderr } = await runBash(`docker stop ${container}`)
    return NextResponse.json({
      ok: true,
      action: 'pause',
      container,
      output: stdout.trim() || stderr.trim(),
    })
  } catch (e) {
    const msg = (e as Error).message || String(e)
    // `docker stop` su container gia' fermo ritorna comunque exit 0 con
    // il nome stampato — quindi un errore qui significa daemon down,
    // container inesistente, o permessi insufficienti.
    return NextResponse.json(
      { ok: false, action: 'pause', error: `docker stop fallito: ${msg}` },
      { status: 500 }
    )
  }
}
