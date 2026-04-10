/**
 * API Interviews — tracking colloqui con tipo, data/ora, outcome
 */
import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { JHT_HOME } from '@/lib/jht-paths'

export const dynamic = 'force-dynamic';

type InterviewType = 'phone' | 'video' | 'onsite' | 'take-home';
type Outcome = 'pending' | 'passed' | 'failed';
type Interview = { id: string; jobTitle: string; company: string; type: InterviewType; date: number; durationMin: number; outcome: Outcome; notes: string; round: number };

const INT_PATH = path.join(JHT_HOME, 'interviews.json');

function loadInterviews(): Interview[] {
  try { return JSON.parse(fs.readFileSync(INT_PATH, 'utf-8')); }
  catch { return generateSample(); }
}

function generateSample(): Interview[] {
  const now = Date.now();
  const day = 86400000;
  return [
    { id: 'int-001', jobTitle: 'Senior Full Stack Developer', company: 'TechCorp', type: 'video', date: now - 2 * day, durationMin: 60, outcome: 'passed', notes: 'Colloquio tecnico — React, Node.js, system design. Buon feeling con il team.', round: 1 },
    { id: 'int-002', jobTitle: 'Senior Full Stack Developer', company: 'TechCorp', type: 'onsite', date: now + 3 * day, durationMin: 180, outcome: 'pending', notes: 'Final round — pair programming + meet the team.', round: 2 },
    { id: 'int-003', jobTitle: 'Platform Engineer', company: 'ScaleUp', type: 'video', date: now - day, durationMin: 45, outcome: 'passed', notes: 'System design round — distributed systems, caching strategies.', round: 2 },
    { id: 'int-004', jobTitle: 'Platform Engineer', company: 'ScaleUp', type: 'take-home', date: now + 5 * day, durationMin: 240, outcome: 'pending', notes: 'Take-home assignment — build a mini load balancer.', round: 3 },
    { id: 'int-005', jobTitle: 'Full Stack TypeScript', company: 'StartupXYZ', type: 'video', date: now - 14 * day, durationMin: 60, outcome: 'passed', notes: 'Cultura + tech fit. Molto informale.', round: 1 },
    { id: 'int-006', jobTitle: 'Full Stack TypeScript', company: 'StartupXYZ', type: 'video', date: now - 7 * day, durationMin: 90, outcome: 'passed', notes: 'Deep dive architettura. Ricevuta offerta dopo.', round: 2 },
    { id: 'int-007', jobTitle: 'DevOps Engineer', company: 'CloudNine', type: 'phone', date: now - 10 * day, durationMin: 30, outcome: 'failed', notes: 'HR screening — cercano più esperienza cloud specifica.', round: 1 },
    { id: 'int-008', jobTitle: 'Node.js Backend Lead', company: 'FinTech Co', type: 'video', date: now + 7 * day, durationMin: 60, outcome: 'pending', notes: 'Primo round tecnico programmato.', round: 1 },
  ];
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const outcome = searchParams.get('outcome') as Outcome | null;
  const type = searchParams.get('type') as InterviewType | null;
  let interviews = loadInterviews();
  if (outcome) interviews = interviews.filter(i => i.outcome === outcome);
  if (type) interviews = interviews.filter(i => i.type === type);
  interviews.sort((a, b) => a.date - b.date);
  const upcoming = interviews.filter(i => i.date > Date.now()).length;
  const passed = loadInterviews().filter(i => i.outcome === 'passed').length;
  return NextResponse.json({ interviews, total: interviews.length, upcoming, passed });
}
