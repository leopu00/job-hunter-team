/**
 * API Backup — Lista, crea, ripristina, elimina backup
 */
import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { JHT_HOME } from '@/lib/jht-paths'
import { requireAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const BACKUP_DIR = path.join(JHT_HOME, 'backups');
const CATALOG_PATH = path.join(BACKUP_DIR, 'catalog.json');
const JHT_DIR = JHT_HOME;

// Backup id valido: lettere/cifre/underscore/dash. Previene path traversal
// in PATCH (`path.join(JHT_HOME, 'restored', id)`) e in DELETE (lookup
// in catalog è già vincolato dal find ma l'archivePath potrebbe essere
// composto altrove).
const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

type BackupEntry = {
  id: string; createdAt: number; sizeBytes: number; sources: string[];
  compressed: boolean; archivePath: string; description?: string;
};

function loadCatalog(): BackupEntry[] {
  try { return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8')); }
  catch { return []; }
}

function saveCatalog(entries: BackupEntry[]): void {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const tmp = CATALOG_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(entries, null, 2), 'utf-8');
  fs.renameSync(tmp, CATALOG_PATH);
}

const DEFAULT_SOURCES = [
  path.join(JHT_DIR, 'config.json'),
  path.join(JHT_DIR, 'migrations.json'),
  path.join(JHT_DIR, 'notifications'),
];

async function loadBackupRunner() {
  const modulePath = path.join(process.cwd(), '..', 'shared', 'backup', 'runner.ts');
  return import(pathToFileURL(modulePath).href);
}

// GET — lista backup
export async function GET() {
  const denied = await requireAuth()
  if (denied) return denied
  const entries = loadCatalog().sort((a, b) => b.createdAt - a.createdAt);
  const totalSize = entries.reduce((s, e) => s + e.sizeBytes, 0);
  return NextResponse.json({ backups: entries, count: entries.length, totalSize });
}

// POST — crea backup
export async function POST(req: Request) {
  const denied = await requireAuth()
  if (denied) return denied
  try {
    const body = await req.json().catch(() => ({}));
    const sources: string[] = body.sources?.length ? body.sources : DEFAULT_SOURCES;
    const description: string = body.description || '';

    const existing = sources.filter(s => fs.existsSync(s));
    if (existing.length === 0) {
      return NextResponse.json({ error: 'Nessuna sorgente trovata' }, { status: 400 });
    }

    // Importa dinamicamente per evitare problemi con webpack/next
    const { createBackup } = await loadBackupRunner();
    const result = createBackup(existing, { backupDir: BACKUP_DIR, compress: true, sources: existing });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    if (description && result.entry) {
      const catalog = loadCatalog();
      const entry = catalog.find(e => e.id === result.entry.id);
      if (entry) {
        entry.description = description;
        saveCatalog(catalog);
      }
    }

    return NextResponse.json({ backup: result.entry, durationMs: result.durationMs }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// PATCH — ripristina backup
export async function PATCH(req: Request) {
  const denied = await requireAuth()
  if (denied) return denied
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Parametro id richiesto' }, { status: 400 });
  if (!ID_PATTERN.test(id)) return NextResponse.json({ error: 'id non valido' }, { status: 400 });

  try {
    const { restoreBackup } = await loadBackupRunner();
    const targetDir = path.join(JHT_HOME, 'restored', id);
    const result = restoreBackup(id, targetDir, { backupDir: BACKUP_DIR });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }

    return NextResponse.json({ restored: result.restoredFiles, targetDir, durationMs: result.durationMs });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// DELETE — elimina backup
export async function DELETE(req: Request) {
  const denied = await requireAuth()
  if (denied) return denied
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Parametro id richiesto' }, { status: 400 });
  if (!ID_PATTERN.test(id)) return NextResponse.json({ error: 'id non valido' }, { status: 400 });

  const catalog = loadCatalog();
  const entry = catalog.find(e => e.id === id);
  if (!entry) return NextResponse.json({ error: 'Backup non trovato' }, { status: 404 });

  if (fs.existsSync(entry.archivePath)) fs.unlinkSync(entry.archivePath);
  const remaining = catalog.filter(e => e.id !== id);
  saveCatalog(remaining);

  return NextResponse.json({ deleted: id, remaining: remaining.length });
}
