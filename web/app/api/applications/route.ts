/**
 * API Applications — tracking candidature con stato, timeline, documenti
 */
import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const dynamic = 'force-dynamic';

type AppStatus = 'draft' | 'sent' | 'viewed' | 'interview' | 'offer' | 'rejected';
type TimelineEntry = { status: AppStatus; date: number; note?: string };
type Doc = { name: string; type: 'cv' | 'cover-letter' | 'portfolio' | 'other' };
type Application = { id: string; jobTitle: string; company: string; status: AppStatus; sentAt: number; updatedAt: number; docs: Doc[]; timeline: TimelineEntry[]; profileId: string };

const APPS_PATH = path.join(os.homedir(), '.jht', 'applications.json');

function loadApplications(): Application[] {
  try { return JSON.parse(fs.readFileSync(APPS_PATH, 'utf-8')); }
  catch { return generateSample(); }
}

function generateSample(): Application[] {
  const now = Date.now();
  const tl = (entries: Array<[AppStatus, number, string?]>): TimelineEntry[] => entries.map(([status, date, note]) => ({ status, date, ...(note ? { note } : {}) }));
  return [
    { id: 'app-001', jobTitle: 'Senior Full Stack Developer', company: 'TechCorp', status: 'interview', sentAt: now - 604800000, updatedAt: now - 86400000, docs: [{ name: 'CV_FullStack.pdf', type: 'cv' }, { name: 'CoverLetter_TechCorp.pdf', type: 'cover-letter' }],
      timeline: tl([['draft', now - 691200000], ['sent', now - 604800000, 'Inviata via LinkedIn'], ['viewed', now - 432000000], ['interview', now - 86400000, 'Primo colloquio tecnico']]), profileId: 'profile-main' },
    { id: 'app-002', jobTitle: 'Backend Engineer', company: 'DataFlow', status: 'sent', sentAt: now - 432000000, updatedAt: now - 432000000, docs: [{ name: 'CV_Backend.pdf', type: 'cv' }],
      timeline: tl([['draft', now - 518400000], ['sent', now - 432000000, 'Email diretta HR']]), profileId: 'profile-main' },
    { id: 'app-003', jobTitle: 'Full Stack TypeScript', company: 'StartupXYZ', status: 'offer', sentAt: now - 1814400000, updatedAt: now - 43200000, docs: [{ name: 'CV_FullStack.pdf', type: 'cv' }, { name: 'Portfolio.pdf', type: 'portfolio' }],
      timeline: tl([['draft', now - 1900800000], ['sent', now - 1814400000], ['viewed', now - 1728000000], ['interview', now - 1209600000, 'Colloquio tecnico + cultura'], ['offer', now - 43200000, 'Offerta 55k EUR']]), profileId: 'profile-main' },
    { id: 'app-004', jobTitle: 'DevOps Engineer', company: 'CloudNine', status: 'rejected', sentAt: now - 1209600000, updatedAt: now - 345600000, docs: [{ name: 'CV_DevOps.pdf', type: 'cv' }, { name: 'CoverLetter_CloudNine.pdf', type: 'cover-letter' }],
      timeline: tl([['draft', now - 1296000000], ['sent', now - 1209600000], ['viewed', now - 864000000], ['rejected', now - 345600000, 'Cercano più esperienza cloud']]), profileId: 'profile-main' },
    { id: 'app-005', jobTitle: 'Platform Engineer', company: 'ScaleUp', status: 'interview', sentAt: now - 518400000, updatedAt: now - 7200000, docs: [{ name: 'CV_FullStack.pdf', type: 'cv' }],
      timeline: tl([['draft', now - 604800000], ['sent', now - 518400000], ['viewed', now - 259200000], ['interview', now - 7200000, 'System design round']]), profileId: 'profile-main' },
    { id: 'app-006', jobTitle: 'Node.js Backend Lead', company: 'FinTech Co', status: 'viewed', sentAt: now - 172800000, updatedAt: now - 86400000, docs: [{ name: 'CV_Backend.pdf', type: 'cv' }, { name: 'CoverLetter_FinTech.pdf', type: 'cover-letter' }],
      timeline: tl([['draft', now - 259200000], ['sent', now - 172800000], ['viewed', now - 86400000]]), profileId: 'profile-main' },
  ];
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') as AppStatus | null;
  let apps = loadApplications();
  if (status) apps = apps.filter(a => a.status === status);
  apps.sort((a, b) => b.updatedAt - a.updatedAt);
  const counts: Record<string, number> = {};
  for (const a of loadApplications()) counts[a.status] = (counts[a.status] ?? 0) + 1;
  return NextResponse.json({ applications: apps, total: apps.length, counts });
}
