/**
 * API Backup — Lista, crea, ripristina, elimina backup
 */
import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

const BACKUP_DIR = path.join(homedir(), '.jht', 'backups');
const CATALOG_PATH = path.join(BACKUP_DIR, 'catalog.json');
const JHT_DIR = path.join(homedir(), '.jht');

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

// GET — lista backup
export async function GET() {
  const entries = loadCatalog().sort((a, b) => b.createdAt - a.createdAt);
  const totalSize = entries.reduce((s, e) => s + e.sizeBytes, 0);
  return NextResponse.json({ backups: entries, count: entries.length, totalSize });
}

// POST — crea backup
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const sources: string[] = body.sources?.length ? body.sources : DEFAULT_SOURCES;
    const description: string = body.description || '';

    const existing = sources.filter(s => fs.existsSync(s));
    if (existing.length === 0) {
      return NextResponse.json({ error: 'Nessuna sorgente trovata' }, { status: 400 });
    }

    // Backup inline — shared/backup/runner non disponibile
    const start = Date.now();
    const id = `bk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const archivePath = path.join(BACKUP_DIR, `${id}.json`);
    fs.mkdirSync(BACKUP_DIR, { recursive: true });

    const snapshot: Record<string, string> = {};
    for (const src of existing) {
      try { snapshot[src] = fs.readFileSync(src, 'utf-8'); } catch { /* skip */ }
    }
    fs.writeFileSync(archivePath, JSON.stringify(snapshot, null, 2), 'utf-8');
    const sizeBytes = fs.statSync(archivePath).size;

    const entry: BackupEntry = {
      id, createdAt: Date.now(), sizeBytes, sources: existing,
      compressed: false, archivePath, description,
    };
    const catalog = loadCatalog();
    catalog.push(entry);
    saveCatalog(catalog);

    return NextResponse.json({ backup: entry, durationMs: Date.now() - start }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// PATCH — ripristina backup
export async function PATCH(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Parametro id richiesto' }, { status: 400 });

  try {
    // Restore inline — shared/backup/runner non disponibile
    const start = Date.now();
    const catalog = loadCatalog();
    const entry = catalog.find(e => e.id === id);
    if (!entry) return NextResponse.json({ error: 'Backup non trovato' }, { status: 404 });
    if (!fs.existsSync(entry.archivePath)) return NextResponse.json({ error: 'Archivio mancante' }, { status: 404 });

    const snapshot = JSON.parse(fs.readFileSync(entry.archivePath, 'utf-8'));
    const targetDir = path.join(homedir(), '.jht', 'restored', id);
    fs.mkdirSync(targetDir, { recursive: true });
    const restoredFiles: string[] = [];
    for (const [filePath, content] of Object.entries(snapshot)) {
      const dest = path.join(targetDir, path.basename(filePath));
      fs.writeFileSync(dest, content as string, 'utf-8');
      restoredFiles.push(dest);
    }
    return NextResponse.json({ restored: restoredFiles, targetDir, durationMs: Date.now() - start });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// DELETE — elimina backup
export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Parametro id richiesto' }, { status: 400 });

  const catalog = loadCatalog();
  const entry = catalog.find(e => e.id === id);
  if (!entry) return NextResponse.json({ error: 'Backup non trovato' }, { status: 404 });

  if (fs.existsSync(entry.archivePath)) fs.unlinkSync(entry.archivePath);
  const remaining = catalog.filter(e => e.id !== id);
  saveCatalog(remaining);

  return NextResponse.json({ deleted: id, remaining: remaining.length });
}
