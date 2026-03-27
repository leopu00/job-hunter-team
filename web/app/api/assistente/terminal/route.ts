import { NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export const dynamic = 'force-dynamic'

/** Apre una finestra PowerShell con tmux attach alla sessione ASSISTENTE */
export async function POST() {
  try {
    if (process.platform === 'win32') {
      // Apri Windows Terminal o PowerShell con wsl tmux attach
      await execAsync(
        `start powershell -NoExit -Command "wsl -d Ubuntu-22.04 -- tmux attach -t ASSISTENTE"`,
        { timeout: 5000 }
      ).catch(() => {
        // Fallback: prova con cmd start
        return execAsync(
          `cmd /c start powershell -NoExit -Command "wsl tmux attach -t ASSISTENTE"`,
          { timeout: 5000 }
        )
      })
    } else {
      // Linux/Mac: apri terminale di default
      await execAsync(
        `tmux attach -t ASSISTENTE`,
        { timeout: 5000 }
      ).catch(() => {})
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? 'Apertura fallita' }, { status: 500 })
  }
}
