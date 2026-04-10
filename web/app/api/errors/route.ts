/**
 * API Errors — Error tracker: lista errori, cambia stato
 */
import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { JHT_HOME } from '@/lib/jht-paths'

export const dynamic = 'force-dynamic'

const ERRORS_PATH = path.join(JHT_HOME, 'errors', 'errors.json');

type ErrorStatus = 'open' | 'resolved' | 'ignored';

interface TrackedError {
  id: string;
  message: string;
  stack: string;
  type: string;
  source: string;
  status: ErrorStatus;
  count: number;
  firstSeen: number;
  lastSeen: number;
}

function loadErrors(): TrackedError[] {
  try { return JSON.parse(fs.readFileSync(ERRORS_PATH, 'utf-8')); }
  catch { return []; }
}

function saveErrors(errors: TrackedError[]): void {
  const dir = path.dirname(ERRORS_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = ERRORS_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(errors, null, 2), 'utf-8');
  fs.renameSync(tmp, ERRORS_PATH);
}

function generateSampleErrors(): TrackedError[] {
  const now = Date.now();
  return [
    { id: 'err-001', message: 'Cannot read properties of undefined (reading "map")', stack: 'TypeError: Cannot read properties of undefined\n  at DashboardPage (dashboard/page.tsx:45:12)\n  at renderWithHooks (react-dom)', type: 'TypeError', source: 'dashboard/page.tsx', status: 'open', count: 12, firstSeen: now - 86400000, lastSeen: now - 3600000 },
    { id: 'err-002', message: 'Failed to fetch /api/agents', stack: 'Error: Failed to fetch\n  at fetchAgents (agents/page.tsx:22:5)\n  at useCallback', type: 'NetworkError', source: 'agents/page.tsx', status: 'open', count: 5, firstSeen: now - 43200000, lastSeen: now - 7200000 },
    { id: 'err-003', message: 'ENOENT: no such file or directory', stack: 'Error: ENOENT\n  at Object.openSync (fs.js:498:3)\n  at loadConfig (api/config/route.ts:15:8)', type: 'SystemError', source: 'api/config/route.ts', status: 'resolved', count: 3, firstSeen: now - 172800000, lastSeen: now - 86400000 },
    { id: 'err-004', message: 'Hydration failed because the server rendered HTML', stack: 'Error: Hydration failed\n  at throwOnHydrationMismatch (react-dom)\n  at ChannelsPage', type: 'HydrationError', source: 'channels/page.tsx', status: 'ignored', count: 28, firstSeen: now - 259200000, lastSeen: now - 1800000 },
    { id: 'err-005', message: 'Rate limit exceeded for IP', stack: 'Error: Rate limit exceeded\n  at checkRateLimit (middleware.ts:42:11)', type: 'RateLimitError', source: 'middleware.ts', status: 'open', count: 45, firstSeen: now - 7200000, lastSeen: now - 300000 },
  ];
}

// GET — lista errori con filtri
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') as ErrorStatus | null;
  const type = searchParams.get('type');

  let errors = loadErrors();
  if (status) errors = errors.filter(e => e.status === status);
  if (type) errors = errors.filter(e => e.type === type);

  errors.sort((a, b) => b.lastSeen - a.lastSeen);
  const types = [...new Set(loadErrors().map(e => e.type))];
  const openCount = loadErrors().filter(e => e.status === 'open').length;

  return NextResponse.json({ errors, types, total: errors.length, openCount });
}

// PUT — cambia stato errore
export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const { id, status } = body as { id: string; status: ErrorStatus };
    if (!id || !['open', 'resolved', 'ignored'].includes(status)) {
      return NextResponse.json({ error: 'id e status (open/resolved/ignored) richiesti' }, { status: 400 });
    }
    const errors = loadErrors();
    const err = errors.find(e => e.id === id);
    if (!err) return NextResponse.json({ error: 'Errore non trovato' }, { status: 404 });
    err.status = status;
    saveErrors(errors);
    return NextResponse.json({ ok: true, id, status });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
