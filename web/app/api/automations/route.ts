/**
 * API Automations — lista automazioni, toggle stato enabled/disabled
 */
import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { JHT_HOME } from '@/lib/jht-paths'
import { sanitizedError } from '@/lib/error-response'

export const dynamic = 'force-dynamic';

type TriggerType = 'cron' | 'event' | 'webhook';
type ActionType = 'notify' | 'deploy' | 'backup' | 'script' | 'sync';
type Automation = { id: string; name: string; trigger: TriggerType; triggerConfig: string; action: ActionType; actionTarget: string; enabled: boolean; lastRun: number | null; nextRun: number | null; runCount: number };

const DATA_PATH = path.join(JHT_HOME, 'automations.json');

function loadAutomations(): Automation[] {
  try { return JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8')); }
  catch { return generateDefaults(); }
}

function saveAutomations(data: Automation[]): void {
  const dir = path.dirname(DATA_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = DATA_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, DATA_PATH);
}

function generateDefaults(): Automation[] {
  const now = Date.now();
  return [
    { id: 'auto-001', name: 'Backup giornaliero', trigger: 'cron', triggerConfig: '0 3 * * *', action: 'backup', actionTarget: '~/.jht/', enabled: true, lastRun: now - 43200000, nextRun: now + 43200000, runCount: 45 },
    { id: 'auto-002', name: 'Notifica nuovi job', trigger: 'event', triggerConfig: 'job.created', action: 'notify', actionTarget: 'telegram', enabled: true, lastRun: now - 3600000, nextRun: null, runCount: 128 },
    { id: 'auto-003', name: 'Deploy su push master', trigger: 'webhook', triggerConfig: 'github/push', action: 'deploy', actionTarget: 'production', enabled: false, lastRun: now - 86400000, nextRun: null, runCount: 12 },
    { id: 'auto-004', name: 'Sync LinkedIn alerts', trigger: 'cron', triggerConfig: '*/30 * * * *', action: 'sync', actionTarget: 'linkedin-alerts', enabled: true, lastRun: now - 1800000, nextRun: now + 1800000, runCount: 312 },
    { id: 'auto-005', name: 'Pulizia log settimanale', trigger: 'cron', triggerConfig: '0 0 * * 0', action: 'script', actionTarget: 'cleanup-logs.sh', enabled: true, lastRun: now - 432000000, nextRun: now + 172800000, runCount: 8 },
    { id: 'auto-006', name: 'Report candidature', trigger: 'cron', triggerConfig: '0 9 * * 1', action: 'notify', actionTarget: 'email', enabled: true, lastRun: now - 259200000, nextRun: now + 345600000, runCount: 15 },
    { id: 'auto-007', name: 'Webhook Slack errori', trigger: 'event', triggerConfig: 'error.critical', action: 'notify', actionTarget: 'slack', enabled: false, lastRun: null, nextRun: null, runCount: 0 },
  ];
}

// GET — lista automazioni
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const trigger = searchParams.get('trigger');
  const action = searchParams.get('action');
  let automations = loadAutomations();
  if (trigger) automations = automations.filter(a => a.trigger === trigger);
  if (action) automations = automations.filter(a => a.action === action);
  const enabled = automations.filter(a => a.enabled).length;
  const triggers = [...new Set(loadAutomations().map(a => a.trigger))];
  const actions = [...new Set(loadAutomations().map(a => a.action))];
  return NextResponse.json({ automations, total: automations.length, enabled, triggers, actions });
}

// PUT — toggle enabled/disabled
export async function PUT(req: Request) {
  try {
    const { id, enabled } = await req.json() as { id: string; enabled: boolean };
    if (!id || typeof enabled !== 'boolean') return NextResponse.json({ error: 'id e enabled richiesti' }, { status: 400 });
    const automations = loadAutomations();
    const auto = automations.find(a => a.id === id);
    if (!auto) return NextResponse.json({ error: 'Automazione non trovata' }, { status: 404 });
    auto.enabled = enabled;
    saveAutomations(automations);
    return NextResponse.json({ ok: true, id, enabled });
  } catch (err) { return sanitizedError(err, { scope: 'automations' }); }
}
