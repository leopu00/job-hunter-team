import { NextResponse } from 'next/server'
import { exec, execFile } from 'child_process'
import { promisify } from 'util'
import { runBash } from '@/lib/shell'
import { requireAuth } from '@/lib/auth'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

export const dynamic = 'force-dynamic'

// Pattern Docker per nomi container (cfr. docker-cli). Validato a
// module load: una env var `JHT_SHELL_VIA=docker:<bad>` non deve poter
// iniettare metacaratteri shell nei comandi che la incorporano.
const DOCKER_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/

// Quando Next gira sull'host (dev mode) e tmux gira dentro al container,
// JHT_SHELL_VIA=docker:<c> dirige il check di esistenza sessione dentro
// al container. Il comando di attach lanciato da osascript/Terminal deve
// quindi anch'esso usare `docker exec -it <c>` per agganciarsi al tmux
// del container, altrimenti cerca un tmux host inesistente. Fuori dal
// dev mode (JHT_SHELL_VIA non settata) si usa l'attach diretto host.
const shellVia = process.env.JHT_SHELL_VIA
const rawDockerContainer = shellVia?.startsWith('docker:') ? shellVia.slice('docker:'.length) : null
const dockerContainer = rawDockerContainer && DOCKER_NAME_RE.test(rawDockerContainer)
  ? rawDockerContainer
  : null
if (rawDockerContainer && !dockerContainer) {
  console.warn(`[capitano/terminal] JHT_SHELL_VIA container "${rawDockerContainer}" non valido, attach diretto`)
}
const ATTACH_CMD = dockerContainer
  ? `docker exec -it ${dockerContainer} tmux attach -t CAPITANO`
  : 'tmux attach -t CAPITANO'

/** Apre una finestra terminale con tmux attach alla sessione CAPITANO */
export async function POST() {
  const authError = await requireAuth()
  if (authError) return authError

  try {
    // Verifica che la sessione CAPITANO esista
    const { stdout: sessions } = await runBash(
      'tmux list-sessions -F "#{session_name}" 2>/dev/null || echo ""'
    )
    const sessionExists = sessions.trim().split('\n').some(s => s.trim() === 'CAPITANO')
    if (!sessionExists) {
      return NextResponse.json(
        { ok: false, error: 'Sessione CAPITANO non attiva. Avvia prima il capitano.' },
        { status: 404 }
      )
    }

    if (process.platform === 'win32') {
      // Apri Windows Terminal o PowerShell con wsl tmux attach
      await execAsync(
        `start powershell -NoExit -Command "wsl -d Ubuntu-22.04 -- ${ATTACH_CMD}"`,
        { timeout: 10000 }
      ).catch(() => {
        return execAsync(
          `cmd /c start powershell -NoExit -Command "wsl ${ATTACH_CMD}"`,
          { timeout: 10000 }
        )
      })
    } else if (process.platform === 'darwin') {
      // Mac: apri Terminal.app e porta in primo piano con 'activate'
      await execFileAsync('osascript', [
        '-e', 'tell application "Terminal"',
        '-e', 'activate',
        '-e', `do script "${ATTACH_CMD}"`,
        '-e', 'end tell',
      ], { timeout: 10000 })
    } else {
      // Linux: prova x-terminal-emulator, fallback gnome-terminal
      await execFileAsync('x-terminal-emulator', ['-e', ATTACH_CMD], { timeout: 10000 })
        .catch(() => execFileAsync('gnome-terminal', ['--', 'bash', '-c', `${ATTACH_CMD}; exec bash`], { timeout: 10000 }))
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
