/**
 * API Archive — candidature chiuse: rejected, expired, withdrawn. Filtri, bulk delete, export.
 */
import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { JHT_HOME } from '@/lib/jht-paths'
import { sanitizedError } from '@/lib/error-response'

export const dynamic = 'force-dynamic';

type ArchiveReason = 'rejected' | 'expired' | 'withdrawn';
type ArchivedApp = { id: string; jobTitle: string; company: string; reason: ArchiveReason; appliedAt: number; closedAt: number; salary?: string; notes?: string };

const FILE = path.join(JHT_HOME, 'archive.json');

function load(): ArchivedApp[] {
  try { const d = JSON.parse(fs.readFileSync(FILE, 'utf-8')); return Array.isArray(d) ? d : []; }
  catch { return []; }
}

function save(items: ArchivedApp[]): void {
  const dir = path.dirname(FILE);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(items, null, 2), 'utf-8');
  fs.renameSync(tmp, FILE);
}

function sampleArchive(): ArchivedApp[] {
  const now = Date.now(), DAY = 86400000;
  return [
    { id: 'ar1', jobTitle: 'Frontend Developer', company: 'OldCorp', reason: 'rejected', appliedAt: now - 60 * DAY, closedAt: now - 30 * DAY, salary: '35k-42k€', notes: 'Cercavano più esperienza React Native' },
    { id: 'ar2', jobTitle: 'Full Stack Engineer', company: 'SmallStartup', reason: 'withdrawn', appliedAt: now - 45 * DAY, closedAt: now - 20 * DAY, notes: 'Ritirata dopo offerta migliore' },
    { id: 'ar3', jobTitle: 'Backend Developer', company: 'MediumInc', reason: 'expired', appliedAt: now - 90 * DAY, closedAt: now - 50 * DAY, salary: '40k-48k€' },
    { id: 'ar4', jobTitle: 'DevOps Engineer', company: 'CloudOld', reason: 'rejected', appliedAt: now - 40 * DAY, closedAt: now - 15 * DAY, salary: '42k-50k€', notes: 'Posizione congelata internamente' },
    { id: 'ar5', jobTitle: 'Data Analyst', company: 'DataCo', reason: 'withdrawn', appliedAt: now - 55 * DAY, closedAt: now - 25 * DAY },
    { id: 'ar6', jobTitle: 'QA Engineer', company: 'TestHouse', reason: 'expired', appliedAt: now - 80 * DAY, closedAt: now - 45 * DAY, salary: '32k-38k€' },
    { id: 'ar7', jobTitle: 'Platform Engineer', company: 'InfraCorp', reason: 'rejected', appliedAt: now - 35 * DAY, closedAt: now - 10 * DAY, salary: '45k-55k€', notes: 'Passato al secondo round ma non al terzo' },
  ];
}

export async function GET(req: Request) {
  let items = load();
  if (!items.length) { items = sampleArchive(); save(items); }
  const url = new URL(req.url);
  const reason = url.searchParams.get('reason') ?? undefined;
  let filtered = items;
  if (reason) filtered = filtered.filter(a => a.reason === reason);
  filtered.sort((a, b) => b.closedAt - a.closedAt);
  const counts = { rejected: items.filter(a => a.reason === 'rejected').length, expired: items.filter(a => a.reason === 'expired').length, withdrawn: items.filter(a => a.reason === 'withdrawn').length };
  return NextResponse.json({ archive: filtered, total: items.length, counts });
}

export async function DELETE(req: Request) {
  try {
    const { ids } = await req.json() as { ids: string[] };
    if (!ids?.length) return NextResponse.json({ error: 'IDs richiesti' }, { status: 400 });
    let items = load();
    items = items.filter(a => !ids.includes(a.id));
    save(items);
    return NextResponse.json({ deleted: ids.length, remaining: items.length });
  } catch (err) { return sanitizedError(err, { scope: 'archive' }); }
}
