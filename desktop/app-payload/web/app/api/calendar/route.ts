/**
 * API Calendar — eventi mese: colloqui, deadline candidature, follow-up
 */
import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const dynamic = 'force-dynamic';

type CalEvent = { id: string; title: string; type: 'interview' | 'deadline' | 'follow-up'; date: number; company: string; details: string };

const INT_PATH = path.join(os.homedir(), '.jht', 'interviews.json');
const APPS_PATH = path.join(os.homedir(), '.jht', 'applications.json');
const CONTACTS_PATH = path.join(os.homedir(), '.jht', 'contacts.json');

function loadJSON<T>(p: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return fallback; }
}

function getMonthRange(monthStr: string): [number, number] {
  const [y, m] = monthStr.split('-').map(Number);
  const start = new Date(y, m - 1, 1).getTime();
  const end = new Date(y, m, 1).getTime();
  return [start, end];
}

function buildEvents(start: number, end: number): CalEvent[] {
  const events: CalEvent[] = [];
  const interviews: Array<{ id: string; jobTitle: string; company: string; type: string; date: number; durationMin: number }> = loadJSON(INT_PATH, []);
  for (const i of interviews) {
    if (i.date >= start && i.date < end) {
      events.push({ id: `int-${i.id}`, title: `Colloquio: ${i.jobTitle}`, type: 'interview', date: i.date, company: i.company, details: `${i.type} · ${i.durationMin}min` });
    }
  }
  const apps: Array<{ id: string; jobTitle: string; company: string; sentAt: number; status: string }> = loadJSON(APPS_PATH, []);
  for (const a of apps) {
    if (a.status === 'sent' || a.status === 'viewed') {
      const followUp = a.sentAt + 7 * 86400000;
      if (followUp >= start && followUp < end) {
        events.push({ id: `fu-${a.id}`, title: `Follow-up: ${a.jobTitle}`, type: 'follow-up', date: followUp, company: a.company, details: `Candidatura inviata ${Math.round((followUp - a.sentAt) / 86400000)}g fa` });
      }
    }
  }
  const contacts: Array<{ id: string; name: string; company: string; lastContact: number | null }> = loadJSON(CONTACTS_PATH, []);
  for (const c of contacts) {
    if (c.lastContact) {
      const recontact = c.lastContact + 14 * 86400000;
      if (recontact >= start && recontact < end) {
        events.push({ id: `rc-${c.id}`, title: `Ricontatta: ${c.name}`, type: 'follow-up', date: recontact, company: c.company, details: 'Programmato ricontatto' });
      }
    }
  }
  // Sample events if empty
  if (events.length === 0) {
    const now = Date.now(); const day = 86400000;
    events.push(
      { id: 'ev-s1', title: 'Colloquio TechCorp', type: 'interview', date: now + 3 * day, company: 'TechCorp', details: 'video · 60min' },
      { id: 'ev-s2', title: 'Follow-up DataFlow', type: 'follow-up', date: now + 5 * day, company: 'DataFlow', details: 'Candidatura 7g fa' },
      { id: 'ev-s3', title: 'Take-home ScaleUp', type: 'interview', date: now + 7 * day, company: 'ScaleUp', details: 'take-home · 240min' },
      { id: 'ev-s4', title: 'Colloquio FinTech', type: 'interview', date: now + 10 * day, company: 'FinTech Co', details: 'video · 60min' },
    );
  }
  return events.filter(e => e.date >= start && e.date < end).sort((a, b) => a.date - b.date);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const now = new Date();
  const month = searchParams.get('month') ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [start, end] = getMonthRange(month);
  const events = buildEvents(start, end);
  return NextResponse.json({ events, month, total: events.length });
}
