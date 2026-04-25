import { NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import { runBash } from '@/lib/shell'
import { requireAuth } from '@/lib/auth'

const execAsync = promisify(exec)

export const dynamic = 'force-dynamic'

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
        `start powershell -NoExit -Command "wsl -d Ubuntu-22.04 -- tmux attach -t CAPITANO"`,
        { timeout: 10000 }
      ).catch(() => {
        return execAsync(
          `cmd /c start powershell -NoExit -Command "wsl tmux attach -t CAPITANO"`,
          { timeout: 10000 }
        )
      })
    } else if (process.platform === 'darwin') {
      // Mac: apri Terminal.app e porta in primo piano con 'activate'
      await execAsync(
        `osascript -e 'tell application "Terminal"' -e 'activate' -e 'do script "tmux attach -t CAPITANO"' -e 'end tell'`,
        { timeout: 10000 }
      )
    } else {
      // Linux: prova x-terminal-emulator, fallback gnome-terminal
      await execAsync(
        `x-terminal-emulator -e "tmux attach -t CAPITANO"`,
        { timeout: 10000 }
      ).catch(() =>
        execAsync(
          `gnome-terminal -- bash -c "tmux attach -t CAPITANO; exec bash"`,
          { timeout: 10000 }
        )
      ).catch(() => {})
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Apertura terminale fallita' },
      { status: 500 }
    )
  }
}
