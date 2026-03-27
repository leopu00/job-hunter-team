import { NextResponse } from 'next/server'
import path from 'path'
import { runBash, toWslPath } from '@/lib/shell'

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

  // Helper per eseguire un check
  async function check(id: string, label: string, cmd: string, hint: string): Promise<void> {
    try {
      const { stdout } = await runBash(cmd)
      const detail = stdout.trim()
      checks.push({ id, label, ok: true, detail: detail || undefined })
    } catch {
      checks.push({ id, label, ok: false, hint })
    }
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

  // Configurazione
  await check('env', '.env configurato',
    `test -f "${repoPath}/.env" && grep -q "ANTHROPIC_API_KEY=." "${repoPath}/.env" && echo "ok"`,
    'Copia .env.example in .env e inserisci la tua API key')

  await check('workspace', 'JHT_WORKSPACE configurato',
    `grep -oP "^JHT_WORKSPACE=\\K.*" "${repoPath}/.env" 2>/dev/null | grep -v "^$"`,
    'Imposta JHT_WORKSPACE nel .env')

  await check('profile', 'candidate_profile.yml',
    `test -f "${repoPath}/candidate_profile.yml" && echo "ok"`,
    'Copia candidate_profile.yml.example e compila con i tuoi dati')

  await check('db', 'Database SQLite',
    `test -f "${repoPath}/shared/data/jobs.db" && echo "ok"`,
    'Esegui: python3 shared/skills/db_init.py')

  // Template agenti
  await check('tpl_assistente', 'Template assistente.md',
    `test -f "${repoPath}/agents/assistente/assistente.md" && echo "ok"`,
    'File agents/assistente/assistente.md mancante')

  await check('tpl_alfa', 'Template alfa.md',
    `test -f "${repoPath}/agents/alfa/alfa.md" && echo "ok"`,
    'Crea agents/alfa/alfa.md — identità del Capitano')

  // Leggi workspace corrente
  let workspace = ''
  try {
    const { stdout } = await runBash(
      `grep -oP "^JHT_WORKSPACE=\\K.*" "${repoPath}/.env" 2>/dev/null || echo ""`
    )
    workspace = stdout.trim()
  } catch { /* ignore */ }

  return NextResponse.json({ checks, workspace })
}
