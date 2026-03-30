/**
 * Parser JSONL robusto per file chat agenti.
 * Gestisce risposte multi-riga e escape invalidi prodotti dai modelli AI.
 */

export type ChatEntry = { role: string; text: string; ts: number }

function tryParse(chunk: string): ChatEntry | null {
  try {
    // Rimuovi escape invalidi tipo \! \' etc che i modelli AI producono
    const clean = chunk.replace(/\\([^"\\\/bfnrtu])/g, '$1')
    const obj = JSON.parse(clean)
    if (
      obj !== null &&
      typeof obj.role === 'string' &&
      typeof obj.text === 'string' &&
      typeof obj.ts === 'number'
    ) {
      return obj as ChatEntry
    }
    return null
  } catch {
    return null
  }
}

/**
 * Parsa contenuto JSONL gestendo entry che si estendono su più righe.
 * Ogni entry è un oggetto JSON che inizia con '{'.
 */
export function parseJsonl(content: string): ChatEntry[] {
  const results: ChatEntry[] = []
  const lines = content.split('\n')
  let buffer = ''

  for (const line of lines) {
    // Nuova entry: riga che inizia con '{' mentre c'è già un buffer pendente
    if (line.trimStart().startsWith('{') && buffer.trim()) {
      const parsed = tryParse(buffer.trim())
      if (parsed) results.push(parsed)
      buffer = line
    } else {
      buffer = buffer ? buffer + '\n' + line : line
    }
  }

  // Flush ultima entry
  if (buffer.trim()) {
    const parsed = tryParse(buffer.trim())
    if (parsed) results.push(parsed)
  }

  return results
}
