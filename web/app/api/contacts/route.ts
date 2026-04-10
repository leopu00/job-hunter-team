/**
 * API Contacts — CRM contatti professionali CRUD
 */
import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export const dynamic = 'force-dynamic';

type Contact = { id: string; name: string; company: string; role: string; email: string; linkedin: string; notes: string; lastContact: number | null; createdAt: number };

const CONTACTS_PATH = path.join(os.homedir(), '.jht', 'contacts.json');

function load(): Contact[] {
  try { return JSON.parse(fs.readFileSync(CONTACTS_PATH, 'utf-8')); }
  catch { return []; }
}

function save(data: Contact[]): void {
  const dir = path.dirname(CONTACTS_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = CONTACTS_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, CONTACTS_PATH);
}

function generateSample(): Contact[] {
  const now = Date.now(); const day = 86400000;
  return [
    { id: 'ct-001', name: 'Marco Rossi', company: 'TechCorp', role: 'Engineering Manager', email: 'marco@techcorp.it', linkedin: '', notes: 'Incontrato a conferenza React. Interessato al mio profilo.', lastContact: now - 3 * day, createdAt: now - 30 * day },
    { id: 'ct-002', name: 'Laura Bianchi', company: 'ScaleUp', role: 'CTO', email: 'laura@scaleup.io', linkedin: '', notes: 'Referral da amico comune. Colloquio in corso.', lastContact: now - day, createdAt: now - 15 * day },
    { id: 'ct-003', name: 'Andrea Verdi', company: 'DataFlow', role: 'HR Lead', email: 'andrea@dataflow.com', linkedin: '', notes: 'Primo contatto via LinkedIn.', lastContact: now - 7 * day, createdAt: now - 20 * day },
    { id: 'ct-004', name: 'Sara Neri', company: 'FinTech Co', role: 'Tech Recruiter', email: 'sara@fintech.co', linkedin: '', notes: 'Mi ha contattata per posizione Backend Lead.', lastContact: now - 2 * day, createdAt: now - 10 * day },
    { id: 'ct-005', name: 'Luca Gialli', company: 'StartupXYZ', role: 'Co-founder', email: 'luca@startupxyz.com', linkedin: '', notes: 'Offerta ricevuta. Ottimo rapporto.', lastContact: now - 5 * day, createdAt: now - 60 * day },
  ];
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q')?.toLowerCase();
  let contacts = load();
  if (q) contacts = contacts.filter(c => c.name.toLowerCase().includes(q) || c.company.toLowerCase().includes(q) || c.role.toLowerCase().includes(q));
  contacts.sort((a, b) => (b.lastContact ?? 0) - (a.lastContact ?? 0));
  return NextResponse.json({ contacts, total: contacts.length });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const contact: Contact = { id: `ct-${crypto.randomBytes(4).toString('hex')}`, name: body.name ?? '', company: body.company ?? '', role: body.role ?? '', email: body.email ?? '', linkedin: body.linkedin ?? '', notes: body.notes ?? '', lastContact: null, createdAt: Date.now() };
    if (!contact.name) return NextResponse.json({ error: 'Nome richiesto' }, { status: 400 });
    const contacts = load(); contacts.push(contact); save(contacts);
    return NextResponse.json({ ok: true, contact });
  } catch (err) { return NextResponse.json({ error: String(err) }, { status: 500 }); }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const { id, ...updates } = body as { id: string; [k: string]: unknown };
    if (!id) return NextResponse.json({ error: 'id richiesto' }, { status: 400 });
    const contacts = load(); const ct = contacts.find(c => c.id === id);
    if (!ct) return NextResponse.json({ error: 'Contatto non trovato' }, { status: 404 });
    Object.assign(ct, updates);
    save(contacts);
    return NextResponse.json({ ok: true, contact: ct });
  } catch (err) { return NextResponse.json({ error: String(err) }, { status: 500 }); }
}

export async function DELETE(req: Request) {
  try {
    const { id } = await req.json() as { id: string };
    if (!id) return NextResponse.json({ error: 'id richiesto' }, { status: 400 });
    const contacts = load(); const idx = contacts.findIndex(c => c.id === id);
    if (idx === -1) return NextResponse.json({ error: 'Contatto non trovato' }, { status: 404 });
    contacts.splice(idx, 1); save(contacts);
    return NextResponse.json({ ok: true });
  } catch (err) { return NextResponse.json({ error: String(err) }, { status: 500 }); }
}
