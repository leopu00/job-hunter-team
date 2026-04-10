/**
 * API Jobs — lista offerte lavoro con stato candidatura, filtri, search
 */
import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { JHT_HOME } from '@/lib/jht-paths'

export const dynamic = 'force-dynamic';

type JobStatus = 'saved' | 'applied' | 'interview' | 'rejected' | 'offer';
type Job = { id: string; title: string; company: string; location: string; salaryMin: number; salaryMax: number; currency: string; status: JobStatus; source: string; url: string; addedAt: number; updatedAt: number };

const JOBS_PATH = path.join(JHT_HOME, 'jobs.json');

function loadJobs(): Job[] {
  try { return JSON.parse(fs.readFileSync(JOBS_PATH, 'utf-8')); }
  catch { return []; }
}

function generateSampleJobs(): Job[] {
  const now = Date.now();
  return [
    { id: 'job-001', title: 'Senior Full Stack Developer', company: 'TechCorp', location: 'Milano, IT (remote)', salaryMin: 45000, salaryMax: 60000, currency: 'EUR', status: 'interview', source: 'LinkedIn', url: '', addedAt: now - 604800000, updatedAt: now - 86400000 },
    { id: 'job-002', title: 'Backend Engineer', company: 'DataFlow', location: 'Roma, IT', salaryMin: 40000, salaryMax: 55000, currency: 'EUR', status: 'applied', source: 'LinkedIn', url: '', addedAt: now - 432000000, updatedAt: now - 172800000 },
    { id: 'job-003', title: 'React Developer', company: 'WebStudio', location: 'Remote EU', salaryMin: 50000, salaryMax: 70000, currency: 'EUR', status: 'saved', source: 'Indeed', url: '', addedAt: now - 259200000, updatedAt: now - 259200000 },
    { id: 'job-004', title: 'DevOps Engineer', company: 'CloudNine', location: 'Torino, IT', salaryMin: 42000, salaryMax: 58000, currency: 'EUR', status: 'rejected', source: 'Glassdoor', url: '', addedAt: now - 1209600000, updatedAt: now - 345600000 },
    { id: 'job-005', title: 'Full Stack TypeScript', company: 'StartupXYZ', location: 'Milano, IT (hybrid)', salaryMin: 48000, salaryMax: 65000, currency: 'EUR', status: 'offer', source: 'LinkedIn', url: '', addedAt: now - 1814400000, updatedAt: now - 43200000 },
    { id: 'job-006', title: 'Node.js Backend Lead', company: 'FinTech Co', location: 'Remote', salaryMin: 55000, salaryMax: 75000, currency: 'EUR', status: 'applied', source: 'AngelList', url: '', addedAt: now - 172800000, updatedAt: now - 172800000 },
    { id: 'job-007', title: 'Software Engineer', company: 'BigCorp', location: 'Bologna, IT', salaryMin: 35000, salaryMax: 50000, currency: 'EUR', status: 'saved', source: 'LinkedIn', url: '', addedAt: now - 86400000, updatedAt: now - 86400000 },
    { id: 'job-008', title: 'Platform Engineer', company: 'ScaleUp', location: 'Remote EU', salaryMin: 60000, salaryMax: 80000, currency: 'EUR', status: 'interview', source: 'Hired', url: '', addedAt: now - 518400000, updatedAt: now - 7200000 },
  ];
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') as JobStatus | null;
  const search = searchParams.get('q')?.toLowerCase();
  let jobs = loadJobs();
  if (status) jobs = jobs.filter(j => j.status === status);
  if (search) jobs = jobs.filter(j => j.title.toLowerCase().includes(search) || j.company.toLowerCase().includes(search) || j.location.toLowerCase().includes(search));
  jobs.sort((a, b) => b.updatedAt - a.updatedAt);
  const counts: Record<string, number> = {};
  for (const j of loadJobs()) counts[j.status] = (counts[j.status] ?? 0) + 1;
  return NextResponse.json({ jobs, total: jobs.length, counts });
}
