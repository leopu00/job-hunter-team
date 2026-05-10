import { NextRequest, NextResponse } from 'next/server'
import { exec, execFile } from 'child_process'
import { promisify } from 'util'
import { runBash } from '@/lib/shell'
import { requireAuth } from '@/lib/auth'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

export const dynamic = 'force-dynamic'

// Allow-list per il nome della sessione tmux: deve combaciare con i
// nomi che il launcher genera (CAPITANO, SCOUT-1, ANALISTA-2, ...).
// Restrittivo apposta — il valore finisce in un comando shell aperto
// in Terminal.app via osascript / PowerShell, quindi qualsiasi virgolette
// o spazio non controllato sarebbe iniezione di shell.
const SESSION_RE = /^[A-Z][A-Z0-9_-]{0,31}$/

// Pattern Docker per nomi container (cfr. docker-cli). Validato a
// module load: una env var `JHT_SHELL_VIA=docker:<bad>` non deve poter
// iniettare metacaratteri shell nei comandi che la incorporano.
const DOCKER_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/

// Quando Next gira sull'host (dev mode) e tmux gira nel container, il
// client Terminal sull'host deve fare `docker exec -it <c> tmux ...`
// per agganciarsi al server tmux del container, non a uno host
// inesistente. Fuori dal dev mode si usa l'attach diretto.
const shellVia = process.env.JHT_SHELL_VIA
const rawDockerContainer = shellVia?.startsWith('docker:') ? shellVia.slice('docker:'.length) : null
const dockerContainer = rawDockerContainer && DOCKER_NAME_RE.test(rawDockerContainer)
  ? rawDockerContainer
  : null
if (rawDockerContainer && !dockerContainer) {
  console.warn(`[terminal/open] JHT_SHELL_VIA container "${rawDockerContainer}" non valido, attach diretto`)
}

function attachCmd(session: string): string {
  return dockerContainer
    ? `docker exec -it ${dockerContainer} tmux attach -t ${session}`
    : `tmux attach -t ${session}`
}

/** Apre una finestra terminale nativa con `tmux attach` alla sessione richiesta. */
export async function POST(req: NextRequest) {
  const authError = await requireAuth()
  if (authError) return authError

  const session = req.nextUrl.searchParams.get('session') ?? ''
  if (!SESSION_RE.test(session)) {
    return NextResponse.json(
      { ok: false, error: 'session non valida' },
      { status: 400 }
    )
  }

  try {
    // Verifica esistenza sessione (sul tmux server giusto, in/out container).
    const { stdout: sessions } = await runBash(
      'tmux list-sessions -F "#{session_name}" 2>/dev/null || echo ""'
    )
    const sessionExists = sessions.trim().split('\n').some(s => s.trim() === session)
    if (!sessionExists) {
      return NextResponse.json(
        { ok: false, error: `Sessione ${session} non attiva.` },
        { status: 404 }
      )
    }

    const cmd = attachCmd(session)

    if (process.platform === 'win32') {
      await execAsync(
        `start powershell -NoExit -Command "wsl -d Ubuntu-22.04 -- ${cmd}"`,
        { timeout: 10000 }
      ).catch(() => {
        return execAsync(
          `cmd /c start powershell -NoExit -Command "wsl ${cmd}"`,
          { timeout: 10000 }
        )
      })
    } else if (process.platform === 'darwin') {
      await execFileAsync('osascript', [
        '-e', 'tell application "Terminal"',
        '-e', 'activate',
        '-e', `do script "${cmd}"`,
        '-e', 'end tell',
      ], { timeout: 10000 })
    } else {
      await execFileAsync('x-terminal-emulator', ['-e', cmd], { timeout: 10000 })
        .catch(() => execFileAsync('gnome-terminal', ['--', 'bash', '-c', `${cmd}; exec bash`], { timeout: 10000 }))
        .catch(() => {})
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Apertura terminale fallita' },
      { status: 500 }
    )
  }
}
