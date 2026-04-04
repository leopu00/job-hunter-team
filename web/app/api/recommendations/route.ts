/**
 * API Recommendations — job suggeriti, aziende consigliate, azioni prioritarie con score
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type JobRec = { id: string; title: string; company: string; location: string; score: number; reason: string; salary: string; remote: boolean };
type CompanyRec = { name: string; sector: string; score: number; reason: string; openPositions: number; rating: number };
type ActionRec = { id: string; action: string; target: string; priority: 'high' | 'medium' | 'low'; reason: string; deadline?: string };

function generateJobRecs(): JobRec[] {
  return [
    { id: 'r1', title: 'Senior Full Stack Developer', company: 'TechCorp', location: 'Milano', score: 95, reason: 'Match perfetto: React + Node.js + TypeScript nel tuo profilo', salary: '45k-55k€', remote: true },
    { id: 'r2', title: 'Lead Backend Engineer', company: 'ScaleUp', location: 'Roma', score: 88, reason: 'Esperienza backend allineata, crescita leadership', salary: '50k-60k€', remote: true },
    { id: 'r3', title: 'Platform Engineer', company: 'CloudNative', location: 'Bologna', score: 82, reason: 'Competenze infra + coding, ruolo ibrido adatto', salary: '42k-52k€', remote: true },
    { id: 'r4', title: 'Frontend Architect', company: 'DesignFirst', location: 'Torino', score: 78, reason: 'Forte esperienza React, portfolio progetti rilevante', salary: '48k-58k€', remote: false },
    { id: 'r5', title: 'Engineering Manager', company: 'BigFinance', location: 'Milano', score: 72, reason: 'Transizione management con background tecnico solido', salary: '55k-70k€', remote: false },
  ];
}

function generateCompanyRecs(): CompanyRec[] {
  return [
    { name: 'TechCorp', sector: 'SaaS B2B', score: 92, reason: 'Stack tecnologico allineato, cultura engineering forte', openPositions: 5, rating: 4.3 },
    { name: 'ScaleUp', sector: 'Fintech', score: 87, reason: 'Crescita rapida, team internazionale, equity package', openPositions: 3, rating: 4.1 },
    { name: 'CloudNative', sector: 'Infra/DevTools', score: 80, reason: 'Prodotto open-source, community attiva', openPositions: 2, rating: 4.5 },
    { name: 'DesignFirst', sector: 'Design/UX', score: 75, reason: 'Focus su qualità prodotto, team piccolo e autonomo', openPositions: 1, rating: 4.6 },
  ];
}

function generateActionRecs(): ActionRec[] {
  return [
    { id: 'a1', action: 'Candidati subito', target: 'Senior Full Stack @ TechCorp', priority: 'high', reason: 'Match 95%, posizione aperta da 2 giorni', deadline: '2026-04-10' },
    { id: 'a2', action: 'Follow-up', target: 'Backend Engineer @ StartupXYZ', priority: 'high', reason: 'Candidatura inviata 7 giorni fa, nessuna risposta' },
    { id: 'a3', action: 'Prepara colloquio', target: 'DevOps @ CloudInc', priority: 'medium', reason: 'Colloquio tecnico tra 3 giorni', deadline: '2026-04-07' },
    { id: 'a4', action: 'Aggiorna CV', target: 'Sezione progetti', priority: 'medium', reason: 'Ultimo aggiornamento 30+ giorni fa, aggiungi progetti recenti' },
    { id: 'a5', action: 'Espandi network', target: 'Settore Fintech', priority: 'low', reason: '0 contatti in fintech ma 3 candidature attive nel settore' },
  ];
}

export async function GET() {
  return NextResponse.json({
    jobs: generateJobRecs(),
    companies: generateCompanyRecs(),
    actions: generateActionRecs(),
    updatedAt: Date.now(),
  });
}
