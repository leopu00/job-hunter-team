import { NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import { runBash } from '@/lib/shell'

const execAsync = promisify(exec)

export const dynamic = 'force-dynamic'

/** Apre una finestra terminale con tmux attach alla sessione ASSISTENTE */
export async function POST() {
  try {
    // Verifica che la sessione ASSISTENTE esista
    const { stdout: sessions } = await runBash(
      'tmux list-sessions -F "#{session_name}" 2>/dev/null || echo ""'
    )
    const sessionExists = sessions.trim().split('\n').some(s => s.trim() === 'ASSISTENTE')
    if (!sessionExists) {
      return NextResponse.json(
        { ok: false, error: 'Sessione ASSISTENTE non attiva. Avvia prima l\'assistente.' },
        { status: 404 }
      )
    }

    if (process.platform === 'win32') {
      // Apri Windows Terminal o PowerShell con wsl tmux attach
      await execAsync(
        `start powershell -NoExit -Command "wsl -d Ubuntu-22.04 -- tmux attach -t ASSISTENTE"`,
        { timeout: 10000 }
      ).catch(() => {
        return execAsync(
          `cmd /c start powershell -NoExit -Command "wsl tmux attach -t ASSISTENTE"`,
          { timeout: 10000 }
        )
      })
    } else if (process.platform === 'darwin') {
      // Mac: apri Terminal.app e porta in primo piano con 'activate'
      await execAsync(
        `osascript -e 'tell application "Terminal"' -e 'activate' -e 'do script "tmux attach -t ASSISTENTE"' -e 'end tell'`,
        { timeout: 10000 }
      )
    } else {
      // Linux: prova x-terminal-emulator, fallback gnome-terminal
      await execAsync(
        `x-terminal-emulator -e "tmux attach -t ASSISTENTE"`,
        { timeout: 10000 }
      ).catch(() =>
        execAsync(
          `gnome-terminal -- bash -c "tmux attach -t ASSISTENTE; exec bash"`,
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
