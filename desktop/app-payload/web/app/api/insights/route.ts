/**
 * API Insights — analytics avanzate: tempo per fase, tasso risposta, trend salari, best timing
 */
import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const dynamic = 'force-dynamic';

const DATA = path.join(os.homedir(), '.jht');

function loadJson(file: string): unknown[] {
  try { const d = JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf-8')); return Array.isArray(d) ? d : []; }
  catch { return []; }
}

type App = { status: string; company?: string; sector?: string; salary?: { min?: number; max?: number }; appliedAt?: number; timeline?: { status: string; date: number }[] };

function computePhaseTimings(apps: App[]): { phase: string; avgDays: number }[] {
  const PHASES = ['sent', 'viewed', 'interview', 'offer'];
  const results: { phase: string; avgDays: number }[] = [];
  for (const phase of PHASES) {
    const durations: number[] = [];
    for (const app of apps) {
      const tl = app.timeline ?? [];
      const start = tl.find(e => e.status === 'sent');
      const end = tl.find(e => e.status === phase);
      if (start && end && end.date > start.date) durations.push((end.date - start.date) / 86400000);
    }
    if (durations.length) results.push({ phase, avgDays: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) });
  }
  return results;
}

function computeResponseRate(apps: App[]): { sector: string; total: number; responded: number; rate: number }[] {
  const map = new Map<string, { total: number; responded: number }>();
  for (const a of apps) {
    const s = a.sector ?? 'Altro';
    const entry = map.get(s) ?? { total: 0, responded: 0 };
    entry.total++;
    if (['viewed', 'interview', 'offer'].includes(a.status)) entry.responded++;
    map.set(s, entry);
  }
  return [...map.entries()].map(([sector, d]) => ({ sector, ...d, rate: Math.round(d.responded / d.total * 100) })).sort((a, b) => b.rate - a.rate);
}

function computeSalaryTrend(apps: App[]): { month: string; avg: number }[] {
  const map = new Map<string, number[]>();
  for (const a of apps) {
    if (!a.salary?.min || !a.appliedAt) continue;
    const avg = ((a.salary.min ?? 0) + (a.salary.max ?? a.salary.min ?? 0)) / 2;
    const m = new Date(a.appliedAt).toISOString().slice(0, 7);
    const arr = map.get(m) ?? [];
    arr.push(avg);
    map.set(m, arr);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, vals]) => ({ month, avg: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) }));
}

function computeBestDays(apps: App[]): { day: string; count: number }[] {
  const DAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
  const counts = new Array(7).fill(0);
  const responded = apps.filter(a => ['viewed', 'interview', 'offer'].includes(a.status));
  for (const a of responded) { if (a.appliedAt) counts[((new Date(a.appliedAt).getDay() + 6) % 7)]++; }
  return DAYS.map((day, i) => ({ day, count: counts[i] }));
}

function sampleApps(): App[] {
  const sectors = ['Tech', 'Finance', 'Healthcare', 'Startup', 'Consulting'];
  const statuses = ['sent', 'viewed', 'interview', 'offer', 'rejected'];
  const apps: App[] = [];
  for (let i = 0; i < 40; i++) {
    const base = Date.now() - (180 - i * 4) * 86400000;
    const sector = sectors[i % 5];
    const status = statuses[Math.min(Math.floor(Math.random() * 5), 4)];
    const tl = [{ status: 'sent', date: base }];
    if (['viewed', 'interview', 'offer'].includes(status)) tl.push({ status: 'viewed', date: base + 3 * 86400000 });
    if (['interview', 'offer'].includes(status)) tl.push({ status: 'interview', date: base + 10 * 86400000 });
    if (status === 'offer') tl.push({ status: 'offer', date: base + 20 * 86400000 });
    apps.push({ status, company: `Company ${i}`, sector, salary: { min: 30000 + i * 500, max: 40000 + i * 600 }, appliedAt: base, timeline: tl });
  }
  return apps;
}

export async function GET() {
  let apps = loadJson('applications.json') as App[];
  if (!apps.length) apps = sampleApps();
  const total = apps.length;
  const active = apps.filter(a => !['rejected', 'offer'].includes(a.status)).length;
  const offers = apps.filter(a => a.status === 'offer').length;
  const responseRate = apps.length ? Math.round(apps.filter(a => a.status !== 'sent').length / apps.length * 100) : 0;
  return NextResponse.json({
    summary: { total, active, offers, responseRate },
    phaseTimings: computePhaseTimings(apps),
    responseBySector: computeResponseRate(apps),
    salaryTrend: computeSalaryTrend(apps),
    bestDays: computeBestDays(apps),
  });
}
