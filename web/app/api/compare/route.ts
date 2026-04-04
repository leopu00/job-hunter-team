/**
 * API Compare — comparatore offerte lavoro side-by-side
 */
import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const dynamic = 'force-dynamic';

type Job = { id: string; title: string; company: string; location: string; salary: { min: number; max: number; currency: string }; benefits: string[]; skills: string[]; rating: number; remote: boolean; type: string };

const FILE = path.join(os.homedir(), '.jht', 'jobs.json');

function loadJobs(): Job[] {
  try { const d = JSON.parse(fs.readFileSync(FILE, 'utf-8')); return Array.isArray(d) ? d : []; }
  catch { return []; }
}

function sampleJobs(): Job[] {
  return [
    { id: 'j1', title: 'Senior Full Stack Developer', company: 'TechCorp', location: 'Milano', salary: { min: 45000, max: 55000, currency: 'EUR' }, benefits: ['Smart working', 'Buoni pasto', 'Formazione', 'Assicurazione'], skills: ['React', 'Node.js', 'TypeScript', 'PostgreSQL'], rating: 4.2, remote: true, type: 'Full-time' },
    { id: 'j2', title: 'Backend Engineer', company: 'StartupXYZ', location: 'Roma', salary: { min: 38000, max: 48000, currency: 'EUR' }, benefits: ['Stock options', 'Remoto 100%', 'Hardware budget'], skills: ['Python', 'Django', 'AWS', 'Docker'], rating: 3.8, remote: true, type: 'Full-time' },
    { id: 'j3', title: 'Frontend Developer', company: 'DesignStudio', location: 'Torino', salary: { min: 35000, max: 42000, currency: 'EUR' }, benefits: ['Orario flessibile', 'Buoni pasto', 'Palestra'], skills: ['React', 'CSS', 'Figma', 'Next.js'], rating: 4.5, remote: false, type: 'Full-time' },
    { id: 'j4', title: 'DevOps Engineer', company: 'CloudInc', location: 'Bologna', salary: { min: 42000, max: 52000, currency: 'EUR' }, benefits: ['Full remote', 'Formazione AWS', 'Bonus annuale'], skills: ['Kubernetes', 'Terraform', 'CI/CD', 'Linux'], rating: 4.0, remote: true, type: 'Full-time' },
    { id: 'j5', title: 'Data Engineer', company: 'BigFinance', location: 'Milano', salary: { min: 50000, max: 65000, currency: 'EUR' }, benefits: ['Bonus performance', 'Mensa', 'Assicurazione', 'Auto aziendale'], skills: ['Spark', 'Python', 'SQL', 'Airflow'], rating: 3.5, remote: false, type: 'Full-time' },
  ];
}

export async function GET() {
  let jobs = loadJobs();
  if (!jobs.length) jobs = sampleJobs();
  return NextResponse.json({ jobs: jobs.map(j => ({ id: j.id, title: j.title, company: j.company })) });
}

export async function POST(req: Request) {
  try {
    const { ids } = await req.json() as { ids: string[] };
    if (!ids?.length || ids.length < 2 || ids.length > 3) return NextResponse.json({ error: 'Seleziona 2-3 offerte da comparare' }, { status: 400 });
    let jobs = loadJobs();
    if (!jobs.length) jobs = sampleJobs();
    const selected = ids.map(id => jobs.find(j => j.id === id)).filter(Boolean) as Job[];
    if (selected.length < 2) return NextResponse.json({ error: 'Offerte non trovate' }, { status: 404 });
    const maxSalary = Math.max(...selected.map(j => j.salary.max));
    const comparison = selected.map(j => ({
      ...j,
      salaryScore: Math.round(j.salary.max / maxSalary * 100),
      benefitCount: j.benefits.length,
      skillCount: j.skills.length,
    }));
    return NextResponse.json({ comparison });
  } catch (err) { return NextResponse.json({ error: String(err) }, { status: 500 }); }
}
