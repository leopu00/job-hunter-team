import { NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'

const execAsync = promisify(exec)

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    const repoRoot = path.resolve(process.cwd(), '..')
    const script = path.join(repoRoot, 'shared', 'skills', 'browse_folder.py')

    const { stdout } = await execAsync(
      `python "${script}"`,
      { timeout: 120000 }
    )
    const folder = stdout.trim()

    if (!folder) {
      return NextResponse.json({ ok: false, folder: null, error: 'Nessuna cartella selezionata' })
    }

    return NextResponse.json({ ok: true, folder })
  } catch (err: any) {
    // Fallback: python3
    try {
      const repoRoot = path.resolve(process.cwd(), '..')
      const script = path.join(repoRoot, 'shared', 'skills', 'browse_folder.py')

      const { stdout } = await execAsync(
        `python3 "${script}"`,
        { timeout: 120000 }
      )
      const folder = stdout.trim()

      if (!folder) {
        return NextResponse.json({ ok: false, folder: null, error: 'Nessuna cartella selezionata' })
      }

      return NextResponse.json({ ok: true, folder })
    } catch (err2: any) {
      return NextResponse.json({ ok: false, folder: null, error: err2?.message ?? 'Python non trovato' })
    }
  }
}
