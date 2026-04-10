/**
 * API Goals — obiettivi job hunting con target, progresso, deadline, stato
 */
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { JHT_HOME } from '@/lib/jht-paths'

export const dynamic = 'force-dynamic';

type GoalStatus = 'on-track' | 'behind' | 'completed';
type Goal = { id: string; title: string; target: number; current: number; unit: string; deadline: string; status: GoalStatus; createdAt: number };

const FILE = path.join(JHT_HOME, 'goals.json');

function load(): Goal[] {
  try { const d = JSON.parse(fs.readFileSync(FILE, 'utf-8')); return Array.isArray(d) ? d : []; }
  catch { return []; }
}

function save(goals: Goal[]): void {
  const dir = path.dirname(FILE);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(goals, null, 2), 'utf-8');
  fs.renameSync(tmp, FILE);
}

function computeStatus(g: Goal): GoalStatus {
  if (g.current >= g.target) return 'completed';
  const now = Date.now(), dl = new Date(g.deadline).getTime(), created = g.createdAt;
  if (dl <= now) return 'behind';
  const elapsed = (now - created) / (dl - created);
  const progress = g.current / g.target;
  return progress >= elapsed * 0.8 ? 'on-track' : 'behind';
}

function sampleGoals(): Goal[] {
  const now = Date.now();
  return [
    { id: 'g1', title: '10 candidature a settimana', target: 10, current: 7, unit: 'candidature', deadline: '2026-04-11', status: 'on-track', createdAt: now - 4 * 86400000 },
    { id: 'g2', title: '3 colloqui questo mese', target: 3, current: 1, unit: 'colloqui', deadline: '2026-04-30', status: 'behind', createdAt: now - 10 * 86400000 },
    { id: 'g3', title: 'Aggiornare CV per ruoli backend', target: 1, current: 1, unit: 'versioni', deadline: '2026-04-07', status: 'completed', createdAt: now - 7 * 86400000 },
    { id: 'g4', title: '5 contatti networking nuovi', target: 5, current: 2, unit: 'contatti', deadline: '2026-04-15', status: 'on-track', createdAt: now - 5 * 86400000 },
    { id: 'g5', title: 'Completare portfolio progetti', target: 3, current: 0, unit: 'progetti', deadline: '2026-04-20', status: 'behind', createdAt: now - 3 * 86400000 },
  ];
}

export async function GET() {
  let goals = load();
  if (!goals.length) { goals = sampleGoals(); save(goals); }
  goals = goals.map(g => ({ ...g, status: computeStatus(g) }));
  const completed = goals.filter(g => g.status === 'completed').length;
  const onTrack = goals.filter(g => g.status === 'on-track').length;
  const behind = goals.filter(g => g.status === 'behind').length;
  return NextResponse.json({ goals, summary: { total: goals.length, completed, onTrack, behind } });
}

export async function POST(req: Request) {
  try {
    const { title, target, unit, deadline } = await req.json() as { title: string; target: number; unit: string; deadline: string };
    if (!title?.trim() || !target || !deadline) return NextResponse.json({ error: 'Campi richiesti: title, target, deadline' }, { status: 400 });
    const goals = load();
    const goal: Goal = { id: crypto.randomBytes(6).toString('hex'), title: title.trim(), target, current: 0, unit: unit ?? 'unità', deadline, status: 'on-track', createdAt: Date.now() };
    goals.push(goal);
    save(goals);
    return NextResponse.json({ goal });
  } catch (err) { return NextResponse.json({ error: String(err) }, { status: 500 }); }
}

export async function PUT(req: Request) {
  try {
    const { id, current, status } = await req.json() as { id: string; current?: number; status?: GoalStatus };
    if (!id) return NextResponse.json({ error: 'ID richiesto' }, { status: 400 });
    const goals = load();
    const goal = goals.find(g => g.id === id);
    if (!goal) return NextResponse.json({ error: 'Goal non trovato' }, { status: 404 });
    if (current !== undefined) goal.current = current;
    if (status) goal.status = status;
    goal.status = computeStatus(goal);
    save(goals);
    return NextResponse.json({ goal });
  } catch (err) { return NextResponse.json({ error: String(err) }, { status: 500 }); }
}
