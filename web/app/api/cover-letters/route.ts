/**
 * API Cover Letters — lista cover letter con preview, stato draft/final
 */
import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { JHT_HOME } from '@/lib/jht-paths'

export const dynamic = 'force-dynamic';

type CLStatus = 'draft' | 'final';
type CoverLetter = { id: string; title: string; jobTarget: string; company: string; template: string; status: CLStatus; content: string; createdAt: number; updatedAt: number; wordCount: number };

const CL_PATH = path.join(JHT_HOME, 'cover-letters.json');
const CL_DIR = path.join(JHT_HOME, 'cover-letters');

function loadCoverLetters(): CoverLetter[] {
  try { return JSON.parse(fs.readFileSync(CL_PATH, 'utf-8')); }
  catch { return scanDir() ?? []; }
}

function scanDir(): CoverLetter[] | null {
  try {
    const files = fs.readdirSync(CL_DIR).filter(f => f.endsWith('.md') || f.endsWith('.txt'));
    if (files.length === 0) return null;
    return files.map((f, i) => {
      const fp = path.join(CL_DIR, f);
      const content = fs.readFileSync(fp, 'utf-8');
      const stat = fs.statSync(fp);
      const name = f.replace(/\.(md|txt)$/, '');
      return { id: `cl-${i + 1}`, title: name, jobTarget: '—', company: '—', template: 'custom', status: 'final' as CLStatus, content, createdAt: stat.birthtimeMs, updatedAt: stat.mtimeMs, wordCount: content.split(/\s+/).length };
    });
  } catch { return null; }
}

function generateSample(): CoverLetter[] {
  const now = Date.now();
  return [
    { id: 'cl-001', title: 'Cover Letter TechCorp', jobTarget: 'Senior Full Stack Developer', company: 'TechCorp', template: 'professional', status: 'final', content: 'Gentile team TechCorp,\n\nScrivo per candidarmi alla posizione di Senior Full Stack Developer. Con oltre 5 anni di esperienza in React, Node.js e TypeScript, sono convinto di poter contribuire significativamente al vostro team.\n\nHo sviluppato applicazioni web scalabili gestendo team di 3-5 sviluppatori. La mia esperienza include architetture microservizi, CI/CD pipelines e ottimizzazione performance.\n\nCordiali saluti', createdAt: now - 604800000, updatedAt: now - 86400000, wordCount: 52 },
    { id: 'cl-002', title: 'Cover Letter DataFlow', jobTarget: 'Backend Engineer', company: 'DataFlow', template: 'technical', status: 'final', content: 'Gentile HR DataFlow,\n\nMi candido per la posizione di Backend Engineer. Specializzato in Node.js, PostgreSQL e architetture event-driven, ho progettato sistemi che gestiscono 10k+ richieste/secondo.\n\nSono particolarmente interessato alla vostra piattaforma di data processing.\n\nCordiali saluti', createdAt: now - 432000000, updatedAt: now - 432000000, wordCount: 38 },
    { id: 'cl-003', title: 'Cover Letter ScaleUp', jobTarget: 'Platform Engineer', company: 'ScaleUp', template: 'startup', status: 'draft', content: 'Ciao team ScaleUp,\n\nSono entusiasta della posizione Platform Engineer. La vostra mission di democratizzare [TODO: completare]. Ho esperienza con Kubernetes, Terraform e AWS.\n\n[BOZZA - da completare]', createdAt: now - 259200000, updatedAt: now - 172800000, wordCount: 28 },
    { id: 'cl-004', title: 'Cover Letter FinTech', jobTarget: 'Node.js Backend Lead', company: 'FinTech Co', template: 'professional', status: 'draft', content: 'Gentile team FinTech Co,\n\nMi candido per il ruolo di Backend Lead. [TODO: personalizzare per settore fintech].\n\nEsperienza: 5+ anni Node.js, team leadership, compliance.\n\n[BOZZA]', createdAt: now - 172800000, updatedAt: now - 86400000, wordCount: 22 },
  ];
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') as CLStatus | null;
  let letters = loadCoverLetters();
  if (status) letters = letters.filter(l => l.status === status);
  letters.sort((a, b) => b.updatedAt - a.updatedAt);
  const drafts = loadCoverLetters().filter(l => l.status === 'draft').length;
  const finals = loadCoverLetters().filter(l => l.status === 'final').length;
  return NextResponse.json({ letters, total: letters.length, drafts, finals });
}
