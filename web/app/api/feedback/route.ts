/**
 * API Feedback — raccolta feedback utente con rating, categoria, stato
 */
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createClient } from '../../../lib/supabase/server';
import { isSupabaseConfigured } from '../../../lib/workspace';
import { sanitizedError } from '@/lib/error-response';

export const dynamic = 'force-dynamic';

type FeedbackCategory = 'bug' | 'feature' | 'ux' | 'other';
type FeedbackStatus = 'open' | 'in-progress' | 'resolved';
type Feedback = { id: string; rating: number; category: FeedbackCategory; description: string; screenshot?: string; status: FeedbackStatus; createdAt: number };
type FeedbackRow = { id: string; rating: number; category: string; description: string; screenshot_url: string | null; status: string; created_at: string };

const TABLE = 'feedback_tickets';
const FILE = path.join(os.tmpdir(), 'jht', 'feedback.json');

function clampRating(value: number): number {
  return Math.min(5, Math.max(1, Number.isFinite(value) ? value : 1));
}

function normalizeCategory(value: string | null | undefined): FeedbackCategory {
  return value === 'bug' || value === 'feature' || value === 'ux' || value === 'other' ? value : 'other';
}

function normalizeStatus(value: string | null | undefined): FeedbackStatus {
  return value === 'open' || value === 'in-progress' || value === 'resolved' ? value : 'open';
}

function summarize(items: Feedback[]) {
  const open = items.filter((f) => f.status === 'open').length;
  const inProgress = items.filter((f) => f.status === 'in-progress').length;
  const resolved = items.filter((f) => f.status === 'resolved').length;
  return { total: items.length, open, inProgress, resolved };
}

function fromRow(row: FeedbackRow): Feedback {
  return {
    id: row.id,
    rating: clampRating(row.rating),
    category: normalizeCategory(row.category),
    description: row.description,
    screenshot: row.screenshot_url ?? undefined,
    status: normalizeStatus(row.status),
    createdAt: Date.parse(row.created_at) || Date.now(),
  };
}

function loadLocal(): Feedback[] {
  try { const d = JSON.parse(fs.readFileSync(FILE, 'utf-8')); return Array.isArray(d) ? d : []; }
  catch { return []; }
}

function saveLocal(items: Feedback[]): void {
  const dir = path.dirname(FILE);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(items, null, 2), 'utf-8');
  fs.renameSync(tmp, FILE);
}

async function listFromSupabase(): Promise<Feedback[] | null> {
  if (!isSupabaseConfigured) return null;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from(TABLE)
      .select('id, rating, category, description, screenshot_url, status, created_at')
      .order('created_at', { ascending: false });

    if (error || !data) return null;
    return (data as FeedbackRow[]).map(fromRow);
  } catch {
    return null;
  }
}

async function insertIntoSupabase(feedback: Omit<Feedback, 'id' | 'status' | 'createdAt'>): Promise<Feedback | null> {
  if (!isSupabaseConfigured) return null;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from(TABLE)
      .insert({
        rating: feedback.rating,
        category: feedback.category,
        description: feedback.description,
        screenshot_url: feedback.screenshot ?? null,
      })
      .select('id, rating, category, description, screenshot_url, status, created_at')
      .single();

    if (error || !data) return null;
    return fromRow(data as FeedbackRow);
  } catch {
    return null;
  }
}

export async function GET() {
  const cloudItems = await listFromSupabase();
  if (cloudItems) {
    return NextResponse.json({ feedback: cloudItems, summary: summarize(cloudItems) });
  }

  const items = loadLocal();
  items.sort((a, b) => b.createdAt - a.createdAt);
  return NextResponse.json({ feedback: items, summary: summarize(items) });
}

export async function POST(req: Request) {
  try {
    const { rating, category, description, screenshot } = await req.json() as { rating: number; category: FeedbackCategory; description: string; screenshot?: string };
    if (!description?.trim() || !rating) return NextResponse.json({ error: 'Campi richiesti: rating, description' }, { status: 400 });

    const payload = {
      rating: clampRating(rating),
      category: normalizeCategory(category),
      description: description.trim(),
      screenshot: screenshot?.trim() || undefined,
    };

    const cloudItem = await insertIntoSupabase(payload);
    if (cloudItem) return NextResponse.json({ feedback: cloudItem });

    const items = loadLocal();
    const fb: Feedback = {
      id: crypto.randomBytes(6).toString('hex'),
      rating: payload.rating,
      category: payload.category,
      description: payload.description,
      screenshot: payload.screenshot,
      status: 'open',
      createdAt: Date.now(),
    };
    items.push(fb);
    saveLocal(items);
    return NextResponse.json({ feedback: fb });
  } catch (err) { return sanitizedError(err, { scope: 'feedback' }); }
}
