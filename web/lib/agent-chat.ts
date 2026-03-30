/**
 * Parser JSONL robusto per le chat degli agenti.
 *
 * Problema: gli agenti Claude a volte scrivono newline reali (0x0a)
 * dentro i valori JSON anziché usare \n escape. Questo spezza il formato
 * JSONL (una riga = un oggetto). Il parser ricostruisce gli oggetti
 * accumulando righe finché non ottiene un JSON valido.
 */

export type ChatMessage = { role: string; text: string; ts: number }

export function parseJsonl(content: string): ChatMessage[] {
  const results: ChatMessage[] = []
  const lines = content.split('\n')
  let buffer = ''

  for (const line of lines) {
    if (!buffer) {
      if (!line.trim()) continue
      // Fast path: singola riga JSONL valida
      try {
        const clean = line.replace(/\\([^"\\\/bfnrtu])/g, '$1')
        const obj = JSON.parse(clean)
        if (obj && typeof obj.role === 'string' && typeof obj.text === 'string' && typeof obj.ts === 'number') {
          results.push(obj)
          continue
        }
      } catch { /* fallthrough: accumula multi-riga */ }
    }

    buffer += (buffer ? '\n' : '') + line

    // Tenta il parse quando il buffer sembra un oggetto JSON completo
    const trimmed = buffer.trim()
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        // Sostituisci newline reali con escape \n per JSON valido
        const clean = trimmed
          .replace(/\n/g, '\\n')
          .replace(/\\([^"\\\/bfnrtu])/g, '$1')
        const obj = JSON.parse(clean)
        if (obj && typeof obj.role === 'string' && typeof obj.text === 'string' && typeof obj.ts === 'number') {
          results.push(obj)
        }
        buffer = ''
      } catch {
        // Non ancora completo, continua ad accumulare
      }
    }
  }

  return results
}
