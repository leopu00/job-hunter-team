/**
 * Backup — Runner: create, restore, list, retention
 * Usa tar nativo (child_process) per archivi compressi .tar.gz
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { JHT_HOME } from '../paths.js';
import type {
  BackupEntry, BackupResult, RestoreResult,
  BackupConfig, BackupManifest, RetentionPolicy,
} from './types.js';

const DEFAULT_BACKUP_DIR = path.join(JHT_HOME, 'backups');
const MANIFEST_NAME = 'backup-manifest.json';

function resolveDir(config?: Partial<BackupConfig>): string {
  return config?.backupDir || DEFAULT_BACKUP_DIR;
}

function generateId(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const rand = randomBytes(3).toString('hex');
  return `backup-${ts}-${rand}`;
}

function catalogPath(backupDir: string): string {
  return path.join(backupDir, 'catalog.json');
}

function loadCatalog(backupDir: string): BackupEntry[] {
  const p = catalogPath(backupDir);
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as BackupEntry[];
  } catch {
    return [];
  }
}

function saveCatalog(backupDir: string, entries: BackupEntry[]): void {
  fs.mkdirSync(backupDir, { recursive: true });
  const p = catalogPath(backupDir);
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(entries, null, 2), 'utf-8');
  fs.renameSync(tmp, p);
}

/** Crea un backup compresso delle sorgenti specificate */
export function createBackup(
  sources: string[],
  config?: Partial<BackupConfig>,
): BackupResult {
  const start = Date.now();
  const backupDir = resolveDir(config);
  fs.mkdirSync(backupDir, { recursive: true });

  const existing = sources.filter(s => fs.existsSync(s));
  if (existing.length === 0) {
    return { ok: false, error: 'Nessuna sorgente trovata', durationMs: Date.now() - start };
  }

  const id = generateId();
  const compress = config?.compress !== false;
  const ext = compress ? '.tar.gz' : '.tar';
  const archivePath = path.join(backupDir, id + ext);

  try {
    // Crea staging dir temporanea con manifest
    const staging = path.join(backupDir, '.staging-' + id);
    fs.mkdirSync(staging, { recursive: true });

    const files: BackupManifest['files'] = [];
    for (const src of existing) {
      const name = path.basename(src);
      const dest = path.join(staging, name);
      if (fs.statSync(src).isDirectory()) {
        execSync(`cp -r "${src}" "${dest}"`);
      } else {
        fs.copyFileSync(src, dest);
      }
      const size = fs.statSync(src).isDirectory()
        ? parseInt(execSync(`du -sb "${dest}" 2>/dev/null || du -sk "${dest}" | awk '{print $1*1024}'`).toString().trim().split('\t')[0], 10) || 0
        : fs.statSync(src).size;
      files.push({ relativePath: name, sizeBytes: size });
    }

    const manifest: BackupManifest = {
      version: '1.0.0', createdAt: Date.now(), sources: existing, files,
    };
    fs.writeFileSync(path.join(staging, MANIFEST_NAME), JSON.stringify(manifest, null, 2));

    // Crea archivio
    const flag = compress ? 'czf' : 'cf';
    execSync(`tar -${flag} "${archivePath}" -C "${staging}" .`);
    fs.rmSync(staging, { recursive: true, force: true });

    const sizeBytes = fs.statSync(archivePath).size;
    const entry: BackupEntry = {
      id, createdAt: Date.now(), sizeBytes, sources: existing,
      compressed: compress, archivePath, description: config?.sources?.join(', '),
    };

    const catalog = loadCatalog(backupDir);
    catalog.push(entry);
    saveCatalog(backupDir, catalog);

    return { ok: true, entry, durationMs: Date.now() - start };
  } catch (err) {
    return { ok: false, error: String(err), durationMs: Date.now() - start };
  }
}

/** Restore di un backup nella directory target */
export function restoreBackup(backupId: string, targetDir: string, config?: Partial<BackupConfig>): RestoreResult {
  const start = Date.now();
  const backupDir = resolveDir(config);
  const catalog = loadCatalog(backupDir);
  const entry = catalog.find(e => e.id === backupId);

  if (!entry) {
    return { ok: false, backupId, restoredFiles: [], error: 'Backup non trovato', durationMs: Date.now() - start };
  }
  if (!fs.existsSync(entry.archivePath)) {
    return { ok: false, backupId, restoredFiles: [], error: 'Archivio mancante', durationMs: Date.now() - start };
  }

  try {
    fs.mkdirSync(targetDir, { recursive: true });
    const flag = entry.compressed ? 'xzf' : 'xf';
    execSync(`tar -${flag} "${entry.archivePath}" -C "${targetDir}"`);

    const manifestPath = path.join(targetDir, MANIFEST_NAME);
    let restoredFiles: string[] = [];
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as BackupManifest;
      restoredFiles = manifest.files.map(f => f.relativePath);
      fs.unlinkSync(manifestPath);
    }
    return { ok: true, backupId, restoredFiles, durationMs: Date.now() - start };
  } catch (err) {
    return { ok: false, backupId, restoredFiles: [], error: String(err), durationMs: Date.now() - start };
  }
}

/** Lista tutti i backup nel catalogo */
export function listBackups(config?: Partial<BackupConfig>): BackupEntry[] {
  return loadCatalog(resolveDir(config)).sort((a, b) => b.createdAt - a.createdAt);
}

/** Applica retention policy: rimuove backup vecchi o in eccesso */
export function applyRetention(policy: RetentionPolicy, config?: Partial<BackupConfig>): number {
  const backupDir = resolveDir(config);
  const catalog = loadCatalog(backupDir);
  if (catalog.length === 0) return 0;

  const sorted = [...catalog].sort((a, b) => b.createdAt - a.createdAt);
  const toRemove = new Set<string>();

  if (policy.maxAgeDays !== undefined) {
    const cutoff = Date.now() - policy.maxAgeDays * 86400_000;
    for (const e of sorted) {
      if (e.createdAt < cutoff) toRemove.add(e.id);
    }
  }
  if (policy.maxCount !== undefined) {
    sorted.slice(policy.maxCount).forEach(e => toRemove.add(e.id));
  }

  for (const id of toRemove) {
    const entry = catalog.find(e => e.id === id);
    if (entry && fs.existsSync(entry.archivePath)) {
      fs.unlinkSync(entry.archivePath);
    }
  }

  const remaining = catalog.filter(e => !toRemove.has(e.id));
  saveCatalog(backupDir, remaining);
  return toRemove.size;
}
