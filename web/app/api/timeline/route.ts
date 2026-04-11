/**
 * API Timeline — cronologia globale job hunting con eventi da più fonti
 */
import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { JHT_HOME } from '@/lib/jht-paths'

export const dynamic = 'force-dynamic';

type EventType = 'application' | 'interview' | 'offer' | 'follow-up' | 'contact' | 'update';
type TimelineEvent = { id: string; type: EventType; title: string; description: string; company?: string; date: number };

const DATA = JHT_HOME;

function loadJson(file: string): unknown[] {
  try { const d = JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf-8')); return Array.isArray(d) ? d : []; }
  catch { return []; }
}

function buildEvents(): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  let idx = 0;
  const apps = loadJson('applications.json') as { id?: string; jobTitle?: string; company?: string; status?: string; timeline?: { status: string; date: number }[] }[];
  for (const a of apps) {
    for (const t of (a.timeline ?? [])) {
      const typeMap: Record<string, EventType> = { sent: 'application', viewed: 'application', interview: 'interview', offer: 'offer' };
      events.push({ id: `a${idx++}`, type: typeMap[t.status] ?? 'application', title: `${t.status === 'sent' ? 'Candidatura inviata' : t.status === 'viewed' ? 'CV visualizzato' : t.status === 'interview' ? 'Colloquio' : t.status === 'offer' ? 'Offerta ricevuta' : t.status} — ${a.jobTitle ?? 'Posizione'}`, description: a.company ?? '', company: a.company, date: t.date });
    }
  }
  const contacts = loadJson('contacts.json') as { name?: string; company?: string; lastContact?: number }[];
  for (const c of contacts) {
    if (c.lastContact) events.push({ id: `c${idx++}`, type: 'contact', title: `Contatto con ${c.name}`, description: c.company ?? '', company: c.company, date: c.lastContact });
  }
  const reminders = loadJson('reminders.json') as { id?: string; title?: string; type?: string; company?: string; dueDate?: number; status?: string }[];
  for (const r of reminders) {
    if (r.status === 'done' && r.dueDate) events.push({ id: `r${idx++}`, type: 'follow-up', title: r.title ?? 'Follow-up', description: r.company ?? '', company: r.company, date: r.dueDate });
  }
  return events;
}

function sampleEvents(): TimelineEvent[] {
  const now = Date.now(), DAY = 86400000;
  return [
    { id: 's1', type: 'application', title: 'Candidatura inviata — Full Stack Developer', description: 'TechCorp', company: 'TechCorp', date: now - 1 * DAY },
    { id: 's2', type: 'interview', title: 'Colloquio tecnico completato', description: 'StartupXYZ — 2° round', company: 'StartupXYZ', date: now - 2 * DAY },
    { id: 's3', type: 'follow-up', title: 'Follow-up inviato', description: 'CloudInc — dopo colloquio', company: 'CloudInc', date: now - 3 * DAY },
    { id: 's4', type: 'offer', title: 'Offerta ricevuta', description: 'BigFinance — 55k€', company: 'BigFinance', date: now - 4 * DAY },
    { id: 's5', type: 'application', title: 'CV visualizzato', description: 'DesignStudio', company: 'DesignStudio', date: now - 5 * DAY },
    { id: 's6', type: 'contact', title: 'Contatto con Marco Bianchi', description: 'TechCorp — Engineering Manager', company: 'TechCorp', date: now - 6 * DAY },
    { id: 's7', type: 'update', title: 'CV aggiornato', description: 'Aggiunta sezione progetti', date: now - 7 * DAY },
    { id: 's8', type: 'application', title: 'Candidatura inviata — Backend Engineer', description: 'ScaleUp', company: 'ScaleUp', date: now - 8 * DAY },
    { id: 's9', type: 'interview', title: 'Colloquio HR', description: 'DesignStudio — 1° round', company: 'DesignStudio', date: now - 10 * DAY },
    { id: 's10', type: 'follow-up', title: 'Follow-up secondo colloquio', description: 'StartupXYZ', company: 'StartupXYZ', date: now - 12 * DAY },
  ];
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const typeFilter = url.searchParams.get('type') ?? undefined;
  const days = parseInt(url.searchParams.get('days') ?? '30', 10);
  let events = buildEvents();
  if (!events.length) events = sampleEvents();
  const cutoff = Date.now() - days * 86400000;
  events = events.filter(e => e.date >= cutoff);
  if (typeFilter) events = events.filter(e => e.type === typeFilter);
  events.sort((a, b) => b.date - a.date);
  const types = ['application', 'interview', 'offer', 'follow-up', 'contact', 'update'];
  return NextResponse.json({ events, total: events.length, types });
}
