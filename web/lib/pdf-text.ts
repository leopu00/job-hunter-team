import { PDFParse } from 'pdf-parse'

export async function extractPdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) })
  try {
    const result = await parser.getText()
    const text = (result as unknown as { text?: string }).text
      ?? (Array.isArray((result as unknown as { pages?: Array<{ text?: string }> }).pages)
        ? (result as unknown as { pages: Array<{ text?: string }> }).pages.map(p => p.text ?? '').join('\n\n')
        : '')
    return text.trim()
  } finally {
    await parser.destroy().catch(() => {})
  }
}
