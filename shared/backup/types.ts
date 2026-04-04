/**
 * Backup — Tipi per backup automatico config e dati
 */

/** Singolo backup salvato */
export interface BackupEntry {
  id: string;
  createdAt: number;
  sizeBytes: number;
  sources: string[];
  compressed: boolean;
  archivePath: string;
  description?: string;
}

/** Risultato operazione backup */
export interface BackupResult {
  ok: boolean;
  entry?: BackupEntry;
  error?: string;
  durationMs: number;
}

/** Risultato restore */
export interface RestoreResult {
  ok: boolean;
  backupId: string;
  restoredFiles: string[];
  error?: string;
  durationMs: number;
}

/** Policy di retention */
export interface RetentionPolicy {
  maxCount?: number;
  maxAgeDays?: number;
}

/** Configurazione backup */
export interface BackupConfig {
  backupDir: string;
  sources: string[];
  retention: RetentionPolicy;
  compress: boolean;
}

export const DEFAULT_BACKUP_CONFIG: BackupConfig = {
  backupDir: '',  // risolto a runtime (~/.jht/backups)
  sources: [],
  retention: { maxCount: 10, maxAgeDays: 30 },
  compress: true,
};

/** Manifest del backup (salvato dentro l'archivio) */
export interface BackupManifest {
  version: string;
  createdAt: number;
  sources: string[];
  files: { relativePath: string; sizeBytes: number }[];
}
