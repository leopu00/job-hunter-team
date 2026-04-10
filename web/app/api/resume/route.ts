/**
 * API Resume — salva/carica dati CV per resume builder
 */
import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { JHT_HOME } from '@/lib/jht-paths'

export const dynamic = 'force-dynamic';

type ResumeData = { personal: Record<string, string>; experience: Array<Record<string, string>>; education: Array<Record<string, string>>; skills: string[]; languages: Array<Record<string, string>>; updatedAt: number };

const RESUME_PATH = path.join(JHT_HOME, 'resume.json');

function loadResume(): ResumeData {
  try { return JSON.parse(fs.readFileSync(RESUME_PATH, 'utf-8')); }
  catch { return defaultResume(); }
}

function saveResume(data: ResumeData): void {
  const dir = path.dirname(RESUME_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = RESUME_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, RESUME_PATH);
}

function defaultResume(): ResumeData {
  return {
    personal: { nome: '', cognome: '', email: '', telefono: '', citta: '', titolo: '' },
    experience: [{ azienda: 'TechCorp', ruolo: 'Full Stack Developer', periodo: '2021 - presente', descrizione: 'Sviluppo applicazioni web con React, Node.js, TypeScript.' }],
    education: [{ istituto: 'Università degli Studi', titolo: 'Laurea in Informatica', anno: '2020' }],
    skills: ['JavaScript', 'TypeScript', 'React', 'Node.js', 'PostgreSQL', 'Docker', 'Git'],
    languages: [{ lingua: 'Italiano', livello: 'Madrelingua' }, { lingua: 'Inglese', livello: 'C1' }],
    updatedAt: Date.now(),
  };
}

export async function GET() {
  return NextResponse.json(loadResume());
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const data: ResumeData = { personal: body.personal ?? {}, experience: body.experience ?? [], education: body.education ?? [], skills: body.skills ?? [], languages: body.languages ?? [], updatedAt: Date.now() };
    saveResume(data);
    return NextResponse.json({ ok: true, updatedAt: data.updatedAt });
  } catch (err) { return NextResponse.json({ error: String(err) }, { status: 500 }); }
}
