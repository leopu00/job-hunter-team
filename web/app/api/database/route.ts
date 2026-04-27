/**
 * API Database — tabelle, row count, dimensione, query explorer SELECT-only
 */
import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { JHT_HOME } from '@/lib/jht-paths'
import { requireAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic';

type TableInfo = { name: string; rowCount: number; sizeKB: number; columns: string[]; source: string };

const DATA_DIRS = [
  JHT_HOME,
  path.join(JHT_HOME, 'databases'),
  path.join(JHT_HOME, 'analytics'),
  path.join(JHT_HOME, 'sessions'),
  path.join(JHT_HOME, 'errors'),
  path.join(JHT_HOME, 'status'),
];

// Hardcoded allowlist: only these basenames are exposed by the database explorer.
// Any other JSON file under JHT_HOME — including secrets.json, credential dumps,
// or future user-added files — is invisible to GET and rejected by POST.
const ALLOWED_TABLES = new Set<string>([
  'alerts', 'analytics', 'applications', 'archive', 'automations',
  'companies', 'contacts', 'cover-letters', 'enabled', 'errors',
  'goals', 'history', 'interviews', 'jobs', 'notifications',
  'onboarding', 'reminders', 'resume', 'saved-searches', 'stats',
  'webhooks', 'circuit-breakers',
]);

// Defense-in-depth: refuse any basename matching a sensitive prefix even if
// it slips into ALLOWED_TABLES by mistake.
const DENY_PATTERN = /^(secrets|credentials|tokens|\.env)/i;

function isAllowedTable(basename: string): boolean {
  return ALLOWED_TABLES.has(basename) && !DENY_PATTERN.test(basename);
}

function scanJsonFiles(): TableInfo[] {
  const tables: TableInfo[] = [];
  for (const dir of DATA_DIRS) {
    let files: string[];
    try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')); } catch { continue; }
    for (const file of files) {
      const name = file.replace('.json', '');
      if (!isAllowedTable(name)) continue;
      const fp = path.join(dir, file);
      try {
        const stat = fs.statSync(fp);
        const content = JSON.parse(fs.readFileSync(fp, 'utf-8'));
        let rowCount = 0; let columns: string[] = [];
        if (Array.isArray(content)) { rowCount = content.length; if (content[0] && typeof content[0] === 'object') columns = Object.keys(content[0]); }
        else if (typeof content === 'object') {
          const arrKey = Object.keys(content).find(k => Array.isArray(content[k]));
          if (arrKey) { rowCount = content[arrKey].length; if (content[arrKey][0] && typeof content[arrKey][0] === 'object') columns = Object.keys(content[arrKey][0]); }
          else { rowCount = Object.keys(content).length; columns = Object.keys(content); }
        }
        tables.push({ name, rowCount, sizeKB: Math.round(stat.size / 1024 * 10) / 10, columns, source: path.relative(os.homedir(), fp) });
      } catch { /* skip */ }
    }
  }
  return tables;
}

function scanSqliteFiles(): TableInfo[] {
  const tables: TableInfo[] = [];
  const dbDir = path.join(JHT_HOME, 'databases');
  let files: string[];
  try { files = fs.readdirSync(dbDir).filter(f => f.endsWith('.db') || f.endsWith('.sqlite')); } catch { return tables; }
  for (const file of files) {
    const fp = path.join(dbDir, file);
    try {
      const stat = fs.statSync(fp);
      tables.push({ name: file, rowCount: -1, sizeKB: Math.round(stat.size / 1024 * 10) / 10, columns: ['(SQLite — usa query explorer)'], source: path.relative(os.homedir(), fp) });
    } catch { /* skip */ }
  }
  return tables;
}

function queryJson(tableName: string, query: string): { columns: string[]; rows: Record<string, unknown>[]; count: number } | null {
  if (!isAllowedTable(tableName)) return null;
  const allTables = scanJsonFiles();
  const table = allTables.find(t => t.name === tableName);
  if (!table) return null;
  const fp = path.join(os.homedir(), table.source);
  try {
    const content = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    let rows: Record<string, unknown>[] = [];
    if (Array.isArray(content)) rows = content;
    else if (typeof content === 'object') {
      const arrKey = Object.keys(content).find(k => Array.isArray(content[k]));
      if (arrKey) rows = content[arrKey];
    }
    const limitMatch = query.match(/LIMIT\s+(\d+)/i);
    const limit = limitMatch ? parseInt(limitMatch[1]) : 50;
    rows = rows.slice(0, Math.min(limit, 100));
    const columns = rows.length > 0 && typeof rows[0] === 'object' ? Object.keys(rows[0]) : [];
    return { columns, rows, count: rows.length };
  } catch { return null; }
}

// GET — lista tabelle
export async function GET() {
  const denied = await requireAuth()
  if (denied) return denied
  const jsonTables = scanJsonFiles();
  const sqliteTables = scanSqliteFiles();
  const tables = [...jsonTables, ...sqliteTables].sort((a, b) => b.sizeKB - a.sizeKB);
  const totalSizeKB = Math.round(tables.reduce((s, t) => s + t.sizeKB, 0) * 10) / 10;
  const totalRows = tables.reduce((s, t) => s + (t.rowCount >= 0 ? t.rowCount : 0), 0);
  return NextResponse.json({ tables, total: tables.length, totalSizeKB, totalRows });
}

// POST — query explorer (SELECT only)
export async function POST(req: Request) {
  const denied = await requireAuth()
  if (denied) return denied
  try {
    const { table, query } = await req.json() as { table: string; query: string };
    if (!table || !query) return NextResponse.json({ error: 'table e query richiesti' }, { status: 400 });
    const normalized = query.trim().toUpperCase();
    if (!normalized.startsWith('SELECT')) return NextResponse.json({ error: 'Solo query SELECT consentite' }, { status: 403 });
    if (/\b(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|TRUNCATE)\b/i.test(query)) {
      return NextResponse.json({ error: 'Operazioni di modifica non consentite' }, { status: 403 });
    }
    const result = queryJson(table, query);
    if (!result) return NextResponse.json({ error: 'Tabella non trovata' }, { status: 404 });
    return NextResponse.json(result);
  } catch (err) { return NextResponse.json({ error: String(err) }, { status: 500 }); }
}
