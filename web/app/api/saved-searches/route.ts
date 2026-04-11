/**
 * API Saved Searches — ricerche salvate CRUD, toggle notifiche
 */
import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { JHT_HOME } from '@/lib/jht-paths'

export const dynamic = 'force-dynamic';

type SavedSearch = { id: string; name: string; query: string; filters: Record<string, string>; alertEnabled: boolean; frequency: string; newCount: number; lastRun: number; createdAt: number };

const SS_PATH = path.join(JHT_HOME, 'saved-searches.json');

function load(): SavedSearch[] {
  try { return JSON.parse(fs.readFileSync(SS_PATH, 'utf-8')); }
  catch { return []; }
}

function save(data: SavedSearch[]): void {
  const dir = path.dirname(SS_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = SS_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, SS_PATH);
}

function generateSample(): SavedSearch[] {
  const now = Date.now(); const day = 86400000;
  return [
    { id: 'ss-001', name: 'Full Stack Remote', query: 'Full Stack Developer', filters: { location: 'Remote', salary: '50k+' }, alertEnabled: true, frequency: 'daily', newCount: 3, lastRun: now - 12 * 3600000, createdAt: now - 30 * day },
    { id: 'ss-002', name: 'React Milano', query: 'React Developer', filters: { location: 'Milano' }, alertEnabled: true, frequency: 'daily', newCount: 1, lastRun: now - 6 * 3600000, createdAt: now - 20 * day },
    { id: 'ss-003', name: 'Backend Node.js', query: 'Node.js Backend', filters: { salary: '45k+', type: 'full-time' }, alertEnabled: false, frequency: 'weekly', newCount: 0, lastRun: now - 3 * day, createdAt: now - 15 * day },
    { id: 'ss-004', name: 'Platform Engineer EU', query: 'Platform Engineer', filters: { location: 'EU', remote: 'true' }, alertEnabled: true, frequency: 'realtime', newCount: 5, lastRun: now - 3600000, createdAt: now - 10 * day },
    { id: 'ss-005', name: 'DevOps Torino', query: 'DevOps Engineer', filters: { location: 'Torino' }, alertEnabled: false, frequency: 'weekly', newCount: 0, lastRun: now - 7 * day, createdAt: now - 5 * day },
  ];
}

export async function GET() {
  const searches = load().sort((a, b) => b.lastRun - a.lastRun);
  const withAlerts = searches.filter(s => s.alertEnabled).length;
  const totalNew = searches.reduce((s, ss) => s + ss.newCount, 0);
  return NextResponse.json({ searches, total: searches.length, withAlerts, totalNew });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (body.toggleId) {
      const searches = load(); const ss = searches.find(s => s.id === body.toggleId);
      if (!ss) return NextResponse.json({ error: 'Non trovato' }, { status: 404 });
      ss.alertEnabled = !ss.alertEnabled; save(searches);
      return NextResponse.json({ ok: true, id: ss.id, alertEnabled: ss.alertEnabled });
    }
    const ss: SavedSearch = { id: `ss-${crypto.randomBytes(4).toString('hex')}`, name: body.name ?? '', query: body.query ?? '', filters: body.filters ?? {}, alertEnabled: true, frequency: body.frequency ?? 'daily', newCount: 0, lastRun: Date.now(), createdAt: Date.now() };
    if (!ss.name || !ss.query) return NextResponse.json({ error: 'name e query richiesti' }, { status: 400 });
    const searches = load(); searches.push(ss); save(searches);
    return NextResponse.json({ ok: true, search: ss });
  } catch (err) { return NextResponse.json({ error: String(err) }, { status: 500 }); }
}

export async function DELETE(req: Request) {
  try {
    const { id } = await req.json() as { id: string };
    if (!id) return NextResponse.json({ error: 'id richiesto' }, { status: 400 });
    const searches = load(); const idx = searches.findIndex(s => s.id === id);
    if (idx === -1) return NextResponse.json({ error: 'Non trovato' }, { status: 404 });
    searches.splice(idx, 1); save(searches);
    return NextResponse.json({ ok: true });
  } catch (err) { return NextResponse.json({ error: String(err) }, { status: 500 }); }
}
