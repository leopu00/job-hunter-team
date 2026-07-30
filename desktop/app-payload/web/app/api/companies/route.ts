/**
 * API Companies — database aziende con settore, rating, posizioni aperte
 */
import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const dynamic = 'force-dynamic';

type CompanySize = 'startup' | 'small' | 'medium' | 'large' | 'enterprise';
type HistoryEntry = { jobTitle: string; status: string; date: number };
type Company = { id: string; name: string; sector: string; size: CompanySize; location: string; rating: number; openPositions: number; notes: string; website: string; history: HistoryEntry[]; addedAt: number };

const COMPANIES_PATH = path.join(os.homedir(), '.jht', 'companies.json');

function loadCompanies(): Company[] {
  try { return JSON.parse(fs.readFileSync(COMPANIES_PATH, 'utf-8')); }
  catch { return generateSample(); }
}

function generateSample(): Company[] {
  const now = Date.now();
  const day = 86400000;
  return [
    { id: 'co-001', name: 'TechCorp', sector: 'Software', size: 'large', location: 'Milano, IT', rating: 4.2, openPositions: 3, notes: 'Buona cultura tech, processo lungo', website: '', history: [{ jobTitle: 'Senior Full Stack Developer', status: 'interview', date: now - 7 * day }], addedAt: now - 30 * day },
    { id: 'co-002', name: 'DataFlow', sector: 'Data/Analytics', size: 'medium', location: 'Roma, IT', rating: 3.8, openPositions: 2, notes: 'Stack interessante, team giovane', website: '', history: [{ jobTitle: 'Backend Engineer', status: 'applied', date: now - 5 * day }], addedAt: now - 20 * day },
    { id: 'co-003', name: 'StartupXYZ', sector: 'SaaS', size: 'startup', location: 'Milano, IT', rating: 4.5, openPositions: 5, notes: 'Velocissimi, offerta ricevuta', website: '', history: [{ jobTitle: 'Full Stack TypeScript', status: 'offer', date: now - day }], addedAt: now - 60 * day },
    { id: 'co-004', name: 'CloudNine', sector: 'Cloud/Infra', size: 'medium', location: 'Torino, IT', rating: 3.5, openPositions: 1, notes: 'Cercano profili molto specializzati', website: '', history: [{ jobTitle: 'DevOps Engineer', status: 'rejected', date: now - 4 * day }], addedAt: now - 40 * day },
    { id: 'co-005', name: 'ScaleUp', sector: 'Platform', size: 'small', location: 'Remote EU', rating: 4.7, openPositions: 4, notes: 'Full remote, ottimo compensation', website: '', history: [{ jobTitle: 'Platform Engineer', status: 'interview', date: now - day }], addedAt: now - 15 * day },
    { id: 'co-006', name: 'FinTech Co', sector: 'Fintech', size: 'large', location: 'Remote', rating: 4.0, openPositions: 2, notes: 'Settore regolamentato, processi strutturati', website: '', history: [{ jobTitle: 'Node.js Backend Lead', status: 'applied', date: now - 2 * day }], addedAt: now - 10 * day },
    { id: 'co-007', name: 'WebStudio', sector: 'Agency', size: 'small', location: 'Remote EU', rating: 3.9, openPositions: 1, notes: 'Progetti diversificati, ritmo veloce', website: '', history: [], addedAt: now - 5 * day },
    { id: 'co-008', name: 'BigCorp', sector: 'Enterprise', size: 'enterprise', location: 'Bologna, IT', rating: 3.2, openPositions: 8, notes: 'Burocrazia alta, stabilità', website: '', history: [], addedAt: now - 3 * day },
  ];
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sector = searchParams.get('sector');
  const search = searchParams.get('q')?.toLowerCase();
  let companies = loadCompanies();
  if (sector) companies = companies.filter(c => c.sector === sector);
  if (search) companies = companies.filter(c => c.name.toLowerCase().includes(search) || c.sector.toLowerCase().includes(search));
  companies.sort((a, b) => b.rating - a.rating);
  const sectors = [...new Set(loadCompanies().map(c => c.sector))].sort();
  const totalPositions = companies.reduce((s, c) => s + c.openPositions, 0);
  return NextResponse.json({ companies, total: companies.length, sectors, totalPositions });
}
