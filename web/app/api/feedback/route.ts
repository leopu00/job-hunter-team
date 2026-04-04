/**
 * API Feedback — raccolta feedback utente con rating, categoria, stato
 */
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const dynamic = 'force-dynamic';

type FeedbackCategory = 'bug' | 'feature' | 'ux' | 'other';
type FeedbackStatus = 'open' | 'in-progress' | 'resolved';
type Feedback = { id: string; rating: number; category: FeedbackCategory; description: string; screenshot?: string; status: FeedbackStatus; createdAt: number };

const FILE = path.join(os.homedir(), '.jht', 'feedback.json');

function load(): Feedback[] {
  try { const d = JSON.parse(fs.readFileSync(FILE, 'utf-8')); return Array.isArray(d) ? d : []; }
  catch { return []; }
}

function save(items: Feedback[]): void {
  const dir = path.dirname(FILE);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(items, null, 2), 'utf-8');
  fs.renameSync(tmp, FILE);
}

function sampleFeedback(): Feedback[] {
  const now = Date.now(), DAY = 86400000;
  return [
    { id: 'f1', rating: 5, category: 'feature', description: 'Sarebbe utile un dark mode toggle nella sidebar', status: 'in-progress', createdAt: now - 5 * DAY },
    { id: 'f2', rating: 3, category: 'bug', description: 'Il calendario non mostra gli eventi del weekend', status: 'open', createdAt: now - 3 * DAY },
    { id: 'f3', rating: 4, category: 'ux', description: 'I filtri nella pagina jobs potrebbero essere sticky', status: 'resolved', createdAt: now - 10 * DAY },
    { id: 'f4', rating: 2, category: 'bug', description: 'Errore 500 quando salvo una ricerca senza query', status: 'open', createdAt: now - 1 * DAY },
  ];
}

export async function GET() {
  let items = load();
  if (!items.length) { items = sampleFeedback(); save(items); }
  items.sort((a, b) => b.createdAt - a.createdAt);
  const open = items.filter(f => f.status === 'open').length;
  const inProgress = items.filter(f => f.status === 'in-progress').length;
  const resolved = items.filter(f => f.status === 'resolved').length;
  return NextResponse.json({ feedback: items, summary: { total: items.length, open, inProgress, resolved } });
}

export async function POST(req: Request) {
  try {
    const { rating, category, description, screenshot } = await req.json() as { rating: number; category: FeedbackCategory; description: string; screenshot?: string };
    if (!description?.trim() || !rating) return NextResponse.json({ error: 'Campi richiesti: rating, description' }, { status: 400 });
    const items = load();
    const fb: Feedback = { id: crypto.randomBytes(6).toString('hex'), rating: Math.min(5, Math.max(1, rating)), category: category ?? 'other', description: description.trim(), screenshot, status: 'open', createdAt: Date.now() };
    items.push(fb);
    save(items);
    return NextResponse.json({ feedback: fb });
  } catch (err) { return NextResponse.json({ error: String(err) }, { status: 500 }); }
}
