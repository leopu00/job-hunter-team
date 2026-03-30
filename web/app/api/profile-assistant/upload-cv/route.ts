import { NextRequest, NextResponse } from 'next/server'
import { runBash } from '@/lib/shell'
import { getWorkspacePath } from '@/lib/workspace'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

export async function POST(req: NextRequest) {
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'multipart form data richiesto' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  if (!file) {
    return NextResponse.json({ error: 'campo "file" richiesto' }, { status: 400 })
  }

  if (file.type !== 'application/pdf') {
    return NextResponse.json(
      { error: 'solo file PDF accettati (ricevuto: ' + file.type + ')' },
      { status: 400 }
    )
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'file troppo grande (max 10 MB)' }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())

  // Verifica magic bytes PDF (%PDF)
  if (buffer.length < 4 || buffer.toString('ascii', 0, 4) !== '%PDF') {
    return NextResponse.json({ error: 'il file non sembra un PDF valido' }, { status: 400 })
  }

  const ws = await getWorkspacePath()
  if (!ws) {
    return NextResponse.json({ error: 'workspace non configurato' }, { status: 500 })
  }

  try {
    // Salva il PDF nel workspace
    const uploadsDir = path.join(ws, 'assistente', 'uploads')
    fs.mkdirSync(uploadsDir, { recursive: true })
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const filePath = path.join(uploadsDir, safeName)
    fs.writeFileSync(filePath, buffer)

    // Scrivi messaggio utente nella chat dell'assistente
    const chatFile = path.join(ws, 'assistente', 'chat.jsonl')
    const userMsg = JSON.stringify({
      role: 'user',
      text: `Ho caricato il CV: ${file.name}. Estrai le informazioni del profilo.`,
      ts: Date.now() / 1000,
    })
    fs.appendFileSync(chatFile, userMsg + '\n', 'utf-8')

    // Invia via tmux all'assistente con istruzione di analisi
    const escapedPath = filePath.replace(/'/g, "'\\''").replace(/\$/g, '\\$').replace(/`/g, '\\`')
    await runBash(`tmux send-keys -t ASSISTENTE -- '[@utente -> @assistente] [CHAT] Ho caricato il mio CV in ${escapedPath} — analizzalo ed estrai tutte le informazioni del candidato in formato JSON strutturato. Rispondi con il JSON nella chat.'`)
    await runBash(`tmux send-keys -t ASSISTENTE Enter`)

    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'upload fallito'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
