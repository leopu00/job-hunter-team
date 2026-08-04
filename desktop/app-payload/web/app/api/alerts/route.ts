/**
 * API Alerts — alert personalizzati job hunting con condizione, canale, toggle
 */
import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const dynamic = 'force-dynamic';

type AlertChannel = 'email' | 'telegram' | 'web';
type AlertFrequency = 'realtime' | 'daily' | 'weekly';
type Alert = { id: string; name: string; condition: string; conditionType: string; channel: AlertChannel; frequency: AlertFrequency; enabled: boolean; lastTriggered: number | null; triggerCount: number; createdAt: number };

const ALERTS_PATH = path.join(os.homedir(), '.jht', 'alerts.json');

function loadAlerts(): Alert[] {
  try { return JSON.parse(fs.readFileSync(ALERTS_PATH, 'utf-8')); }
  catch { return generateSample(); }
}

function saveAlerts(data: Alert[]): void {
  const dir = path.dirname(ALERTS_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = ALERTS_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, ALERTS_PATH);
}

function generateSample(): Alert[] {
  const now = Date.now();
  return [
    { id: 'alert-001', name: 'Nuovi job Full Stack', condition: 'title contains "Full Stack" AND location = "Remote"', conditionType: 'job-match', channel: 'telegram', frequency: 'realtime', enabled: true, lastTriggered: now - 3600000, triggerCount: 23, createdAt: now - 2592000000 },
    { id: 'alert-002', name: 'Reminder colloqui', condition: 'interview.date within 24h', conditionType: 'interview-reminder', channel: 'email', frequency: 'daily', enabled: true, lastTriggered: now - 86400000, triggerCount: 8, createdAt: now - 1296000000 },
    { id: 'alert-003', name: 'Deadline candidature', condition: 'application.deadline within 48h', conditionType: 'deadline', channel: 'web', frequency: 'daily', enabled: true, lastTriggered: now - 172800000, triggerCount: 5, createdAt: now - 864000000 },
    { id: 'alert-004', name: 'Offerte > 50k EUR', condition: 'salary.min >= 50000 AND currency = "EUR"', conditionType: 'job-match', channel: 'telegram', frequency: 'realtime', enabled: true, lastTriggered: now - 7200000, triggerCount: 12, createdAt: now - 604800000 },
    { id: 'alert-005', name: 'Nuove aziende tech Milano', condition: 'company.sector = "Software" AND location contains "Milano"', conditionType: 'job-match', channel: 'email', frequency: 'weekly', enabled: false, lastTriggered: null, triggerCount: 0, createdAt: now - 432000000 },
    { id: 'alert-006', name: 'Candidatura vista', condition: 'application.status changed to "viewed"', conditionType: 'status-change', channel: 'web', frequency: 'realtime', enabled: true, lastTriggered: now - 86400000, triggerCount: 3, createdAt: now - 259200000 },
  ];
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const channel = searchParams.get('channel');
  let alerts = loadAlerts();
  if (channel) alerts = alerts.filter(a => a.channel === channel);
  const enabled = alerts.filter(a => a.enabled).length;
  return NextResponse.json({ alerts, total: alerts.length, enabled });
}

export async function PUT(req: Request) {
  try {
    const { id, enabled } = await req.json() as { id: string; enabled: boolean };
    if (!id || typeof enabled !== 'boolean') return NextResponse.json({ error: 'id e enabled richiesti' }, { status: 400 });
    const alerts = loadAlerts();
    const alert = alerts.find(a => a.id === id);
    if (!alert) return NextResponse.json({ error: 'Alert non trovato' }, { status: 404 });
    alert.enabled = enabled;
    saveAlerts(alerts);
    return NextResponse.json({ ok: true, id, enabled });
  } catch (err) { return NextResponse.json({ error: String(err) }, { status: 500 }); }
}
