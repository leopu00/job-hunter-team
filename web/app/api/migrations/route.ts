/**
 * API Migrations — Stato, esecuzione up, rollback down
 */
import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

export const dynamic = 'force-dynamic'

const STATE_PATH = path.join(homedir(), '.jht', 'migrations.json');
const CONFIG_PATH = path.join(homedir(), '.jht', 'config.json');

type AppliedMigration = { version: string; description: string; appliedAt: number };
type MigrationState = { currentVersion: string; applied: AppliedMigration[]; updatedAt: number };
type Migration = {
  version: string; description: string;
  up: (c: Record<string, unknown>) => Record<string, unknown>;
  down: (c: Record<string, unknown>) => Record<string, unknown>;
};

function loadState(): MigrationState {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8')); }
  catch { return { currentVersion: '0.0.0', applied: [], updatedAt: Date.now() }; }
}

function loadConfig(): Record<string, unknown> {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')); }
  catch { return {}; }
}

// Migrazioni registrate nel sistema
const REGISTERED_MIGRATIONS: Migration[] = [
  {
    version: '1.0.0', description: 'Struttura config iniziale',
    up: (c) => { c.version = '1.0.0'; c.initialized = true; return c; },
    down: (c) => { delete c.version; delete c.initialized; return c; },
  },
  {
    version: '1.1.0', description: 'Aggiungi impostazioni notifiche',
    up: (c) => { c.notifications = { enabled: true, channels: ['web'] }; return c; },
    down: (c) => { delete c.notifications; return c; },
  },
  {
    version: '1.2.0', description: 'Aggiungi impostazioni backup',
    up: (c) => { c.backup = { autoBackup: false, retentionDays: 30 }; return c; },
    down: (c) => { delete c.backup; return c; },
  },
];

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// GET — stato migrazioni: versione corrente, applied, pending
export async function GET() {
  const state = loadState();
  const pending = REGISTERED_MIGRATIONS
    .filter(m => compareVersions(m.version, state.currentVersion) > 0)
    .sort((a, b) => compareVersions(a.version, b.version))
    .map(m => ({ version: m.version, description: m.description }));

  const applied = [...state.applied].sort((a, b) => compareVersions(b.version, a.version));

  return NextResponse.json({
    currentVersion: state.currentVersion,
    updatedAt: state.updatedAt,
    applied,
    pending,
    totalRegistered: REGISTERED_MIGRATIONS.length,
  });
}

// POST — esegui migrazioni up
export async function POST() {
  try {
    // Migrate up inline — shared/migrations/runner non disponibile
    const config = loadConfig();
    const state = loadState();
    const pending = REGISTERED_MIGRATIONS
      .filter(m => compareVersions(m.version, state.currentVersion) > 0)
      .sort((a, b) => compareVersions(a.version, b.version));

    const from = state.currentVersion;
    const applied: { version: string; description: string; success: boolean; error?: string }[] = [];

    for (const m of pending) {
      try {
        m.up(config);
        state.applied.push({ version: m.version, description: m.description, appliedAt: Date.now() });
        state.currentVersion = m.version;
        applied.push({ version: m.version, description: m.description, success: true });
      } catch (e) {
        applied.push({ version: m.version, description: m.description, success: false, error: String(e) });
        break;
      }
    }

    state.updatedAt = Date.now();
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
    if (applied.some(a => a.success)) {
      fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
    }

    const ok = applied.every(a => a.success);
    return NextResponse.json({ ok, from, to: state.currentVersion, applied }, { status: ok ? 200 : 500 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// PATCH — rollback a versione target (?target=1.0.0)
export async function PATCH(req: Request) {
  const { searchParams } = new URL(req.url);
  const target = searchParams.get('target');
  if (!target) return NextResponse.json({ error: 'Parametro target richiesto' }, { status: 400 });

  try {
    // Migrate down inline — shared/migrations/runner non disponibile
    const config = loadConfig();
    const state = loadState();
    const from = state.currentVersion;
    const toRollback = REGISTERED_MIGRATIONS
      .filter(m => compareVersions(m.version, target) > 0 && compareVersions(m.version, state.currentVersion) <= 0)
      .sort((a, b) => compareVersions(b.version, a.version));

    const applied: { version: string; description: string; success: boolean; error?: string }[] = [];
    for (const m of toRollback) {
      try {
        m.down(config);
        state.applied = state.applied.filter(a => a.version !== m.version);
        state.currentVersion = target;
        applied.push({ version: m.version, description: m.description, success: true });
      } catch (e) {
        applied.push({ version: m.version, description: m.description, success: false, error: String(e) });
        break;
      }
    }

    state.updatedAt = Date.now();
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
    if (applied.some(a => a.success)) {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
    }

    const ok = applied.every(a => a.success);
    return NextResponse.json({ ok, from, to: state.currentVersion, applied }, { status: ok ? 200 : 500 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
