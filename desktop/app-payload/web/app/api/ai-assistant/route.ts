/**
 * API AI Assistant — chat con assistente, risposte simulate, suggerimenti azioni
 */
import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const dynamic = 'force-dynamic';

type Message = { role: 'user' | 'assistant'; content: string; timestamp: number };

const HISTORY_PATH = path.join(os.homedir(), '.jht', 'ai-assistant-history.json');

function loadHistory(): Message[] {
  try { return JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf-8')); }
  catch { return []; }
}

function saveHistory(msgs: Message[]): void {
  const dir = path.dirname(HISTORY_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = HISTORY_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(msgs.slice(-50), null, 2), 'utf-8');
  fs.renameSync(tmp, HISTORY_PATH);
}

const RESPONSES: Record<string, string> = {
  'cover letter': 'Posso aiutarti a scrivere una cover letter. Dimmi per quale posizione e azienda, e preparerò una bozza personalizzata basata sul tuo profilo.',
  'colloquio': 'Per prepararti al colloquio, posso: 1) Simulare domande tecniche, 2) Analizzare l\'azienda, 3) Suggerire domande da fare. Quale preferisci?',
  'analizza': 'Condividi il link o la descrizione dell\'offerta e ti fornirò: match con il tuo profilo, punti di forza/debolezza, suggerimenti per la candidatura.',
  'cv': 'Posso aiutarti a ottimizzare il CV per una posizione specifica. Indica il ruolo target e evidenzierò le esperienze più rilevanti.',
  'salary': 'Per la negoziazione salariale considero: il tuo livello, il mercato locale, il settore, e il range dell\'offerta. Dammi più dettagli.',
};

function generateResponse(message: string): string {
  const lower = message.toLowerCase();
  for (const [key, response] of Object.entries(RESPONSES)) {
    if (lower.includes(key)) return response;
  }
  return `Ho ricevuto il tuo messaggio. Come assistente AI del Job Hunter, posso aiutarti con:\n\n• Scrivere cover letter personalizzate\n• Preparare colloqui tecnici\n• Analizzare offerte di lavoro\n• Ottimizzare il CV\n• Negoziazione salariale\n\nCosa posso fare per te?`;
}

export async function GET() {
  const history = loadHistory();
  const suggestions = [
    { label: 'Scrivi cover letter', prompt: 'Aiutami a scrivere una cover letter per la posizione di Full Stack Developer' },
    { label: 'Prepara colloquio', prompt: 'Aiutami a prepararmi per un colloquio tecnico' },
    { label: 'Analizza offerta', prompt: 'Analizza questa offerta di lavoro per me' },
    { label: 'Ottimizza CV', prompt: 'Come posso migliorare il mio CV per ruoli backend?' },
  ];
  return NextResponse.json({ history, suggestions });
}

export async function POST(req: Request) {
  try {
    const { message } = await req.json() as { message: string };
    if (!message?.trim()) return NextResponse.json({ error: 'Messaggio richiesto' }, { status: 400 });
    const history = loadHistory();
    const userMsg: Message = { role: 'user', content: message.trim(), timestamp: Date.now() };
    const assistantMsg: Message = { role: 'assistant', content: generateResponse(message), timestamp: Date.now() + 1 };
    history.push(userMsg, assistantMsg);
    saveHistory(history);
    return NextResponse.json({ reply: assistantMsg.content, timestamp: assistantMsg.timestamp });
  } catch (err) { return NextResponse.json({ error: String(err) }, { status: 500 }); }
}
