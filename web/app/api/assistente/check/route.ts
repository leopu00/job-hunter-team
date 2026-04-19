import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'
import { runBash, toWslPath } from '@/lib/shell'
import {
  JHT_DB_PATH,
  JHT_HOME,
  JHT_PROFILE_YAML,
  JHT_USER_DIR,
} from '@/lib/jht-paths'

export const dynamic = 'force-dynamic'

type Check = {
  id: string
  label: string
  ok: boolean
  detail?: string
  hint?: string
}

export async function GET() {
  const repoRoot = path.resolve(process.cwd(), '..')
  const repoPath = toWslPath(repoRoot)
  const checks: Check[] = []

  async function check(id: string, label: string, cmd: string, hint: string): Promise<void> {
    try {
      const { stdout } = await runBash(cmd)
      const detail = stdout.trim()
      checks.push({ id, label, ok: true, detail: detail || undefined })
    } catch {
      checks.push({ id, label, ok: false, hint })
    }
  }

  function checkFile(id: string, label: string, absPath: string, hint: string): void {
    const ok = fs.existsSync(absPath)
    checks.push({ id, label, ok, detail: ok ? absPath : undefined, hint: ok ? undefined : hint })
  }

  // Prerequisiti ambiente
  await check('python', 'Python 3.10+',
    'python3 --version 2>/dev/null || python --version 2>/dev/null',
    'Installa Python 3.10+: https://python.org')

  await check('tmux', 'tmux',
    'tmux -V',
    'Installa tmux: sudo apt install tmux')

  await check('claude', 'Claude CLI',
    'which claude && claude --version 2>/dev/null || which claude',
    'Installa Claude CLI: https://claude.ai/download')

  // Configurazione (ora da ~/.jht, non dal .env del repo)
  checkFile('jht_home', 'Cartella ~/.jht', JHT_HOME, 'Avvia la TUI per inizializzare ~/.jht')
  checkFile('user_dir', 'Cartella utente', JHT_USER_DIR, 'Avvia la TUI per creare ~/Documents/Job Hunter Team')
  checkFile('profile', 'candidate_profile.yml', JHT_PROFILE_YAML, 'Completa il profilo nella TUI o nel wizard web')
  checkFile('db', 'Database SQLite', JHT_DB_PATH, 'Avvia la TUI per inizializzare il database')

  // Template agenti (sempre nella repo)
  await check('tpl_assistente', 'Template assistente.md',
    `test -f "${repoPath}/agents/assistente/assistente.md" && echo "ok"`,
    'File agents/assistente/assistente.md mancante')

  await check('tpl_alfa', 'Template capitano.md',
    `test -f "${repoPath}/agents/capitano/capitano.md" && echo "ok"`,
    'Crea agents/capitano/capitano.md — identità del Capitano')

  return NextResponse.json({ checks, workspace: JHT_USER_DIR })
}
