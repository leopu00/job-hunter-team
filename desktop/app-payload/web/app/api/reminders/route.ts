/**
 * API Reminders — promemoria: follow-up candidatura, prep colloquio, scadenze offerte
 */
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const dynamic = 'force-dynamic';

type ReminderType = 'follow-up' | 'interview-prep' | 'offer-deadline' | 'custom';
type ReminderStatus = 'pending' | 'done' | 'snoozed';
type Reminder = { id: string; type: ReminderType; title: string; jobTitle?: string; company?: string; dueDate: number; status: ReminderStatus; note?: string; createdAt: number };

const FILE = path.join(os.homedir(), '.jht', 'reminders.json');

function load(): Reminder[] {
  try { const d = JSON.parse(fs.readFileSync(FILE, 'utf-8')); return Array.isArray(d) ? d : []; }
  catch { return []; }
}

function save(reminders: Reminder[]): void {
  const dir = path.dirname(FILE);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(reminders, null, 2), 'utf-8');
  fs.renameSync(tmp, FILE);
}

function sampleReminders(): Reminder[] {
  const now = Date.now(), DAY = 86400000;
  return [
    { id: 'r1', type: 'follow-up', title: 'Follow-up candidatura', jobTitle: 'Full Stack Developer', company: 'TechCorp', dueDate: now + 2 * DAY, status: 'pending', createdAt: now - 5 * DAY },
    { id: 'r2', type: 'interview-prep', title: 'Preparazione colloquio tecnico', jobTitle: 'Backend Engineer', company: 'StartupXYZ', dueDate: now + 1 * DAY, status: 'pending', note: 'Ripassare system design', createdAt: now - 3 * DAY },
    { id: 'r3', type: 'offer-deadline', title: 'Scadenza offerta', jobTitle: 'Senior Developer', company: 'BigFinance', dueDate: now + 4 * DAY, status: 'pending', createdAt: now - 1 * DAY },
    { id: 'r4', type: 'follow-up', title: 'Follow-up secondo colloquio', jobTitle: 'DevOps Engineer', company: 'CloudInc', dueDate: now - 1 * DAY, status: 'pending', createdAt: now - 8 * DAY },
    { id: 'r5', type: 'custom', title: 'Aggiornare portfolio GitHub', dueDate: now + 3 * DAY, status: 'done', createdAt: now - 7 * DAY },
    { id: 'r6', type: 'interview-prep', title: 'Prep colloquio HR', jobTitle: 'Frontend Dev', company: 'DesignStudio', dueDate: now + 5 * DAY, status: 'snoozed', createdAt: now - 2 * DAY },
  ];
}

export async function GET() {
  let reminders = load();
  if (!reminders.length) { reminders = sampleReminders(); save(reminders); }
  reminders.sort((a, b) => a.dueDate - b.dueDate);
  const pending = reminders.filter(r => r.status === 'pending').length;
  const overdue = reminders.filter(r => r.status === 'pending' && r.dueDate < Date.now()).length;
  const done = reminders.filter(r => r.status === 'done').length;
  return NextResponse.json({ reminders, summary: { total: reminders.length, pending, overdue, done } });
}

export async function POST(req: Request) {
  try {
    const { type, title, jobTitle, company, dueDate, note } = await req.json() as { type: ReminderType; title: string; jobTitle?: string; company?: string; dueDate: string; note?: string };
    if (!title?.trim() || !dueDate) return NextResponse.json({ error: 'Campi richiesti: title, dueDate' }, { status: 400 });
    const reminders = load();
    const reminder: Reminder = { id: crypto.randomBytes(6).toString('hex'), type: type ?? 'custom', title: title.trim(), jobTitle, company, dueDate: new Date(dueDate).getTime(), status: 'pending', note, createdAt: Date.now() };
    reminders.push(reminder);
    save(reminders);
    return NextResponse.json({ reminder });
  } catch (err) { return NextResponse.json({ error: String(err) }, { status: 500 }); }
}

export async function PUT(req: Request) {
  try {
    const { id, status } = await req.json() as { id: string; status: ReminderStatus };
    if (!id || !status) return NextResponse.json({ error: 'Campi richiesti: id, status' }, { status: 400 });
    const reminders = load();
    const rem = reminders.find(r => r.id === id);
    if (!rem) return NextResponse.json({ error: 'Reminder non trovato' }, { status: 404 });
    rem.status = status;
    save(reminders);
    return NextResponse.json({ reminder: rem });
  } catch (err) { return NextResponse.json({ error: String(err) }, { status: 500 }); }
}
