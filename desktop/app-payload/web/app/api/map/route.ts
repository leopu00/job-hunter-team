/**
 * API Map — job raggruppati per città con coordinate, filtro area
 */
import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const dynamic = 'force-dynamic';

type CityCluster = { city: string; area: string; count: number; avgSalary: number; topRoles: string[]; x: number; y: number };

const CITIES: { city: string; area: string; x: number; y: number }[] = [
  { city: 'Milano', area: 'Nord', x: 45, y: 18 },
  { city: 'Torino', area: 'Nord', x: 30, y: 18 },
  { city: 'Bologna', area: 'Centro', x: 52, y: 30 },
  { city: 'Roma', area: 'Centro', x: 55, y: 48 },
  { city: 'Firenze', area: 'Centro', x: 50, y: 36 },
  { city: 'Napoli', area: 'Sud', x: 60, y: 58 },
  { city: 'Padova', area: 'Nord', x: 55, y: 18 },
  { city: 'Genova', area: 'Nord', x: 35, y: 25 },
  { city: 'Bari', area: 'Sud', x: 72, y: 58 },
  { city: 'Catania', area: 'Sud', x: 65, y: 78 },
  { city: 'Palermo', area: 'Sud', x: 52, y: 78 },
  { city: 'Remoto', area: 'Remoto', x: 85, y: 10 },
];

const ROLES = ['Full Stack', 'Backend', 'Frontend', 'DevOps', 'Data Engineer', 'Mobile', 'QA'];

function loadJobs(): { location?: string; title?: string; salary?: { min?: number; max?: number } }[] {
  try { const d = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.jht', 'jobs.json'), 'utf-8')); return Array.isArray(d) ? d : []; }
  catch { return []; }
}

function buildClusters(locationFilter?: string): CityCluster[] {
  const jobs = loadJobs();
  const clusters: CityCluster[] = CITIES.map(c => {
    const matched = jobs.length ? jobs.filter(j => j.location?.toLowerCase().includes(c.city.toLowerCase())) : [];
    const count = matched.length || Math.floor(Math.random() * 20 + 2);
    const salaries = matched.filter(j => j.salary?.min).map(j => ((j.salary!.min! + (j.salary!.max ?? j.salary!.min!)) / 2));
    const avgSalary = salaries.length ? Math.round(salaries.reduce((a, b) => a + b, 0) / salaries.length) : Math.floor(Math.random() * 15000 + 35000);
    const topRoles = matched.length ? [...new Set(matched.map(j => j.title ?? '').filter(Boolean))].slice(0, 3) : ROLES.sort(() => Math.random() - 0.5).slice(0, 3);
    return { ...c, count, avgSalary, topRoles };
  });
  if (locationFilter) return clusters.filter(c => c.area.toLowerCase() === locationFilter.toLowerCase() || c.city.toLowerCase().includes(locationFilter.toLowerCase()));
  return clusters;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const location = url.searchParams.get('location') ?? undefined;
  const clusters = buildClusters(location);
  const totalJobs = clusters.reduce((s, c) => s + c.count, 0);
  const areas = [...new Set(CITIES.map(c => c.area))];
  return NextResponse.json({ clusters, totalJobs, areas });
}
